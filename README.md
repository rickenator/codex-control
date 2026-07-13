# Consiglio

A Linux desktop client for running persistent Codex tasks against OpenAI or local OpenAI-compatible providers.

## Architecture

- **Frontend**: React + TypeScript (Vite)
- **Shell**: Electron (Linux packaging: AppImage + .deb)
- **Codex backend**: structured `codex exec --json` sessions through node-pty
- **State**: persistent JSON task and event history in Electron's user-data directory
- **Files**: workspace browser with text and image previews

## Product surfaces

1. **Task rail** — persistent and automatically reconnected Codex tasks
2. **Conversation** — copyable prompts, responses, tool activity, errors, and working state
3. **Files** — safe workspace browsing with text and inline image previews
4. **Providers** — Codex, remote llama.cpp, Ollama, and configured LAN endpoints

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

# Install the durable launcher
mkdir -p ~/bin
ln -sf "$PWD/bin/consiglio" ~/bin/consiglio

# Start from any directory
consiglio
```

## Remote llama.cpp

New tasks can launch Codex against a remote `llama-server` endpoint directly.

- Select `Remote llama.cpp` under the optional task settings.
- Enter the server base URL, such as `http://192.168.1.243:8081`.
- Enter the model name used by that server.
- Leave the API key as the default `llama.cpp` unless your server expects something else.
- The app passes the required Codex provider overrides, including `wire_api = "responses"`, for the spawned session.

## Desktop ergonomics

- Window size and maximized state are remembered between launches.
- The last task reconnects automatically at startup; a task is created automatically when none exist.
- `Ctrl/Cmd+N` opens the optional folder/task dialog from the native app menu.
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
    App.tsx             # Task rail, conversation, and file-pane shell
    features/           # Feature modules
      sessions/         # Session list, event timeline
      files/            # Workspace file browser and previews
    components/         # Shared UI components (TerminalPane, etc.)
  tests/fixtures/codex-events/  # Protocol event fixtures for regression tests
```

## License

Copyright 2026 Rick. Licensed under the [Apache License 2.0](LICENSE).
