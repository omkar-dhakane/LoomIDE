pub mod client;
pub mod commands;

use client::LspClient;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;

#[derive(Default)]
pub struct LspState {
    pub clients: Mutex<HashMap<String, Arc<LspClient>>>,
}
