import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FilePlus, FolderOpen, FolderPlus, Save } from "lucide-react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { EditorTabs } from "./components/EditorTabs";
import { FileTree } from "./components/FileTree";
import { MonacoEditor } from "./editor/MonacoEditor";
import { languageForPath } from "./editor/language";
import {
  createWorkspaceFile,
  createWorkspaceFolder,
  deleteWorkspacePath,
  listenToWorkspaceEvents,
  openWorkspaceFolder,
  readWorkspaceFile,
  renameWorkspacePath,
  watchWorkspaceFolder,
  writeWorkspaceFile,
} from "./ipc/files";
import type { FileTreeNode, OpenFile } from "./types/fs";
import "./styles.css";

function App() {
  const [rootPath, setRootPath] = useState<string | null>(null);
  const [tree, setTree] = useState<FileTreeNode | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready");
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const activeFile = useMemo(
    () => openFiles.find((file) => file.path === activePath) ?? null,
    [activePath, openFiles],
  );

  const handleOpenFolder = useCallback(async () => {
    setStatus("Opening folder...");
    const result = await openWorkspaceFolder();

    if (!result) {
      setStatus("Ready");
      return;
    }

    const watchedTree = await watchWorkspaceFolder(result.rootPath);
    await unlistenRef.current?.();
    unlistenRef.current = await listenToWorkspaceEvents((event) => {
      if (event.tree) {
        setTree(event.tree);
        setStatus(`${event.kind}: ${event.paths.map(fileName).join(", ")}`);
      }
    });

    setRootPath(result.rootPath);
    setTree(watchedTree);
    setExpandedPaths(new Set([result.rootPath]));
    setOpenFiles([]);
    setActivePath(null);
    setStatus(fileName(result.rootPath));
  }, []);

  const handleToggleDirectory = useCallback((path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleOpenFile = useCallback(
    async (node: FileTreeNode) => {
      const existing = openFiles.find((file) => file.path === node.path);
      if (existing) {
        setActivePath(existing.path);
        return;
      }

      setStatus(`Opening ${node.name}...`);
      const contents = await readWorkspaceFile(node.path);
      setOpenFiles((current) => [
        ...current,
        { path: node.path, name: node.name, contents, dirty: false },
      ]);
      setActivePath(node.path);
      setStatus(node.name);
    },
    [openFiles],
  );

  const handleChangeActiveFile = useCallback(
    (contents: string) => {
      if (!activeFile) {
        return;
      }

      setOpenFiles((current) =>
        current.map((file) =>
          file.path === activeFile.path ? { ...file, contents, dirty: true } : file,
        ),
      );
    },
    [activeFile],
  );

  const handleSave = useCallback(async () => {
    if (!activeFile) {
      return;
    }

    setStatus(`Saving ${activeFile.name}...`);
    await writeWorkspaceFile(activeFile.path, activeFile.contents);
    setOpenFiles((current) =>
      current.map((file) =>
        file.path === activeFile.path ? { ...file, dirty: false } : file,
      ),
    );
    setStatus(`Saved ${activeFile.name}`);
  }, [activeFile]);

  const handleCloseFile = useCallback(
    (path: string) => {
      setOpenFiles((current) => {
        const next = current.filter((file) => file.path !== path);
        if (activePath === path) {
          setActivePath(next[next.length - 1]?.path ?? null);
        }
        return next;
      });
    },
    [activePath],
  );

  const baseDirectory = useCallback((): string | null => {
    if (activeFile) {
      return parentPath(activeFile.path);
    }
    return rootPath;
  }, [activeFile, rootPath]);

  const handleCreateFile = useCallback(async () => {
    const base = baseDirectory();
    if (!base) {
      return;
    }
    const name = promptEntry("New file name");
    if (!name) {
      return;
    }

    try {
      await createWorkspaceFile(joinPath(base, name));
      setStatus(`Created ${name}`);
    } catch (error) {
      setStatus(`Error: ${String(error)}`);
    }
  }, [baseDirectory]);

  const handleCreateFolder = useCallback(async () => {
    const base = baseDirectory();
    if (!base) {
      return;
    }
    const name = promptEntry("New folder name");
    if (!name) {
      return;
    }

    try {
      await createWorkspaceFolder(joinPath(base, name));
      setStatus(`Created folder ${name}`);
    } catch (error) {
      setStatus(`Error: ${String(error)}`);
    }
  }, [baseDirectory]);

  const handleRename = useCallback(
    async (node: FileTreeNode) => {
      const name = promptEntry(`Rename ${node.name} to`, node.name);
      if (!name || name === node.name) {
        return;
      }

      const oldPath = node.path;
      const newPath = joinPath(parentPath(oldPath), name);
      try {
        await renameWorkspacePath(oldPath, newPath);
        renameOpenFiles(oldPath, newPath, node.kind === "directory");
        setStatus(`Renamed to ${name}`);
      } catch (error) {
        setStatus(`Error: ${String(error)}`);
      }
    },
    [activePath],
  );

  const handleDelete = useCallback(
    async (node: FileTreeNode) => {
      const label = node.kind === "directory" ? "folder and its contents" : "file";
      if (!window.confirm(`Delete ${label} "${node.name}"? This cannot be undone.`)) {
        return;
      }

      try {
        await deleteWorkspacePath(node.path);
        closeOpenFiles(node.path, node.kind === "directory");
        setStatus(`Deleted ${node.name}`);
      } catch (error) {
        setStatus(`Error: ${String(error)}`);
      }
    },
    [activePath],
  );

  const renameOpenFiles = useCallback(
    (oldPath: string, newPath: string, isDirectory: boolean) => {
      const remap = (path: string): string => {
        if (path === oldPath) {
          return newPath;
        }
        if (isDirectory && path.startsWith(oldPath)) {
          return newPath + path.slice(oldPath.length);
        }
        return path;
      };

      setOpenFiles((current) =>
        current.map((file) =>
          file.path === remap(file.path)
            ? file
            : { ...file, path: remap(file.path), name: fileName(remap(file.path)) },
        ),
      );
      if (activePath) {
        setActivePath(remap(activePath));
      }
    },
    [activePath],
  );

  const closeOpenFiles = useCallback(
    (path: string, isDirectory: boolean) => {
      const matches = (file: OpenFile) =>
        file.path === path || (isDirectory && file.path.startsWith(path));

      setOpenFiles((current) => {
        const next = current.filter((file) => !matches(file));
        if (activePath && !next.some((file) => file.path === activePath)) {
          setActivePath(next[next.length - 1]?.path ?? null);
        }
        return next;
      });
    },
    [activePath],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  useEffect(() => {
    return () => {
      void unlistenRef.current?.();
    };
  }, []);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <button className="icon-button open-button" type="button" onClick={handleOpenFolder}>
            <FolderOpen size={17} />
            <span>Open Folder</span>
          </button>
          <button
            className="icon-button"
            type="button"
            title="New file"
            disabled={!rootPath}
            onClick={() => void handleCreateFile()}
          >
            <FilePlus size={16} />
          </button>
          <button
            className="icon-button"
            type="button"
            title="New folder"
            disabled={!rootPath}
            onClick={() => void handleCreateFolder()}
          >
            <FolderPlus size={16} />
          </button>
        </div>
        <FileTree
          tree={tree}
          expandedPaths={expandedPaths}
          activePath={activePath}
          onToggleDirectory={handleToggleDirectory}
          onOpenFile={handleOpenFile}
          onRename={(node) => void handleRename(node)}
          onDelete={(node) => void handleDelete(node)}
        />
      </aside>

      <section className="editor-pane">
        <header className="topbar">
          <EditorTabs
            files={openFiles}
            activePath={activePath}
            onActivate={setActivePath}
            onClose={handleCloseFile}
          />
          <button
            className="icon-button save-button"
            type="button"
            disabled={!activeFile || !activeFile.dirty}
            onClick={() => void handleSave()}
            title="Save"
          >
            <Save size={16} />
          </button>
        </header>

        <div className="editor-surface">
          {activeFile ? (
            <MonacoEditor
              value={activeFile.contents}
              language={languageForPath(activeFile.path)}
              onChange={handleChangeActiveFile}
            />
          ) : (
            <div className="empty-editor">{rootPath ? "No file selected" : "No folder open"}</div>
          )}
        </div>

        <footer className="statusbar">
          <span>{status}</span>
          {activeFile ? <span>{activeFile.path}</span> : null}
        </footer>
      </section>
    </main>
  );
}

function fileName(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function parentPath(path: string): string {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separatorIndex > 0 ? path.slice(0, separatorIndex) : path;
}

function joinPath(base: string, name: string): string {
  return `${base.replace(/[\\/]+$/, "")}/${name}`;
}

function promptEntry(label: string, initial = ""): string | null {
  const value = window.prompt(label, initial);
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || /[\\/:*?"<>|]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export default App;
