use super::{ensure_success, stream_lines};
use crate::ai::{AiError, ChatProvider, ChatRequest};
use serde_json::json;

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2023-06-01";
const MAX_TOKENS: u32 = 4096;

#[derive(Default)]
pub struct Anthropic {
    client: reqwest::Client,
}

impl ChatProvider for Anthropic {
    fn stream_chat<'a>(
        &'a self,
        request: &'a ChatRequest,
        mut on_delta: Box<dyn FnMut(String) + Send + 'a>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), AiError>> + Send + 'a>>
    {
        Box::pin(async move {
            let api_key = request
                .api_key
                .clone()
                .filter(|key| !key.is_empty())
                .ok_or_else(|| AiError::MissingApiKey("anthropic".to_string()))?;

            // Anthropic takes system prompts separately from the message list.
            let system = request
                .messages
                .iter()
                .filter(|message| message.role == "system")
                .map(|message| message.content.clone())
                .collect::<Vec<_>>()
                .join("\n\n");
            let messages = request
                .messages
                .iter()
                .filter(|message| message.role != "system")
                .map(|message| json!({ "role": message.role, "content": message.content }))
                .collect::<Vec<_>>();

            let mut body = json!({
                "model": request.model,
                "max_tokens": MAX_TOKENS,
                "stream": true,
                "messages": messages,
            });
            if !system.is_empty() {
                body["system"] = json!(system);
            }

            let response = self
                .client
                .post(API_URL)
                .header("x-api-key", api_key)
                .header("anthropic-version", API_VERSION)
                .json(&body)
                .send()
                .await?;
            let response = ensure_success(response).await?;

            stream_lines(response, |line| {
                if let Some(delta) = extract_delta(line) {
                    on_delta(delta);
                }
            })
            .await
        })
    }
}

/// Parse one SSE line from the Anthropic stream into a text delta.
fn extract_delta(line: &str) -> Option<String> {
    let data = line.strip_prefix("data:")?.trim();
    let json = serde_json::from_str::<serde_json::Value>(data).ok()?;
    json.pointer("/delta/text")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::extract_delta;

    #[test]
    fn parses_content_block_delta() {
        let line = r#"data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"fn "}}"#;
        assert_eq!(extract_delta(line).as_deref(), Some("fn "));
    }

    #[test]
    fn ignores_ping_and_message_start_events() {
        assert!(extract_delta(r#"data: {"type":"ping"}"#).is_none());
        assert!(extract_delta("event: ping").is_none());
    }
}
