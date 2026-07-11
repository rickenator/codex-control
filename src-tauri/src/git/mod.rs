//! Git operations via git CLI subprocesses.
//! 
//! Use the git CLI, not libgit2, for behavioral parity with the developer's shell.
//! Never create or delete worktrees silently — always require explicit user action.

use std::process::Command;

pub fn status(repo_path: &str) -> Result<String, String> {
    let output = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| e.to_string())?;
    
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn diff(repo_path: &str, path: &str) -> Result<String, String> {
    let output = Command::new("git")
        .args(["diff", "--", path])
        .current_dir(repo_path)
        .output()
        .map_err(|e| e.to_string())?;
    
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
