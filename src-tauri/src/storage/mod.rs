//! SQLite state store for sessions, tasks, approvals, and event indexes.
//! 
//! Large raw logs are stored as compressed append-only JSONL files referenced by SQLite.

use tauri::AppHandle;

pub fn init(_app: &AppHandle) -> Result<(), String> {
    // TODO: Initialize SQLite database and run migrations
    tracing::info!("Storage initialized");
    Ok(())
}
