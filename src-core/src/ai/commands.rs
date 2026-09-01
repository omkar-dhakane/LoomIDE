use super::{AiRouter, ChatChunk, ChatRequest, AI_CHUNK_EVENT};
use tauri::{AppHandle, Emitter};

/// List the provider ids the router supports.
#[tauri::command]
pub fn ai_providers() -> Vec<&'static str> {
    AiRouter::available_providers().to_vec()
}

/// Start a streaming chat request. Deltas arrive as `ai-chat-chunk` events
/// carrying the same `requestId`; the final chunk has `done: true`.
#[tauri::command]
pub fn ai_chat(request: ChatRequest, app: AppHandle) -> Result<(), String> {
    let provider = AiRouter::provider_for(&request.provider).map_err(|error| error.to_string())?;

    tauri::async_runtime::spawn(async move {
        let request_id = request.request_id.clone();
        let emit = |chunk: ChatChunk| {
            let _ = app.emit(AI_CHUNK_EVENT, chunk);
        };

        let result = provider
            .stream_chat(
                &request,
                Box::new({
                    let request_id = request_id.clone();
                    let app = app.clone();
                    move |delta| {
                        let _ = app.emit(
                            AI_CHUNK_EVENT,
                            ChatChunk {
                                request_id: request_id.clone(),
                                delta,
                                done: false,
                                error: None,
                            },
                        );
                    }
                }),
            )
            .await;

        match result {
            Ok(()) => emit(ChatChunk {
                request_id,
                delta: String::new(),
                done: true,
                error: None,
            }),
            Err(error) => emit(ChatChunk {
                request_id,
                delta: String::new(),
                done: true,
                error: Some(error.to_string()),
            }),
        }
    });

    Ok(())
}
