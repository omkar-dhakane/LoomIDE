import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

const AI_CHUNK_EVENT = "ai-chat-chunk";

export interface AiChatMessage {
  role: string;
  content: string;
}

export interface AiChatRequest {
  requestId: string;
  provider: string;
  model: string;
  apiKey?: string;
  messages: AiChatMessage[];
}

export interface AiChatChunk {
  requestId: string;
  delta: string;
  done: boolean;
  error: string | null;
}

export function aiProviders(): Promise<string[]> {
  return invoke("ai_providers");
}

/** Fire-and-forget: responses arrive as `ai-chat-chunk` events. */
export function startAiChat(request: AiChatRequest): Promise<void> {
  return invoke("ai_chat", { request });
}

/** Non-streaming: returns the full response text (used by diff review). */
export function aiComplete(request: AiChatRequest): Promise<string> {
  return invoke("ai_complete", { request });
}

export function aiSetApiKey(provider: string, key: string): Promise<void> {
  return invoke("ai_set_api_key", { provider, key });
}

export function aiGetApiKey(provider: string): Promise<string> {
  return invoke("ai_get_api_key", { provider });
}

export function listenToAiChunks(
  handler: (chunk: AiChatChunk) => void,
): Promise<UnlistenFn> {
  return listen<AiChatChunk>(AI_CHUNK_EVENT, (event) => handler(event.payload));
}
