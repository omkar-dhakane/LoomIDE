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
                if let Some(delta) = extract_delta(line) {
                    on_delta(delta);
                }
            })
            .await
        })
    }
}

/// Parse one NDJSON line from the Ollama stream into a content delta.
fn extract_delta(line: &str) -> Option<String> {
    let json = serde_json::from_str::<serde_json::Value>(line).ok()?;
    json.pointer("/message/content")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::extract_delta;

    #[test]
    fn parses_message_content() {
        let line = r#"{"model":"llama3.1","message":{"role":"assistant","content":"Hi"},"done":false}"#;
        assert_eq!(extract_delta(line).as_deref(), Some("Hi"));
    }

    #[test]
    fn ignores_final_metadata_line_and_garbage() {
        assert!(extract_delta(r#"{"done":true,"total_duration":123}"#).is_none());
        assert!(extract_delta("not json").is_none());
    }
}
