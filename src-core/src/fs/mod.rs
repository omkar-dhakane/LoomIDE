pub mod commands;
pub mod tree;

use notify::RecommendedWatcher;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Default)]
pub struct FsState {
    pub root: Mutex<Option<PathBuf>>,
    pub watcher: Mutex<Option<RecommendedWatcher>>,
}
