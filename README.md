<div align="center">
  <img src="build/icons/128x128.png" width="96" height="96" alt="Consiglio icon">
  <h1>Consiglio</h1>
  <p><strong>The desktop workspace for Codex tasks that outlive the terminal.</strong></p>
  <p>Start typing immediately. Consiglio keeps your conversations, files, providers, drafts, and Codex threads ready after restarts and crashes.</p>
  <p>
    <img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache--2.0-5ca8ff?style=flat-square">
    <img alt="Electron" src="https://img.shields.io/badge/shell-Electron-9de4f2?style=flat-square">
    <img alt="React" src="https://img.shields.io/badge/UI-React-61dafb?style=flat-square">
    <img alt="Platforms: Linux, Windows, macOS, Android, iOS" src="https://img.shields.io/badge/platforms-Desktop%20%7C%20Android%20%7C%20iOS-f5c542?style=flat-square">
    <a href="https://github.com/rickenator/Consiglio/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/rickenator/Consiglio?style=flat-square&color=5ca8ff"></a>
  </p>
  <p>
    <a href="https://github.com/rickenator/Consiglio/releases/latest"><strong>Download Consiglio</strong></a>
    &nbsp;&middot;&nbsp;
    <a href="#start-here">Install from source</a>
    &nbsp;&middot;&nbsp;
    <a href="https://github.com/rickenator/Consiglio/issues">Report an issue</a>
  </p>
</div>

---

Consiglio wraps the Codex CLI in a native desktop workflow. It is designed for long-running work rather than disposable chats: tasks reconnect automatically, prompts and responses remain copyable, activity is visible, and repository files can be inspected without leaving the conversation.

## Why Consiglio

Codex is powerful, but serious work rarely fits into one terminal session. Consiglio adds the durable desktop layer: one place to resume tasks, see what the agent is doing, inspect its files, manage providers and credentials, and recover after a shutdown without reconstructing context.

- **No workspace gate.** Open the app and type; the last task reconnects automatically.
- **No mystery waiting.** Streaming activity, commands, errors, and working state remain visible.
- **No lost thread.** Conversations, drafts, repository state, and Codex thread IDs survive restarts.
- **No terminal juggling.** Tasks, file previews, images, providers, approvals, and secrets share one focused window.

> Consiglio is an independent open-source desktop client. It requires a working Codex CLI installation and uses your existing Codex authentication and configuration.

## What It Does

| Surface | Behavior |
| --- | --- |
| **Conversation** | Streams prompts, responses, command activity, errors, and a clear working indicator. |
| **Task rail** | Keeps multiple tasks available and reconnects the last selected task at startup. |
| **Recovery** | Preserves Codex thread IDs, history, repository, provider, and per-task drafts across shutdowns and crashes. |
| **Files** | Browses the active workspace and previews text files and images in the app. |
| **Providers** | Runs the normal Codex profile, GPT-5.6, Ollama, remote llama.cpp, or discovered LAN endpoints. |
| **Secrets** | Encrypts API keys through Electron `safeStorage` and injects scoped environment variables into task processes. |
| **Approvals** | Surfaces command approval requests with the command and affected paths. |
| **Mobile companion** | Monitors sessions, sends prompts, reconnects or stops work, and handles approvals from Android or iOS. |

## Start Here

### Download

