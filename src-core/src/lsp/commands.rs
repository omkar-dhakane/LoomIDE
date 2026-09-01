use super::client::{LspClient, LspError};
use super::LspState;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, State};

fn client(state: &State<'_, LspState>, server_id: &str) -> Result<Arc<LspClient>, String> {
    state
        .clients
        .lock()
        .map_err(|_| "LSP state is unavailable".to_string())?
        .get(server_id)
        .cloned()
        .ok_or_else(|| LspError::NotRunning(server_id.to_string()).to_string())
}

#[tauri::command]
pub async fn lsp_start(
    server_id: String,
    command: String,
    args: Vec<String>,
    root_uri: String,
    app: AppHandle,
    state: State<'_, LspState>,
) -> Result<(), String> {
    {
        let clients = state
            .clients
            .lock()
            .map_err(|_| "LSP state is unavailable".to_string())?;
        if clients.contains_key(&server_id) {
            return Ok(());
        }
    }

    let client = LspClient::spawn(server_id.clone(), &command, &args, app)
        .map_err(|error| error.to_string())?;

    let initialize = json!({
        "processId": std::process::id(),
        "rootUri": root_uri,
        "capabilities": {
            "textDocument": {
                "synchronization": {
                    "didSave": false,
                    "dynamicRegistration": false
                },
                "completion": {
                    "completionItem": {
                        "snippetSupport": false
                    }
                },
                "hover": {
                    "contentFormat": ["markdown", "plaintext"]
                },
                "publishDiagnostics": {}
            }
        },
        "clientInfo": {
            "name": "LoomIDE"
        }
    });

    client
        .request("initialize", initialize)
        .await
        .map_err(|error| error.to_string())?;
    client
        .notify("initialized", json!({}))
        .await
        .map_err(|error| error.to_string())?;

    state
        .clients
        .lock()
        .map_err(|_| "LSP state is unavailable".to_string())?
        .insert(server_id, client);

    Ok(())
}

#[tauri::command]
pub async fn lsp_stop(server_id: String, state: State<'_, LspState>) -> Result<(), String> {
    let client = state
        .clients
        .lock()
        .map_err(|_| "LSP state is unavailable".to_string())?
        .remove(&server_id);

    if let Some(client) = client {
        client.shutdown().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn lsp_did_open(
    server_id: String,
    uri: String,
    language_id: String,
    version: i64,
    text: String,
    state: State<'_, LspState>,
) -> Result<(), String> {
    client(&state, &server_id)?
        .notify(
            "textDocument/didOpen",
            json!({
                "textDocument": {
                    "uri": uri,
                    "languageId": language_id,
                    "version": version,
                    "text": text
                }
            }),
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn lsp_did_change(
    server_id: String,
    uri: String,
    version: i64,
    text: String,
    state: State<'_, LspState>,
) -> Result<(), String> {
    client(&state, &server_id)?
        .notify(
            "textDocument/didChange",
            json!({
                "textDocument": {
                    "uri": uri,
                    "version": version
                },
                "contentChanges": [{ "text": text }]
            }),
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn lsp_did_close(
    server_id: String,
    uri: String,
    state: State<'_, LspState>,
) -> Result<(), String> {
    client(&state, &server_id)?
        .notify(
            "textDocument/didClose",
            json!({
                "textDocument": { "uri": uri }
            }),
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn lsp_completion(
    server_id: String,
    uri: String,
    line: u32,
    character: u32,
    state: State<'_, LspState>,
) -> Result<Value, String> {
    client(&state, &server_id)?
        .request(
            "textDocument/completion",
            json!({
                "textDocument": { "uri": uri },
                "position": { "line": line, "character": character }
            }),
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn lsp_hover(
    server_id: String,
    uri: String,
    line: u32,
    character: u32,
    state: State<'_, LspState>,
) -> Result<Value, String> {
    client(&state, &server_id)?
        .request(
            "textDocument/hover",
            json!({
                "textDocument": { "uri": uri },
                "position": { "line": line, "character": character }
            }),
        )
        .await
        .map_err(|error| error.to_string())
}
