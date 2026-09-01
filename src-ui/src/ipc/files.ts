import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { FileTreeNode, OpenFolderResult, WorkspaceFsEvent } from "../types/fs";

const FS_EVENT = "workspace-fs-event";

export function openWorkspaceFolder(): Promise<OpenFolderResult | null> {
  return invoke("open_folder");
}

export function readWorkspaceFile(path: string): Promise<string> {
  return invoke("read_file", { path });
}

export function writeWorkspaceFile(path: string, contents: string): Promise<void> {
  return invoke("write_file", { path, contents });
}

export function createWorkspaceFile(path: string): Promise<void> {
  return invoke("create_file", { path });
}

export function createWorkspaceFolder(path: string): Promise<void> {
  return invoke("create_folder", { path });
}

export function renameWorkspacePath(path: string, newPath: string): Promise<void> {
  return invoke("rename_path", { path, newPath });
}

export function deleteWorkspacePath(path: string): Promise<void> {
  return invoke("delete_path", { path });
}

export function watchWorkspaceFolder(path: string): Promise<FileTreeNode> {
  return invoke("watch_folder", { path });
}

export function listenToWorkspaceEvents(
  handler: (event: WorkspaceFsEvent) => void,
): Promise<UnlistenFn> {
  return listen<WorkspaceFsEvent>(FS_EVENT, (event) => handler(event.payload));
}
