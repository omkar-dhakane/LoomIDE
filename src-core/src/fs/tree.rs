use serde::Serialize;
use std::cmp::Ordering;
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum FsError {
    #[error("No workspace folder is open")]
    NoWorkspace,
    #[error("Path is outside the open workspace")]
    OutsideWorkspace,
    #[error("File or folder was not found")]
    NotFound,
    #[error("A file or folder with that name already exists")]
    AlreadyExists,
    #[error("Filesystem error: {0}")]
    Io(#[from] std::io::Error),
    #[error("File watcher error: {0}")]
    Watcher(#[from] notify::Error),
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeNode {
    pub name: String,
    pub path: String,
    pub kind: FileTreeNodeKind,
    pub children: Option<Vec<FileTreeNode>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileTreeNodeKind {
    File,
    Directory,
}

pub fn build_tree(root: &Path) -> Result<FileTreeNode, FsError> {
    let root = root.canonicalize()?;
    build_node(&root)
}

pub fn ensure_within_root(path: &Path, root: &Path) -> Result<PathBuf, FsError> {
    let root = root.canonicalize()?;
    let target = if path.exists() {
        path.canonicalize()?
    } else {
        let parent = path.parent().ok_or(FsError::OutsideWorkspace)?;
        parent.canonicalize()?.join(
            path.file_name()
                .ok_or(FsError::OutsideWorkspace)?,
        )
    };

    if target.starts_with(&root) {
        Ok(target)
    } else {
        Err(FsError::OutsideWorkspace)
    }
}

fn build_node(path: &Path) -> Result<FileTreeNode, FsError> {
    let metadata = fs::metadata(path)?;
    let kind = if metadata.is_dir() {
        FileTreeNodeKind::Directory
    } else {
        FileTreeNodeKind::File
    };

    let children = if metadata.is_dir() {
        let mut entries = fs::read_dir(path)?
            .filter_map(Result::ok)
            .filter_map(|entry| build_node(&entry.path()).ok())
            .collect::<Vec<_>>();

        entries.sort_by(compare_nodes);
        Some(entries)
    } else {
        None
    };

    Ok(FileTreeNode {
        name: display_name(path),
        path: path.to_string_lossy().to_string(),
        kind,
        children,
    })
}

fn compare_nodes(left: &FileTreeNode, right: &FileTreeNode) -> Ordering {
    match (&left.kind, &right.kind) {
        (FileTreeNodeKind::Directory, FileTreeNodeKind::File) => Ordering::Less,
        (FileTreeNodeKind::File, FileTreeNodeKind::Directory) => Ordering::Greater,
        _ => left
            .name
            .to_lowercase()
            .cmp(&right.name.to_lowercase()),
    }
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_workspace() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = dir.path();

        fs::create_dir(root.join("src")).unwrap();
        fs::create_dir(root.join("docs")).unwrap();
        fs::write(root.join("src").join("main.rs"), "fn main() {}\n").unwrap();
        fs::write(root.join("README.md"), "# fixture\n").unwrap();

        dir
    }

    #[test]
    fn build_tree_lists_directories_before_files_case_insensitively() {
        let dir = fixture_workspace();
        let tree = build_tree(dir.path()).unwrap();

        assert_eq!(tree.kind, FileTreeNodeKind::Directory);
        let children = tree.children.expect("directory children");
        let names: Vec<&str> = children.iter().map(|node| node.name.as_str()).collect();
        assert_eq!(names, vec!["docs", "src", "README.md"]);
        assert_eq!(children[0].kind, FileTreeNodeKind::Directory);
        assert_eq!(children[2].kind, FileTreeNodeKind::File);
    }

    #[test]
    fn ensure_within_root_accepts_existing_nested_path() {
        let dir = fixture_workspace();
        let resolved = ensure_within_root(&dir.path().join("src").join("main.rs"), dir.path())
            .expect("path inside root");
        assert!(resolved.ends_with("main.rs"));
    }

    #[test]
    fn ensure_within_root_accepts_new_path_inside_root() {
        let dir = fixture_workspace();
        let target = dir.path().join("new_file.txt");
        let resolved = ensure_within_root(&target, dir.path()).expect("new path inside root");
        assert!(resolved.ends_with("new_file.txt"));
    }

    #[test]
    fn ensure_within_root_rejects_paths_outside_workspace() {
        let dir = fixture_workspace();
        let outside = dir.path().join("..").join("escape.txt");

        assert!(matches!(
            ensure_within_root(&outside, dir.path()),
            Err(FsError::OutsideWorkspace)
        ));
    }

    #[test]
    fn ensure_within_root_rejects_absolute_path_outside_workspace() {
        let dir = fixture_workspace();
        let outside = tempfile::tempdir().unwrap();
        let target = outside.path().join("other.txt");

        assert!(matches!(
            ensure_within_root(&target, dir.path()),
            Err(FsError::OutsideWorkspace)
        ));
    }
}
