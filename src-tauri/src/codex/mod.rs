//! Codex integration layer.
//! 
//! Preferred: connect to the Codex app-server or supported SDK/protocol boundary.
//! Fallback: launch Codex CLI as a managed child process using structured output.
//! Last resort: PTY wrapping and terminal scraping (isolated behind an adapter).

pub mod protocol;
