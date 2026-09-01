import Editor from "@monaco-editor/react";

interface MonacoEditorProps {
  value: string;
  language: string;
  onChange: (value: string) => void;
}

export function MonacoEditor({ value, language, onChange }: MonacoEditorProps) {
  return (
    <Editor
      theme="vs-dark"
      language={language}
      value={value}
      onChange={(nextValue) => onChange(nextValue ?? "")}
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
