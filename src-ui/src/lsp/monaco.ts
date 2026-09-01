import type { Monaco } from "@monaco-editor/react";
import type * as monacoEditor from "monaco-editor";
import {
  listenToLspDiagnostics,
  lspCompletion,
  lspDefinition,
  lspFormatting,
  lspHover,
  lspReferences,
  lspRename,
} from "../ipc/lsp";
import { serverForLanguage } from "./servers";
import type {
  LspCompletionItem,
  LspDiagnosticsEvent,
  LspHover,
} from "../types/lsp";

interface LspRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

interface LspLocation {
  uri: string;
  range: LspRange;
}

interface LspLocationLink {
  targetUri: string;
  targetRange: LspRange;
  targetSelectionRange?: LspRange;
}

interface LspTextEdit {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  newText: string;
}

interface LspWorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>;
  documentChanges?: Array<{ textDocument: { uri: string }; edits: LspTextEdit[] }>;
}

let initialized = false;

/** Wire LSP completion, hover and diagnostics into Monaco. Runs once. */
export function setupMonacoLsp(monaco: Monaco): void {
  if (initialized) {
    return;
  }
  initialized = true;

  monaco.languages.registerCompletionItemProvider("*", {
    triggerCharacters: [".", ":", "<", '"', "'", "/", "@"],
    provideCompletionItems: async (model, position) => {
      const server = serverForLanguage(model.getLanguageId());
      if (!server) {
        return { suggestions: [] };
      }

      try {
        const raw = (await lspCompletion(
          server.id,
          model.uri.toString(),
          position.lineNumber - 1,
          position.column - 1,
        )) as LspCompletionItem[] | { items?: LspCompletionItem[] } | null;

        const items = Array.isArray(raw) ? raw : (raw?.items ?? []);
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        );

        return {
          suggestions: items.map((item) => ({
            label:
              typeof item.label === "string"
                ? item.label
                : (item.label.label ?? "completion"),
            kind: completionKind(monaco, item.kind),
            detail: item.detail,
            insertText: item.textEdit?.newText ?? item.insertText ?? (typeof item.label === "string" ? item.label : item.label.label),
            range,
          })),
        };
      } catch {
        return { suggestions: [] };
      }
    },
  });

  monaco.languages.registerHoverProvider("*", {
    provideHover: async (model, position) => {
      const server = serverForLanguage(model.getLanguageId());
      if (!server) {
        return null;
      }

      try {
        const hover = (await lspHover(
          server.id,
          model.uri.toString(),
          position.lineNumber - 1,
          position.column - 1,
        )) as LspHover | null;

        const value = hoverText(hover);
        if (!value) {
          return null;
        }
        return { contents: [{ value }] };
      } catch {
        return null;
      }
    },
  });

  void listenToLspDiagnostics((event) => applyDiagnostics(monaco, event));

  monaco.languages.registerDefinitionProvider("*", {
    provideDefinition: async (model, position) => {
      const server = serverForLanguage(model.getLanguageId());
      if (!server) {
        return [];
      }
      try {
        const raw = (await lspDefinition(
          server.id,
          model.uri.toString(),
          position.lineNumber - 1,
          position.column - 1,
        )) as LspLocation | LspLocation[] | LspLocationLink[] | null;
        return normalizeLocations(monaco, raw);
      } catch {
        return [];
      }
    },
  });

  monaco.languages.registerReferenceProvider("*", {
    provideReferences: async (model, position) => {
      const server = serverForLanguage(model.getLanguageId());
      if (!server) {
        return [];
      }
      try {
        const raw = (await lspReferences(
          server.id,
          model.uri.toString(),
          position.lineNumber - 1,
          position.column - 1,
        )) as LspLocation[] | null;
        return (raw ?? []).map((location) => toMonacoLocation(monaco, location));
      } catch {
        return [];
      }
    },
  });

  monaco.languages.registerRenameProvider("*", {
    provideRenameEdits: async (model, position, newName) => {
      const server = serverForLanguage(model.getLanguageId());
      if (!server) {
        return { edits: [] };
      }
      try {
        const raw = (await lspRename(
          server.id,
          model.uri.toString(),
          position.lineNumber - 1,
          position.column - 1,
          newName,
        )) as LspWorkspaceEdit | null;
        return {
          edits: workspaceEditToMonaco(monaco, raw),
        };
      } catch {
        return { edits: [] };
      }
    },
    resolveRenameLocation: async (model, position) => {
      const word = model.getWordAtPosition(position);
      if (!word) {
        return {
          range: new monaco.Range(
            position.lineNumber,
            position.column,
            position.lineNumber,
            position.column,
          ),
          text: "",
        };
      }
      return {
        range: new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        ),
        text: word.word,
      };
    },
  });

  monaco.languages.registerDocumentFormattingEditProvider("*", {
    provideDocumentFormattingEdits: async (model) => {
      const server = serverForLanguage(model.getLanguageId());
      if (!server) {
        return [];
      }
      try {
        const raw = (await lspFormatting(server.id, model.uri.toString())) as
          | LspTextEdit[]
          | null;
        return (raw ?? []).map((edit) => ({
          range: new monaco.Range(
            edit.range.start.line + 1,
            edit.range.start.character + 1,
            edit.range.end.line + 1,
            edit.range.end.character + 1,
          ),
          text: edit.newText,
        }));
      } catch {
        return [];
      }
    },
  });
}

