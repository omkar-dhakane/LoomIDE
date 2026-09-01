import { useCallback, useEffect, useRef, useState } from "react";
import { SendHorizonal, Trash2 } from "lucide-react";
import { listenToAiChunks, startAiChat, type AiChatMessage } from "../ipc/ai";
import type { OpenFile } from "../types/fs";

interface ChatPanelProps {
  activeFile: OpenFile | null;
}

const STORAGE_KEYS = {
  provider: "loomide.ai.provider",
  model: "loomide.ai.model",
  apiKey: "loomide.ai.apiKey",
};

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5",
  ollama: "llama3.1",
};

const PROVIDERS = ["openai", "anthropic", "ollama"];

interface UiMessage {
  role: "user" | "assistant" | "error";
  content: string;
}

function loadStored(key: string, fallback: string): string {
  return localStorage.getItem(key) ?? fallback;
}

export function ChatPanel({ activeFile }: ChatPanelProps) {
  const [provider, setProvider] = useState(() => loadStored(STORAGE_KEYS.provider, "openai"));
  const [model, setModel] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.model);
    return stored ?? DEFAULT_MODELS[loadStored(STORAGE_KEYS.provider, "openai")];
  });
  const [apiKey, setApiKey] = useState(() => loadStored(STORAGE_KEYS.apiKey, ""));
  const [includeFile, setIncludeFile] = useState(true);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  // Current in-flight request: a mutable slot the chunk listener writes into.
  const streamRef = useRef<{ requestId: string; text: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.provider, provider);
    localStorage.setItem(STORAGE_KEYS.model, model);
    localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);
  }, [provider, model, apiKey]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listenToAiChunks((chunk) => {
      const active = streamRef.current;
      if (!active || chunk.requestId !== active.requestId) {
        return;
      }

      if (chunk.error) {
        active.text = chunk.error;
        setMessages((current) => {
          const next = [...current];
          next[next.length - 1] = { role: "error", content: chunk.error ?? "Unknown error" };
          return next;
        });
      } else {
        active.text += chunk.delta;
        const text = active.text;
        setMessages((current) => {
          const next = [...current];
          next[next.length - 1] = { role: "assistant", content: text };
          return next;
        });
      }

      if (chunk.done) {
        streamRef.current = null;
        setStreaming(false);
      }
    }).then((unsub) => {
      unlisten = unsub;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) {
      return;
    }

    const contextMessages: AiChatMessage[] = [];
    if (includeFile && activeFile) {
      contextMessages.push({
        role: "system",
        content: `The user is editing ${activeFile.path}. Current contents:\n\n${activeFile.contents}`,
      });
    }

    const history: AiChatMessage[] = messages
      .filter((message) => message.role !== "error")
      .map((message) => ({ role: message.role, content: message.content }));
    history.push({ role: "user", content: text });

    const requestId =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;

    streamRef.current = { requestId, text: "" };
    setMessages((current) => [
      ...current,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ]);
    setInput("");
    setStreaming(true);

    try {
      await startAiChat({
        requestId,
        provider,
        model,
        apiKey: apiKey || undefined,
        messages: [...contextMessages, ...history],
      });
    } catch (error) {
      streamRef.current = null;
      setStreaming(false);
      setMessages((current) => {
        const next = [...current];
        next[next.length - 1] = { role: "error", content: String(error) };
        return next;
      });
    }
  }, [input, streaming, includeFile, activeFile, messages, provider, model, apiKey]);

  return (
    <div className="chat-panel">
      <div className="chat-settings">
        <select
          className="chat-select"
          value={provider}
          onChange={(event) => {
            const next = event.target.value;
            setProvider(next);
            setModel(DEFAULT_MODELS[next] ?? "");
          }}
        >
          {PROVIDERS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <input
          className="chat-input-compact"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="model"
          spellCheck={false}
        />
        {provider !== "ollama" && (
          <input
            className="chat-input-compact"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="API key"
            spellCheck={false}
          />
        )}
        <label className="chat-attach" title="Attach the active file as context">
          <input
            type="checkbox"
            checked={includeFile}
            onChange={(event) => setIncludeFile(event.target.checked)}
          />
          <span>Include {activeFile ? activeFile.name : "file"}</span>
        </label>
      </div>

      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="chat-empty">Ask anything about your code.</div>
        ) : (
          messages.map((message, index) => (
            <div key={index} className={`chat-message ${message.role}`}>
              {message.content || (message.role === "assistant" && streaming ? "…" : "")}
            </div>
          ))
        )}
      </div>

      <div className="chat-input-row">
        <textarea
          className="chat-textarea"
          value={input}
          placeholder="Ask Loom…"
          rows={2}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleSend();
            }
          }}
        />
        <button
          className="icon-button"
          type="button"
          title="Clear chat"
          disabled={streaming && messages.length === 0}
          onClick={() => setMessages([])}
        >
          <Trash2 size={15} />
        </button>
        <button
          className="icon-button chat-send"
          type="button"
          title="Send"
          disabled={streaming || !input.trim()}
          onClick={() => void handleSend()}
        >
          <SendHorizonal size={15} />
        </button>
      </div>
    </div>
  );
}
