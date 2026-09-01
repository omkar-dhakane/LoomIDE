import type { Monaco } from "@monaco-editor/react";
import type * as monacoEditor from "monaco-editor";
import { listenToLspDiagnostics, lspCompletion, lspHover } from "../ipc/lsp";
import { serverForLanguage } from "./servers";
import type {
  LspCompletionItem,
  LspDiagnosticsEvent,
  LspHover,
} from "../types/lsp";

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