function toMonacoLocation(
  monaco: Monaco,
  location: LspLocation,
): monacoEditor.languages.Location {
  return {
    uri: monaco.Uri.parse(location.uri),
    range: new monaco.Range(
      location.range.start.line + 1,
      location.range.start.character + 1,
      location.range.end.line + 1,
      location.range.end.character + 1,
    ),
  };
}

function normalizeLocations(
  monaco: Monaco,
  raw: LspLocation | LspLocation[] | LspLocationLink[] | null,
): monacoEditor.languages.Location[] {
  if (!raw) {
    return [];
  }
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((entry) => {
    if ("targetUri" in entry) {
      const link = entry;
      const range = link.targetSelectionRange ?? link.targetRange;
      return toMonacoLocation(monaco, { uri: link.targetUri, range });
    }
    return toMonacoLocation(monaco, entry);
  });
}

function workspaceEditToMonaco(
  monaco: Monaco,
  edit: LspWorkspaceEdit | null,
): monacoEditor.languages.IWorkspaceTextEdit[] {
  const edits: monacoEditor.languages.IWorkspaceTextEdit[] = [];
  if (!edit) {
    return edits;
  }

  const pushEdits = (uri: string, textEdits: LspTextEdit[]) => {
    for (const textEdit of textEdits) {
      edits.push({
        resource: monaco.Uri.parse(uri),
        versionId: undefined,
        textEdit: {
          range: new monaco.Range(
            textEdit.range.start.line + 1,
            textEdit.range.start.character + 1,
            textEdit.range.end.line + 1,
            textEdit.range.end.character + 1,
          ),
          text: textEdit.newText,
        },
      });
    }
  };

  if (edit.changes) {
    for (const [uri, textEdits] of Object.entries(edit.changes)) {
      pushEdits(uri, textEdits);
    }
  }
  if (edit.documentChanges) {
    for (const change of edit.documentChanges) {
      pushEdits(change.textDocument.uri, change.edits);
    }
  }

  return edits;
}

function applyDiagnostics(monaco: Monaco, event: LspDiagnosticsEvent): void {
  const model = monaco.editor.getModel(monaco.Uri.parse(event.uri));
  if (!model) {
    return;
  }

  const markers = (event.diagnostics ?? []).map((diagnostic) => ({
    severity: markerSeverity(monaco, diagnostic.severity),
    message: diagnostic.message,
    source: diagnostic.source ?? event.serverId,
    startLineNumber: diagnostic.range.start.line + 1,
    startColumn: diagnostic.range.start.character + 1,
    endLineNumber: diagnostic.range.end.line + 1,
    endColumn: diagnostic.range.end.character + 1,
  }));

  monaco.editor.setModelMarkers(model, "lsp", markers);
}

function completionKind(monaco: Monaco, kind?: number) {
  const map: Record<number, monacoEditor.languages.CompletionItemKind> = {
    1: monaco.languages.CompletionItemKind.Text,
    2: monaco.languages.CompletionItemKind.Method,
    3: monaco.languages.CompletionItemKind.Function,
    4: monaco.languages.CompletionItemKind.Constructor,
    5: monaco.languages.CompletionItemKind.Field,
    6: monaco.languages.CompletionItemKind.Variable,
    7: monaco.languages.CompletionItemKind.Class,
    8: monaco.languages.CompletionItemKind.Interface,
    9: monaco.languages.CompletionItemKind.Module,
    10: monaco.languages.CompletionItemKind.Property,
    11: monaco.languages.CompletionItemKind.Unit,
    12: monaco.languages.CompletionItemKind.Value,
    13: monaco.languages.CompletionItemKind.Enum,
    14: monaco.languages.CompletionItemKind.Keyword,
    17: monaco.languages.CompletionItemKind.File,
    18: monaco.languages.CompletionItemKind.Reference,
    21: monaco.languages.CompletionItemKind.Constant,
    25: monaco.languages.CompletionItemKind.TypeParameter,
  };
  return map[kind ?? 1] ?? monaco.languages.CompletionItemKind.Text;
}

function markerSeverity(monaco: Monaco, severity?: number) {
  switch (severity) {
    case 1:
      return monaco.MarkerSeverity.Error;
    case 2:
      return monaco.MarkerSeverity.Warning;
    case 3:
      return monaco.MarkerSeverity.Info;
    default:
      return monaco.MarkerSeverity.Hint;
  }
}

function hoverText(hover: LspHover | null): string | null {
  if (!hover || !hover.contents) {
    return null;
  }
  const contents = hover.contents;
  if (typeof contents === "string") {
    return contents;
  }
  if (Array.isArray(contents)) {
    const parts = contents.map((part) =>
      typeof part === "string"
        ? part
        : `\`\`\`${part.language}\n${part.value}\n\`\`\``,
    );
    return parts.join("\n\n") || null;
  }
  if ("language" in contents) {
    return `\`\`\`${contents.language}\n${contents.value}\n\`\`\``;
  }
  return contents.value ?? null;
}
