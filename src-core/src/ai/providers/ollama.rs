use super::{ensure_success, stream_lines};
use crate::ai::{AiError, ChatProvider, ChatRequest};
use serde_json::json;

const DEFAULT_URL: &str = "http://127.0.0.1:11434/api/chat";

#[derive(Default)]
pub struct Ollama {
    client: reqwest::Client,
}

impl ChatProvider for Ollama {
    fn stream_chat<'a>(
        &'a self,
        request: &'a ChatRequest,
        mut on_delta: Box<dyn FnMut(String) + Send + 'a>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), AiError>> + Send + 'a>>
    {
        Box::pin(async move {
            // api_key doubles as an optional base-URL override for remote Ollama hosts.
            let url = request
                .api_key
                .as_deref()
                .filter(|value| !value.is_empty())
                .map(|base| format!("{}/api/chat", base.trim_end_matches('/')))
                .unwrap_or_else(|| DEFAULT_URL.to_string());

            let body = json!({
                "model": request.model,
                "stream": true,
                "messages": request
                    .messages
                    .iter()
                    .map(|message| json!({ "role": message.role, "content": message.content }))
                    .collect::<Vec<_>>(),
            });

            let response = self.client.post(&url).json(&body).send().await?;
            let response = ensure_success(response).await?;

            // Ollama streams NDJSON: one JSON object per line.
            stream_lines(response, |line| {
                let Ok(json) = serde_json::from_str::<serde_json::Value>(line) else {
                    return;
                };
                if let Some(delta) = json
                    .pointer("/message/content")
                    .and_then(serde_json::Value::as_str)
                {
                    on_delta(delta.to_string());
                }
            })
            .await
        })
    }
}
