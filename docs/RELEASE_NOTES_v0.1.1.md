# Consiglio 0.1.1

This release repairs first-run provider setup and makes every active AI connection visible.

## Fixed

- Removed a developer-specific private llama.cpp endpoint from clean-install defaults.
- Correctly recognizes Codex authentication even when `codex login status` writes its result to stderr.
- Stops creating the first task until a working provider has been verified.
- Repairs LAN discovery by preserving Node's `net` and `os` modules in the Electron build.
- Scans the computer's active IPv4 networks instead of a sparse list of guessed addresses.
- Verifies discovered servers through their model API before saving or selecting them.
- Finds Codex from packaged macOS and Windows apps, including npm's Windows command shim and common Homebrew locations.
- Uses a writable Documents workspace for clean packaged installs instead of relying on the process working directory.
- Rebuilds the native PTY dependency for each target Electron runtime.
- Adds Linux, Windows, Intel macOS, and Apple Silicon macOS CI/package gates.
- Upgrades Electron and electron-builder to audited, vulnerability-free release lines.
- Sandboxes the renderer, blocks untrusted navigation and permissions, and enforces a restrictive content security policy.

## First-run provider order

1. Authenticated Codex account.
2. Free local Ollama model.
3. Verified llama.cpp or Ollama server discovered on the local network, after explicit user confirmation.
4. A simple setup screen when no provider is ready.

The conversation header and sidebar now show the active provider, model, and endpoint or Codex account route.

## Publisher

Rick Goldberg, Aniviza LLC Productions

Licensed under Apache 2.0.
