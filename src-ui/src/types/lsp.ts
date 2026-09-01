export interface LanguageServerSpec {
  /** Unique id used as the key for the running server, e.g. "typescript". */
  id: string;
  /** Monaco language ids this server handles, e.g. ["typescript", "javascript"]. */
  languages: string[];
  /** Executable to spawn (must be on PATH). */
  command: string;
  args: string[];
}

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspCompletionItem {
  label: string | { label: string };
  kind?: number;
  detail?: string;
  documentation?: string | { kind: string; value: string };
  insertText?: string;
  textEdit?: { newText: string };
}

export interface LspHover {
  contents:
    | string
    | { kind: string; value: string }
    | { language: string; value: string }
    | Array<{ language: string; value: string } | string>;
}

export interface LspDiagnostic {
  range: LspRange;
  message: string;
  severity?: number;
  source?: string;
}

export interface LspDiagnosticsEvent {
  serverId: string;
  uri: string;
  diagnostics: LspDiagnostic[];
}
