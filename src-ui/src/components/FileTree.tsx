import { ChevronRight, FileText, Folder, Pencil, Trash2 } from "lucide-react";
import type { FileTreeNode } from "../types/fs";

interface FileTreeProps {
  tree: FileTreeNode | null;
  expandedPaths: Set<string>;
  activePath: string | null;
  onToggleDirectory: (path: string) => void;
  onOpenFile: (node: FileTreeNode) => void;
  onRename: (node: FileTreeNode) => void;
  onDelete: (node: FileTreeNode) => void;
}

export function FileTree(props: FileTreeProps) {
  const { tree, ...nodeProps } = props;

  if (!tree) {
    return <div className="tree-empty">No folder open</div>;
  }

  return (
    <div className="tree" role="tree">
      <TreeNode node={tree} depth={0} {...nodeProps} />
    </div>
  );
}

interface TreeNodeProps extends Omit<FileTreeProps, "tree"> {
  node: FileTreeNode;
  depth: number;
}

function TreeNode({
  node,
  depth,
  expandedPaths,
  activePath,
  onToggleDirectory,
  onOpenFile,
  onRename,
  onDelete,
}: TreeNodeProps) {
  const isDirectory = node.kind === "directory";
  const isExpanded = expandedPaths.has(node.path);
  const isActive = activePath === node.path;
  const children = node.children ?? [];

  return (
    <>
      <div
        className={`tree-row${isActive ? " active" : ""}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        role="treeitem"
        aria-expanded={isDirectory ? isExpanded : undefined}
        title={node.path}
        tabIndex={0}
        onClick={() => {
          if (isDirectory) {
            onToggleDirectory(node.path);
            return;
          }
          onOpenFile(node);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") {
            return;
          }
          event.preventDefault();
          if (isDirectory) {
            onToggleDirectory(node.path);
          } else {
            onOpenFile(node);
          }
        }}
      >
        {isDirectory ? (
          <ChevronRight className={`chevron${isExpanded ? " expanded" : ""}`} size={14} />
        ) : (
          <span className="tree-spacer" />
        )}
        {isDirectory ? <Folder size={15} /> : <FileText size={15} />}
        <span className="tree-label">{node.name}</span>
        <span className="tree-actions">
          <button
            className="tree-action"
            type="button"
            title="Rename"
            onClick={(event) => {
              event.stopPropagation();
              onRename(node);
            }}
          >
            <Pencil size={13} />
          </button>
          <button
            className="tree-action danger"
            type="button"
            title="Delete"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(node);
            }}
          >
            <Trash2 size={13} />
          </button>
        </span>
      </div>
      {isDirectory && isExpanded
        ? children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              activePath={activePath}
              onToggleDirectory={onToggleDirectory}
              onOpenFile={onOpenFile}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))
        : null}
    </>
  );
}
