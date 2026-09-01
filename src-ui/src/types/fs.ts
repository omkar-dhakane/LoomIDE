export type FileTreeNodeKind = "file" | "directory";

export interface FileTreeNode {
  name: string;
  path: string;
  kind: FileTreeNodeKind;
  children?: FileTreeNode[];
}

export interface OpenFolderResult {
  rootPath: string;
  tree: FileTreeNode;
}

export type WorkspaceFsEventKind = "created" | "deleted" | "renamed";

export interface WorkspaceFsEvent {
  kind: WorkspaceFsEventKind;
  paths: string[];
  tree?: FileTreeNode;
}

export interface OpenFile {
  path: string;
  name: string;
  contents: string;
  dirty: boolean;
}
