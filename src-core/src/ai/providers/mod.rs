pub mod anthropic;
pub mod ollama;
pub mod openai;

use crate::ai::AiError;
use futures_util::StreamExt;

/// Read a streaming HTTP body and hand each complete line to `handle_line`.
/// Works for both SSE-style (`data: {...}`) and NDJSON streams: providers
/// decide in `handle_line` how to interpret each line.
pub async fn stream_lines(
    response: reqwest::Response,
    mut handle_line: impl FnMut(&str),
) -> Result<(), AiError> {
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(newline) = buffer.find('\n') {
            let line = buffer[..newline].trim_end_matches('\r').to_string();
            buffer.drain(..=newline);
            if !line.trim().is_empty() {
                handle_line(&line);
            }
        }
    }

    let remaining = buffer.trim();
    if !remaining.is_empty() {
        handle_line(remaining);
    }
    Ok(())
}

/// Check the HTTP status, returning the provider's error body when not OK.
pub async fn ensure_success(response: reqwest::Response) -> Result<reqwest::Response, AiError> {
    if response.status().is_success() {
        Ok(response)
    } else {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        Err(AiError::Provider(format!("HTTP {status}: {body}")))
    }
}
