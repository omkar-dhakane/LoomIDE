use super::{ensure_success, stream_lines};
use crate::ai::{AiError, ChatProvider, ChatRequest};
use serde_json::json;

const API_URL: &str = "https://api.openai.com/v1/chat/completions";

#[derive(Default)]
pub struct OpenAi {
    client: reqwest::Client,
}

impl ChatProvider for OpenAi {
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
                .ok_or_else(|| AiError::MissingApiKey("openai".to_string()))?;

            let body = json!({
                "model": request.model,
                "stream": true,
                "messages": request
                    .messages
                    .iter()
                    .map(|message| json!({ "role": message.role, "content": message.content }))
                    .collect::<Vec<_>>(),
            });

            let response = self
                .client
                .post(API_URL)
                .bearer_auth(api_key)
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

/// Parse one SSE line from the OpenAI stream into a content delta.
fn extract_delta(line: &str) -> Option<String> {
    let data = line.strip_prefix("data:")?.trim();
    if data == "[DONE]" {
        return None;
    }
    let json = serde_json::from_str::<serde_json::Value>(data).ok()?;
    json.pointer("/choices/0/delta/content")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::extract_delta;

    #[test]
    fn parses_content_delta() {
        let line = r#"data: {"choices":[{"delta":{"content":"hello"}}]}"#;
        assert_eq!(extract_delta(line).as_deref(), Some("hello"));
    }

    #[test]
    fn ignores_done_marker() {
        assert_eq!(extract_delta("data: [DONE]"), None);
    }

    #[test]
    fn ignores_non_data_lines_and_role_chunks() {
        assert_eq!(extract_delta("event: message"), None);
        assert_eq!(
            extract_delta(r#"data: {"choices":[{"delta":{"role":"assistant"}}]}"#),
            None
        );
        assert_eq!(extract_delta("data: not json"), None);
    }
}
