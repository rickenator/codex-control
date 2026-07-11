# codex-control

A Linux desktop control plane for Codex CLI — observability and session management.

## Architecture

- **Frontend**: React + TypeScript (Vite)
- **Shell**: Electron (Linux packaging: AppImage + .deb)
- **Native backend**: C++17 compiled as a Node.js native addon (node-addon-api)
- **State**: SQLite (better-sqlite3) + append-only JSONL event logs
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
| M0 | Repository scaffold, Electron shell, C++ native addon stubs, React layout |
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

## Development

```bash
# Install dependencies
npm install

# Build native C++ addon
npm run build:native

# Run dev server (renderer + Electron)
npm run dev:all
```

## Repository layout

```
codex-control/
  native/               # C++17 native addon
    src/addon.cpp       # N-API bindings (process, git, event logging)
    src/node_pty_bridge.h/cpp  # PTY lifecycle management
    binding.gyp         # node-gyp build config
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
