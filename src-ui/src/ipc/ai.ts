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

export function listenToAiChunks(
  handler: (chunk: AiChatChunk) => void,
): Promise<UnlistenFn> {
  return listen<AiChatChunk>(AI_CHUNK_EVENT, (event) => handler(event.payload));
}
