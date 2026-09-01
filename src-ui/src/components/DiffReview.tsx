import { DiffEditor } from "@monaco-editor/react";
import { Check, X } from "lucide-react";

interface DiffReviewProps {
  /** Human-readable label, e.g. the instruction that produced the edit. */
  title: string;
  language: string;
  original: string;
  modified: string;
  generating: boolean;
  onApply: () => void;
  onDiscard: () => void;
}

/**
 * Mandatory gate before any AI-generated content touches disk (see AGENTS.md).
 * Nothing is written until the user presses Apply.
 */
export function DiffReview({
  title,
  language,
  original,
  modified,
  generating,
  onApply,
  onDiscard,
}: DiffReviewProps) {
  return (
    <div className="diff-overlay">
      <div className="diff-modal">
        <div className="diff-header">
          <span className="diff-title">{generating ? "AI is thinking…" : title}</span>
          <div className="diff-actions">
            <button
              className="icon-button"
              type="button"
              disabled={generating}
              onClick={onApply}
              title="Apply changes"
            >
              <Check size={15} />
              <span>Apply</span>
            </button>
            <button className="icon-button" type="button" onClick={onDiscard} title="Discard">
              <X size={15} />
              <span>Discard</span>
            </button>
          </div>
        </div>
        <div className="diff-body">
          <DiffEditor
            theme="vs-dark"
            language={language}
            original={original}
            modified={modified}
            options={{
              readOnly: true,
              renderSideBySide: false,
              minimap: { enabled: false },
              fontSize: 13,
            }}
          />
        </div>
      </div>
    </div>
  );
}
