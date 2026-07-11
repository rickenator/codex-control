# codex-control

A Linux desktop control plane for Codex CLI — observability and session management, not a replacement for the terminal.

## Architecture

- **Frontend**: Tauri 2 + React + TypeScript
- **Backend**: Rust (privileged boundary only — process/PTY supervision, git, SQLite, IPC)
- **State**: SQLite + append-only JSONL event logs
- **Integration**: Codex app-server protocol (preferred) → CLI adapter (fallback)

## Product surfaces

1. **Workspace dashboard** — projects, branches, active sessions, model/provider status
2. **Session console** — conversation timeline, plan steps, tool calls, approvals
3. **Diff and review** — side-by-side/unified diff, per-hunk accept/reject
4. **Task board** — queued, running, blocked, awaiting approval, completed, failed
5. **Configuration** — provider profiles, MCP servers, sandbox policy, context limits

## Milestones

| Milestone | Description |
|-----------|-------------|
| M0 | Repository scaffold, Tauri shell, SQLite migrations, logging |
| M1 | Codex process/app-server connection and event capture |
| M2 | Prompt/response timeline and reconnect |
| M3 | Approval UI with exact command details |
| M4 | Git status and unified diff |
| M5 | Session browser and persistence |
| M6 | Local llama.cpp provider validation |
| M7 | Packaging for Ubuntu (AppImage + .deb) |
| M8 | Dogfood on a non-ATT-1 project |

## Key design rule

The GUI must never become a simplified toy layer. Every visual action should have an inspectable underlying command, event, file operation, or protocol message. The user should be able to copy the equivalent CLI command whenever one exists.

## Quick start (development)

```bash
# Install Tauri CLI
cargo install tauri-cli --version "^2"

# Install frontend deps
cd src && npm install

# Run dev server
cargo tauri dev
```

## License

Proprietary — do not distribute.
