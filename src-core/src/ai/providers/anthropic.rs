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
                let Some(data) = line.strip_prefix("data:") else {
                    return;
                };
                let Ok(json) = serde_json::from_str::<serde_json::Value>(data.trim()) else {
                    return;
                };
                if let Some(delta) = json
                    .pointer("/delta/text")
                    .and_then(serde_json::Value::as_str)
                {
                    on_delta(delta.to_string());
                }
            })
            .await
        })
    }
}
