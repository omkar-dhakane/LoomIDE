mod ai;
mod fs;
mod lsp;

use ai::commands::{ai_chat, ai_complete, ai_has_api_key, ai_providers, ai_set_api_key};
use fs::commands::{
    create_file, create_folder, delete_path, open_folder, read_file, rename_path, watch_folder,
    write_file,
};
use fs::FsState;
use lsp::commands::{
    lsp_completion, lsp_definition, lsp_did_change, lsp_did_close, lsp_did_open, lsp_formatting,
    lsp_hover, lsp_references, lsp_rename, lsp_start, lsp_stop,
};
use lsp::LspState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(FsState::default())
        .manage(LspState::default())
        .invoke_handler(tauri::generate_handler![
            open_folder,
            read_file,
            write_file,
            create_file,
            create_folder,
            rename_path,
            delete_path,
            watch_folder,
            lsp_start,
            lsp_stop,
            lsp_did_open,
            lsp_did_change,
            lsp_did_close,
            lsp_completion,
            lsp_hover,
            lsp_definition,
            lsp_references,
            lsp_rename,
            lsp_formatting,
            ai_chat,
            ai_complete,
            ai_providers,
            ai_set_api_key,
            ai_has_api_key
        ])
        .run(tauri::generate_context!())
        .expect("failed to run LoomIDE");
}
