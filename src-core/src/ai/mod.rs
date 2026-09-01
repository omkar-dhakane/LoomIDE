pub mod commands;
pub mod providers;

use serde::{Deserialize, Serialize};
use std::future::Future;
use std::pin::Pin;
use thiserror::Error;

pub const AI_CHUNK_EVENT: &str = "ai-chat-chunk";

#[derive(Debug, Error)]
pub enum AiError {
    #[error("Unknown AI provider `{0}`. Available: openai, anthropic, ollama")]
    UnknownProvider(String),
    #[error("Provider `{0}` requires an API key")]
    MissingApiKey(String),
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Provider returned an error: {0}")]
    Provider(String),
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub request_id: String,
    pub provider: String,
    pub model: String,
    pub api_key: Option<String>,
    pub messages: Vec<ChatMessage>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatChunk {
    pub request_id: String,
    pub delta: String,
    pub done: bool,
    pub error: Option<String>,
}

/// A streaming AI provider. Implementations POST to their API and forward
/// each text delta into `on_delta`.
pub trait ChatProvider: Send + Sync {
    fn stream_chat<'a>(
        &'a self,
        request: &'a ChatRequest,
        on_delta: Box<dyn FnMut(String) + Send + 'a>,
    ) -> Pin<Box<dyn Future<Output = Result<(), AiError>> + Send + 'a>>;
}

/// Provider-agnostic router: the only entry point the rest of the app uses.
pub struct AiRouter;

impl AiRouter {
    pub fn provider_for(name: &str) -> Result<Box<dyn ChatProvider>, AiError> {
        match name {
            "openai" => Ok(Box::new(providers::openai::OpenAi::default())),
            "anthropic" => Ok(Box::new(providers::anthropic::Anthropic::default())),
            "ollama" => Ok(Box::new(providers::ollama::Ollama::default())),
            other => Err(AiError::UnknownProvider(other.to_string())),
        }
    }

    pub fn available_providers() -> &'static [&'static str] {
        &["openai", "anthropic", "ollama"]
    }
}
