mod fs;

use fs::commands::{
    create_file, create_folder, delete_path, open_folder, read_file, rename_path, watch_folder,
    write_file,
};
use fs::FsState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(FsState::default())
        .invoke_handler(tauri::generate_handler![
            open_folder,
            read_file,
            write_file,
            create_file,
            create_folder,
            rename_path,
            delete_path,
            watch_folder
        ])
        .run(tauri::generate_context!())
        .expect("failed to run LoomIDE");
}
