#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod codex;
mod git;
mod security;
mod storage;

use tracing::{info, Level};
use tracing_subscriber::EnvFilter;

fn main() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(Level::INFO.as_str())),
        )
        .try_init();

    info!("Codex Control starting");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Initialize SQLite state store
            storage::init(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Placeholder commands — fleshed out per milestone
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
