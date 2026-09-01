use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

const LSP_DIAGNOSTICS_EVENT: &str = "lsp-diagnostics";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Error)]
pub enum LspError {
    #[error("Language server `{0}` is not running")]
    NotRunning(String),
    #[error("Failed to spawn language server `{command}`: {source}")]
    Spawn {
        command: String,
        source: std::io::Error,
    },
    #[error("Timed out waiting for the language server")]
    Timeout,
    #[error("Language server error {code}: {message}")]
    Rpc { code: i64, message: String },
    #[error("I/O error talking to the language server: {0}")]
    Io(#[from] std::io::Error),
    #[error("Malformed message from the language server")]
    Malformed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspDiagnostics {
    pub server_id: String,
    pub uri: String,
    pub diagnostics: Value,
}

type PendingRequests = Mutex<HashMap<u64, oneshot::Sender<Result<Value, LspError>>>>;

pub struct LspClient {
    server_id: String,
    next_id: AtomicU64,
    stdin: Mutex<ChildStdin>,
    child: Mutex<Child>,
    pending: Arc<PendingRequests>,
}

impl LspClient {
    pub fn spawn(
        server_id: String,
        command: &str,
        args: &[String],
        app: AppHandle,
    ) -> Result<Arc<Self>, LspError> {
        let mut child = Command::new(command)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|source| LspError::Spawn {
                command: command.to_string(),
                source,
            })?;

        let stdout = child.stdout.take().ok_or(LspError::Malformed)?;
        let stdin = child.stdin.take().ok_or(LspError::Malformed)?;

        let pending: Arc<PendingRequests> = Arc::new(Mutex::new(HashMap::new()));
        let client = Arc::new(Self {
            server_id: server_id.clone(),
            next_id: AtomicU64::new(1),
            stdin: Mutex::new(stdin),
            child: Mutex::new(child),
            pending: pending.clone(),
        });

        tokio::spawn(read_loop(
            BufReader::new(stdout),
            server_id,
            pending,
            app,
            Arc::downgrade(&client),
        ));

        Ok(client)
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value, LspError> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();

        self.pending.lock().await.insert(id, tx);
        let message = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });

        if let Err(error) = self.write(&message).await {
            self.pending.lock().await.remove(&id);
            return Err(error);
        }

        match tokio::time::timeout(REQUEST_TIMEOUT, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(LspError::NotRunning(self.server_id.clone())),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                Err(LspError::Timeout)
            }
        }
    }

    pub async fn notify(&self, method: &str, params: Value) -> Result<(), LspError> {
        let message = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        });
        self.write(&message).await
    }

    pub async fn shutdown(&self) {
        let _ = self.request("shutdown", Value::Null).await;
        let _ = self.notify("exit", Value::Null).await;
        let _ = self.child.lock().await.kill().await;
    }

    async fn write(&self, message: &Value) -> Result<(), LspError> {
        let body = serde_json::to_vec(message).map_err(|_| LspError::Malformed)?;
        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes())
            .await?;
        stdin.write_all(&body).await?;
        stdin.flush().await?;
        Ok(())
    }
}

async fn read_loop(
    mut reader: BufReader<tokio::process::ChildStdout>,
    server_id: String,
    pending: Arc<PendingRequests>,
    app: AppHandle,
    client: std::sync::Weak<LspClient>,
) {
    while let Ok(Some(message)) = read_message(&mut reader).await {
        handle_message(message, &server_id, &pending, &app, &client).await;
    }

    // Server exited or stream broke: fail everything still in flight.
    let mut pending = pending.lock().await;
    for (_, tx) in pending.drain() {
        let _ = tx.send(Err(LspError::NotRunning(server_id.clone())));
    }
}

async fn read_message(
    reader: &mut BufReader<tokio::process::ChildStdout>,
) -> Result<Option<Value>, LspError> {
    let mut content_length: Option<usize> = None;
    let mut line = String::new();

    loop {
        line.clear();
        let read = reader.read_line(&mut line).await?;
        if read == 0 {
            return Ok(None);
        }
        let header = line.trim();
        if header.is_empty() {
            break;
        }
        if let Some(value) = header
            .strip_prefix("Content-Length:")
            .or_else(|| header.strip_prefix("content-length:"))
        {
            content_length = value.trim().parse::<usize>().ok();
        }
    }

    let length = content_length.ok_or(LspError::Malformed)?;
    let mut body = vec![0u8; length];
    reader.read_exact(&mut body).await?;
    let message = serde_json::from_slice(&body).map_err(|_| LspError::Malformed)?;
    Ok(Some(message))
}

async fn handle_message(
    message: Value,
    server_id: &str,
    pending: &Arc<PendingRequests>,
    app: &AppHandle,
    client: &std::sync::Weak<LspClient>,
) {
    let id = message.get("id").and_then(Value::as_u64);
    let method = message.get("method").and_then(Value::as_str);

    match (id, method) {
        // Response to one of our requests.
        (Some(id), None) => {
            let sender = pending.lock().await.remove(&id);
            if let Some(tx) = sender {
                let result = if let Some(error) = message.get("error") {
                    Err(LspError::Rpc {
                        code: error.get("code").and_then(Value::as_i64).unwrap_or(-1),
                        message: error
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("unknown error")
                            .to_string(),
                    })
                } else {
                    Ok(message.get("result").cloned().unwrap_or(Value::Null))
                };
                let _ = tx.send(result);
            }
        }
        // Request from the server: reply with null and move on.
        (Some(id), Some(_)) => {
            if let Some(client) = client.upgrade() {
                let mut response = Map::new();
                response.insert("jsonrpc".to_string(), json!("2.0"));
                response.insert("id".to_string(), json!(id));
                response.insert("result".to_string(), Value::Null);
                let _ = client.write(&Value::Object(response)).await;
            }
        }
        // Notification from the server.
        (None, Some("textDocument/publishDiagnostics")) => {
            if let Some(params) = message.get("params") {
                let payload = LspDiagnostics {
                    server_id: server_id.to_string(),
                    uri: params
                        .get("uri")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    diagnostics: params.get("diagnostics").cloned().unwrap_or(Value::Null),
                };
                let _ = app.emit(LSP_DIAGNOSTICS_EVENT, payload);
            }
        }
        (None, Some(_)) | (None, None) => {}
    }
}