Install the latest release from the [Consiglio download page](https://github.com/rickenator/Consiglio/releases/latest):

| Platform | Recommended package | Alternative |
| --- | --- | --- |
| Linux x64 | `.deb` for Debian and Ubuntu | AppImage for other distributions |
| Windows x64 | Setup `.exe` | Portable `.exe` |
| macOS Apple Silicon or Intel | `.dmg` | `.zip` |

Every change is type-checked, tested, built, and packaged on Linux, Windows, and macOS. Release builds include native Intel and Apple Silicon macOS packages.

### Requirements

- A working `codex` executable on `PATH`
- A supported 64-bit desktop platform:
  - Debian/Ubuntu-compatible Linux x64 or another modern x64 distribution using the AppImage
  - Windows 10 or 11 x64
  - macOS 12 Monterey or newer on Intel or Apple Silicon

Node.js 22 or newer and npm are required only when installing from source.

### Android And iOS Companion

The native Capacitor client lives in [`mobile/`](mobile/) and connects to a deliberately narrow bridge hosted by the desktop app. It can view sessions and timelines, send prompts, reconnect or stop tasks, and approve or reject pending commands. It cannot read secrets, change providers, browse arbitrary files, or execute arbitrary bridge commands.

The bridge is disabled by default, binds only to loopback, and is intended to sit behind an authenticated HTTPS tunnel or reverse proxy. The desktop **Mobile** dialog generates and encrypts a one-time pairing token and provides explicit rotation and revocation controls. See [Mobile Companion](docs/MOBILE.md) for pairing, Android/iOS build commands, and the security model.

### Install From Source

```bash
git clone https://github.com/rickenator/Consiglio.git
cd Consiglio
npm install
npm run dev:all
```

That command works in Bash, PowerShell, and Command Prompt. Linux and macOS users can optionally install the convenience launcher:

```bash
mkdir -p ~/bin
ln -sf "$PWD/bin/consiglio" ~/bin/consiglio
```

Make sure `~/bin` is on `PATH`, then launch from any directory:

```bash
consiglio
```

The launcher builds the current checkout and opens the Electron app. No workspace selection is required: Consiglio reconnects the last task when one exists. A packaged clean install creates a writable `Consiglio Workspace` folder in the operating system's Documents directory, with an application-data fallback when Documents is protected.

## Everyday Workflow

1. Launch `consiglio`.
2. Type a request and press Enter.
3. Watch the working indicator and command activity while Codex runs.
4. Open **Files** to inspect generated files, text, or images.
5. Switch tasks from the left rail without losing conversation state.

Use `Shift+Enter` for a newline. Conversation text supports normal selection, copy, paste, and native right-click menus.

## Automatic Provider Setup

On a clean installation, Consiglio verifies providers before creating the first task:

1. An installed and authenticated Codex CLI is used automatically.
2. If Codex is not signed in, a running Ollama installation with a local model is used as the free fallback.
3. Compatible llama.cpp and Ollama servers are discovered automatically by scanning the computer's active local IPv4 networks; the user explicitly confirms a discovered endpoint before prompts are sent to it.
4. If nothing usable responds, Consiglio shows a first-run setup screen instead of creating a broken conversation.

Discovered network endpoints are accepted only when their model API responds and returns at least one model. The active conversation header and sidebar always show where prompts are going: provider, model, and endpoint or Codex account route.

## Crash And Shutdown Recovery

Task state is written to Electron's user-data directory as work happens. On the next launch, Consiglio restores the selected task and reconnects it with the original Codex thread ID.

The following state survives a restart:

- Conversation and activity history
- Codex thread ID
- Repository and branch
- Provider, model, and endpoint identity
- Original task creation time
- Unsent composer draft for each task

If shutdown interrupts a response, Consiglio replaces the stale working state with a visible recovery message. Select **Continue task** to resume the same Codex thread instead of starting a disconnected conversation.

## API Keys And MCP

Open **Secrets** in the conversation header to add credentials. Consiglio stores only encrypted values on disk, restricts the secrets file to the current OS user, and never sends saved values back to the renderer. A saved value can be replaced or removed, but not revealed.

Provider-specific API keys entered under **Providers** use the same operating-system encryption before settings are written. Legacy plaintext provider keys are migrated on the next launch. Consiglio refuses credential storage when Linux exposes only Electron's insecure `basic_text` fallback; configure and unlock a supported system keyring first.

Each credential can be scoped to:

- All task providers
- Codex and OpenAI tasks
- Local and LAN model tasks

Credential updates apply to subsequent Codex task processes, including the next turn in an existing task.

### STDIO MCP Server

Reference the saved environment variable in `~/.codex/config.toml`:

```toml
[mcp_servers.example]
command = "example-mcp"
env_vars = ["EXAMPLE_API_KEY"]
```

### Streamable HTTP MCP Server

```toml
[mcp_servers.example]
url = "https://example.com/mcp"
bearer_token_env_var = "EXAMPLE_API_KEY"
```

The **MCP config** button beside a credential copies both patterns with the correct variable name.

> [!NOTE]
> Local llama.cpp and LAN sessions use isolated Codex profiles by default. Isolation keeps the normal Codex MCP server list out of those sessions; injecting a key does not install or configure an MCP server.

## Providers

### Codex

Uses the normal Codex profile, authentication, model configuration, and MCP configuration from the host.

Consiglio searches `PATH`, `CODEX_BIN`, npm's standard Windows shim directory, and common macOS/Linux CLI locations. This lets an app opened from Finder, Launchpad, or the Windows Start menu find Codex even when the desktop environment has a smaller `PATH` than an interactive terminal.

### Remote llama.cpp

Consiglio configures Codex's OpenAI-compatible provider automatically. Supply the endpoint and model in **Providers**. A typical endpoint is:

```text
http://192.168.1.50:8081
```

The server must support the Responses API shape expected by Codex. The default placeholder API key is `llama.cpp`; replace it only when the server requires authentication.

### Ollama And LAN

Ollama can be selected directly. Compatible llama.cpp servers can also be added manually or discovered on the local network from **Providers**.

## Keyboard And Desktop Behavior

| Action | Shortcut or behavior |
| --- | --- |
| New task | `Ctrl/Cmd+N` |
| Send prompt | `Enter` |
| Newline in prompt | `Shift+Enter` |
| Restore task | Automatic at startup |
| Window size | Remembered between launches |
| Copy and paste | Native menu and standard platform shortcuts |

## Development

Run the complete desktop app:

```bash
npm run dev:all
```

Build all three application targets:

```bash
npm run build
```

Run the full local verification gate:

```bash
npm run verify
```

Build and synchronize both native mobile projects:

```bash
cd mobile
npm ci
npm run sync
```

The Android project is under `mobile/android`; the iOS Xcode project is under `mobile/ios/App`.

## Packaging

Build Linux packages with:

```bash
npm run package:linux
```

This produces an AppImage and a compressed Debian package. Linux is the primary desktop target.

On Windows or macOS, use the corresponding host command:

```text
npm run package:win
npm run package:mac
```

`npm run package:host` selects the correct command for the current operating system. Native packages must be built on their target operating system; the release workflow coordinates those host-native builds.

GitHub Actions also builds release packages for all supported desktop platforms:

| Platform | Release artifacts |
| --- | --- |
| Linux x64 | AppImage and `.deb` |
| Windows x64 | NSIS installer and portable `.exe` |
| macOS x64 | DMG and ZIP |
| macOS arm64 | DMG and ZIP |

Push a version tag matching `package.json`, such as `v0.1.1`, or run the **Release Consiglio** workflow manually with that version. GitHub publishes a release only after every platform package passes validation, and includes `SHA256SUMS.txt` for all artifacts.

Production releases also require Developer ID signing and notarization on macOS and Authenticode signing on Windows. The workflow refuses to publish when those credentials are absent or a signature cannot be verified. Each release includes an SPDX software bill of materials and a Sigstore-backed GitHub artifact attestation; see [Releasing Consiglio](docs/RELEASING.md) for the credential contract and verification commands.

## Architecture

```text
Consiglio
├── bin/consiglio                   durable launcher
├── src/main.ts                     Electron process, Codex runner, persistence
├── src/main/app-protocol.ts        bounded renderer protocol and path validation
├── src/preload.ts                  narrow contextBridge API
├── src/App.tsx                     desktop shell
├── src/features/sessions/          task rail and conversation timeline
├── src/features/files/             workspace browser and previews
├── src/features/secrets/           encrypted credential manager
├── src/main/lan-discovery.ts       local provider discovery
└── tests/fixtures/codex-events/    protocol fixtures
```

The renderer never launches commands or reads credentials directly. Electron's main process owns Codex subprocesses, filesystem access, persistence, provider environment setup, and encryption. The preload bridge exposes a bounded IPC surface to React.

Packaged builds serve renderer assets through Consiglio's private secure protocol rather than privileged `file://` pages. Electron production fuses disable Run-as-Node, Node option injection, command-line inspection, and loading application code outside the ASAR bundle; macOS and Windows additionally enforce Electron's embedded ASAR integrity check.

## Troubleshooting

### A prompt does nothing

Open the task activity and copy the displayed error. Confirm that `codex` runs from a terminal and that the selected provider is reachable.

```bash
codex --version
```

### MCP cannot see a key

Confirm all three parts independently:

1. The credential is enabled in **Secrets**.
2. The MCP server references the exact variable through `env_vars`, `bearer_token_env_var`, or `env_http_headers`.
3. The task uses a Codex profile that contains that MCP server configuration.

Restart or reconnect the task after changing MCP server configuration. Key presence and service/network reachability are separate checks.

### A local provider loses MCP tools

This is expected when local-provider isolation is enabled. Disable isolation only when the local model and provider can safely handle the configured MCP tool schemas.

## Design Rule

Consiglio must not become a toy abstraction over Codex. Every visual action should map to an inspectable task event, command, file operation, provider setting, or protocol message. Errors remain selectable and copyable so failures can be debugged from evidence rather than hidden behind generic UI states.

## License

Copyright 2026 Rick Goldberg, Aniviza LLC Productions.

Licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attribution information.
