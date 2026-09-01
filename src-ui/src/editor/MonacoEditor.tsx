import Editor from "@monaco-editor/react";
import { setupMonacoLsp } from "../lsp/monaco";

interface MonacoEditorProps {
  /** Model URI, e.g. file:///C:/project/src/main.ts — must match what the LSP sees. */
  path: string;
  value: string;
  language: string;
  onChange: (value: string) => void;
}

export function MonacoEditor({ path, value, language, onChange }: MonacoEditorProps) {
  return (
    <Editor
      theme="vs-dark"
      path={path}
      language={language}
      value={value}
      onChange={(nextValue) => onChange(nextValue ?? "")}
      onMount={(_editor, monaco) => setupMonacoLsp(monaco)}
      options={{
        automaticLayout: true,
        fontSize: 14,
        fontLigatures: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: "on",
        tabSize: 2,
      }}
    />
  );
}
