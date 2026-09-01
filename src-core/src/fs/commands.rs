use super::tree::{build_tree, ensure_within_root, FileTreeNode, FsError};
use super::FsState;
use notify::event::{ModifyKind, RenameMode};
use notify::{Event, EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, State};
use tokio::fs;

const FS_EVENT: &str = "workspace-fs-event";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFolderResult {
    root_path: String,
    tree: FileTreeNode,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFsEvent {
    kind: WorkspaceFsEventKind,
    paths: Vec<String>,
    tree: Option<FileTreeNode>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceFsEventKind {
    Created,
    Deleted,
    Renamed,
}

#[tauri::command]
pub async fn open_folder(state: State<'_, FsState>) -> Result<Option<OpenFolderResult>, String> {
    let Some(folder) = rfd::AsyncFileDialog::new().pick_folder().await else {
        return Ok(None);
    };

    let root_path = folder.path().to_path_buf();
    let tree = load_tree(root_path.clone()).await?;
    set_root(&state, root_path.clone())?;

    Ok(Some(OpenFolderResult {
        root_path: root_path.to_string_lossy().to_string(),
        tree,
    }))
}

#[tauri::command]
pub async fn read_file(path: String, state: State<'_, FsState>) -> Result<String, String> {
    let root = current_root(&state)?;
    let path = ensure_within_root(Path::new(&path), &root).map_err(to_ipc_error)?;
    fs::read_to_string(path).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn write_file(
    path: String,
    contents: String,
    state: State<'_, FsState>,
) -> Result<(), String> {
    let root = current_root(&state)?;
    let path = ensure_within_root(Path::new(&path), &root).map_err(to_ipc_error)?;
    fs::write(path, contents)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_file(path: String, state: State<'_, FsState>) -> Result<(), String> {
    let root = current_root(&state)?;
    let path = ensure_within_root(Path::new(&path), &root).map_err(to_ipc_error)?;
    if path.exists() {
        return Err(FsError::AlreadyExists.to_string());
    }
    fs::write(path, "").await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_folder(path: String, state: State<'_, FsState>) -> Result<(), String> {
    let root = current_root(&state)?;
    let path = ensure_within_root(Path::new(&path), &root).map_err(to_ipc_error)?;
    if path.exists() {
        return Err(FsError::AlreadyExists.to_string());
    }
    fs::create_dir_all(path)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn rename_path(
    path: String,
    new_path: String,
    state: State<'_, FsState>,
) -> Result<(), String> {
    let root = current_root(&state)?;
    let from = ensure_within_root(Path::new(&path), &root).map_err(to_ipc_error)?;
    let to = ensure_within_root(Path::new(&new_path), &root).map_err(to_ipc_error)?;
    if !from.exists() {
        return Err(FsError::NotFound.to_string());
    }
    if to.exists() {
        return Err(FsError::AlreadyExists.to_string());
    }
    fs::rename(from, to).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_path(path: String, state: State<'_, FsState>) -> Result<(), String> {
    let root = current_root(&state)?;
    let path = ensure_within_root(Path::new(&path), &root).map_err(to_ipc_error)?;
    let metadata = fs::metadata(&path).await.map_err(|error| error.to_string())?;
    if metadata.is_dir() {
        fs::remove_dir_all(path).await.map_err(|error| error.to_string())
    } else {
        fs::remove_file(path).await.map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub async fn watch_folder(
    path: String,
    app: AppHandle,
    state: State<'_, FsState>,
) -> Result<FileTreeNode, String> {
    let root = PathBuf::from(path).canonicalize().map_err(to_ipc_error)?;
    let tree = load_tree(root.clone()).await?;
    let watcher = create_watcher(root.clone(), app).map_err(to_ipc_error)?;

    set_root(&state, root)?;
    let mut watcher_slot = state
        .watcher
        .lock()
        .map_err(|_| "File watcher state is unavailable".to_string())?;
    *watcher_slot = Some(watcher);

    Ok(tree)
}

async fn load_tree(root: PathBuf) -> Result<FileTreeNode, String> {
    tokio::task::spawn_blocking(move || build_tree(&root))
        .await
        .map_err(|error| error.to_string())?
        .map_err(to_ipc_error)
}

fn create_watcher(root: PathBuf, app: AppHandle) -> Result<notify::RecommendedWatcher, FsError> {
    let watched_root = root.clone();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<Event>| {
        let Ok(event) = event else {
            return;
        };

        let Some(kind) = classify_event(&event.kind) else {
            return;
        };

        let tree = build_tree(&root).ok();
        let payload = WorkspaceFsEvent {
            kind,
            paths: event
                .paths
                .iter()
                .map(|path| path.to_string_lossy().to_string())
                .collect(),
            tree,
        };

        let _ = app.emit(FS_EVENT, payload);
    })?;

    watcher.watch(&watched_root, RecursiveMode::Recursive)?;
    Ok(watcher)
}

fn classify_event(kind: &EventKind) -> Option<WorkspaceFsEventKind> {
    match kind {
        EventKind::Create(_) => Some(WorkspaceFsEventKind::Created),
        EventKind::Remove(_) => Some(WorkspaceFsEventKind::Deleted),
        EventKind::Modify(ModifyKind::Name(RenameMode::Any | RenameMode::Both | RenameMode::From | RenameMode::To)) => {
            Some(WorkspaceFsEventKind::Renamed)
        }
        _ => None,
    }
}

fn current_root(state: &State<'_, FsState>) -> Result<PathBuf, String> {
    state
        .root
        .lock()
        .map_err(|_| "Workspace state is unavailable".to_string())?
        .clone()
        .ok_or_else(|| FsError::NoWorkspace.to_string())
}

fn set_root(state: &State<'_, FsState>, root: PathBuf) -> Result<(), String> {
    let mut current_root = state
        .root
        .lock()
        .map_err(|_| "Workspace state is unavailable".to_string())?;
    *current_root = Some(root);
    Ok(())
}

fn to_ipc_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}
