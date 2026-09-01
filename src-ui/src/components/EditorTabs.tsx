import { X } from "lucide-react";
import type { OpenFile } from "../types/fs";

interface EditorTabsProps {
  files: OpenFile[];
  activePath: string | null;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
}

export function EditorTabs({ files, activePath, onActivate, onClose }: EditorTabsProps) {
  return (
    <div className="tabs" role="tablist" aria-label="Open files">
      {files.map((file) => (
        <button
          key={file.path}
          className={`tab${file.path === activePath ? " active" : ""}`}
          type="button"
          role="tab"
          aria-selected={file.path === activePath}
          title={file.path}
          onClick={() => onActivate(file.path)}
        >
          <span className="tab-title">
            {file.name}
            {file.dirty ? <span className="dirty-mark" aria-label="Unsaved changes" /> : null}
          </span>
          <span
            className="tab-close"
            role="button"
            tabIndex={0}
            title="Close"
            onClick={(event) => {
              event.stopPropagation();
              onClose(file.path);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onClose(file.path);
              }
            }}
          >
            <X size={13} />
          </span>
        </button>
      ))}
    </div>
  );
}
