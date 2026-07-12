# Consiglio

A Linux desktop control plane for Codex CLI — observability and session management.

## Architecture

- **Frontend**: React + TypeScript (Vite)
- **Shell**: Electron (Linux packaging: AppImage + .deb)
- **Terminal backend**: node-pty bridge to the real Codex CLI
- **State**: SQLite (better-sqlite3) + append-only JSONL event logs
- **Integration**: Codex app-server protocol (preferred) → CLI adapter (fallback)

## Product surfaces

1. **Workspace dashboard** — projects, branches, active sessions, model/provider status
2. **Session console** — conversation timeline, plan steps, tool calls, approvals
3. **Diff and review** — side-by-side/unified diff, per-hunk accept/reject
4. **Task board** — queued, running, blocked, awaiting approval, completed, failed
5. **Configuration** — provider profiles, MCP servers, sandbox policy, context limits

## Milestones

| Milestone | Description | Status |
|-----------|-------------|--------|
| M0 | Repository scaffold, Electron shell, C++ native addon stubs, React layout | ✅ Done |
| M1 | Codex process/app-server connection and event capture | ✅ Done |
| M2 | Prompt/response timeline and reconnect | ✅ Done |
| M3 | Approval UI with exact command details | ✅ Done |
| M4 | Git status and unified diff | ✅ Done |
| M5 | Session browser and persistence | ✅ Done |
| M6 | Local llama.cpp provider validation | ✅ Done |
| M7 | Packaging for Ubuntu (AppImage + .deb) | ✅ Done |
| M8 | Dogfood on a non-ATT-1 project | ⏳ Pending |

## Key design rule

The GUI must never become a simplified toy layer. Every visual action should have an inspectable underlying command, event, file operation, or protocol message. The user should be able to copy the equivalent CLI command whenever one exists.

## Development

```bash
# Install dependencies
npm install

# Build and run the Electron app
npm run dev:all
```

## Remote llama.cpp

The new session drawer can launch Codex against a remote `llama-server` endpoint directly.

- Select `Remote llama.cpp` in the new-session panel.
- Enter the server base URL, such as `http://192.168.1.243:8081`.
- Enter the model name used by that server.
- Leave the API key as the default `llama.cpp` unless your server expects something else.
- The app passes the required Codex provider overrides, including `wire_api = "responses"`, for the spawned session.

## Desktop ergonomics

- Window size and maximized state are remembered between launches.
- `Ctrl/Cmd+N` opens the new-session drawer from the native app menu.
- The app uses a real Linux-style application menu for reload, zoom, developer tools, and fullscreen.
- The Settings panel makes local-provider isolation, web search, and multi-agent behavior explicit and persistent.

## Packaging

Build a Linux package with:

```bash
npm run build
npm run package:linux
```

The release command produces both an AppImage and a Debian package. The Debian
package is intentionally uncompressed so local release builds complete
reliably; use the smaller AppImage when download size matters.

## Repository layout

```
consiglio/
  native/               # Legacy native-addon experiments (not packaged at runtime)
  src/                  # Electron + React frontend
    main.ts             # Electron main process
    preload.ts          # contextBridge API
    renderer.tsx        # React entry point
    App.tsx             # Three-pane layout (sessions | timeline | diff/terminal)
    features/           # Feature modules
      sessions/         # Session list, event timeline
      diffs/            # Diff viewer
      approvals/        # Approval queue
      tasks/            # Task board
      workspaces/       # Workspace dashboard
      settings/         # Configuration
    components/         # Shared UI components (TerminalPane, etc.)
  tests/fixtures/codex-events/  # Protocol event fixtures for regression tests
```

## License

Proprietary — do not distribute.
