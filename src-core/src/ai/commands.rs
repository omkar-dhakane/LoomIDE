use super::{AiRouter, ChatChunk, ChatRequest, AI_CHUNK_EVENT};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

/// Attach the stored API key when the caller did not supply one, so the key
/// never has to round-trip through the webview.
fn with_stored_key(mut request: ChatRequest, app: &AppHandle) -> ChatRequest {
    if request.api_key.is_none() || request.api_key.as_deref() == Some("") {
        if let Ok(Some(key)) = read_key_store(app).map(|mut store| store.remove(&request.provider)) {
            request.api_key = Some(key);
        }
    }
    request
}

/// Non-streaming variant: collects the full response and returns it.
/// Used by the diff-review flow (AI proposes a whole-file rewrite that the
/// user must approve before anything touches disk).
#[tauri::command]
pub async fn ai_complete(request: ChatRequest, app: AppHandle) -> Result<String, String> {
    let request = with_stored_key(request, &app);
    let provider = AiRouter::provider_for(&request.provider).map_err(|error| error.to_string())?;
    let collected = Arc::new(Mutex::new(String::new()));
    let sink = collected.clone();

    provider
        .stream_chat(
            &request,
            Box::new(move |delta| {
                if let Ok(mut buffer) = sink.lock() {
                    buffer.push_str(&delta);
                }
            }),
        )
        .await
        .map_err(|error| error.to_string())?;

    let text = collected
        .lock()
        .map_err(|_| "Response buffer unavailable".to_string())?
        .clone();
    Ok(text)
}

fn key_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("api-keys.json"))
}

fn read_key_store(app: &AppHandle) -> Result<HashMap<String, String>, String> {
    let path = key_store_path(app)?;
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Ok(HashMap::new());
    };
    serde_json::from_str::<Value>(&raw)
        .ok()
        .and_then(|value| value.as_object().cloned())
        .map(|map| {
            map.into_iter()
                .filter_map(|(key, value)| value.as_str().map(|text| (key, text.to_string())))
                .collect()
        })
        .ok_or_else(|| "Failed to parse API key store".to_string())
}

#[tauri::command]
pub fn ai_set_api_key(provider: String, key: String, app: AppHandle) -> Result<(), String> {
    let mut store = read_key_store(&app)?;
    if key.is_empty() {
        store.remove(&provider);
    } else {
        store.insert(provider, key);
    }
    let path = key_store_path(&app)?;
    let json = serde_json::to_string_pretty(&store).map_err(|error| error.to_string())?;
    std::fs::write(path, json).map_err(|error| error.to_string())
}

/// Whether a key exists for a provider. The key itself never leaves the core.
#[tauri::command]
pub fn ai_has_api_key(provider: String, app: AppHandle) -> Result<bool, String> {
    Ok(read_key_store(&app)?.contains_key(&provider))
}

/// List the provider ids the router supports.
#[tauri::command]
pub fn ai_providers() -> Vec<&'static str> {
    AiRouter::available_providers().to_vec()
}

/// Start a streaming chat request. Deltas arrive as `ai-chat-chunk` events
/// carrying the same `requestId`; the final chunk has `done: true`.
#[tauri::command]
pub fn ai_chat(request: ChatRequest, app: AppHandle) -> Result<(), String> {
    let request = with_stored_key(request, &app);
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
