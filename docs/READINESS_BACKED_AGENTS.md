# Readiness-backed agent selection

Consiglio detects agent CLIs asynchronously before enabling them in the discussion selector.

The readiness result records installation, authentication or configuration state, version, diagnostics, support tier, and whether the agent is selectable. Codex is selectable only when its CLI is installed and authenticated. Preview integrations are selectable when their executable answers a version probe; provider and authentication readiness remain explicit as unknown until launch and real-CLI validation.

## States

- **Ready:** the executable answered its probe and the known configuration requirements passed.
- **Detected:** the preview CLI answered its probe, but provider or authentication readiness cannot be established safely without launching it.
- **Sign-in required:** Codex is installed but `codex login status` did not confirm authentication.
- **Not installed / timed out / check failed:** the agent remains visible for diagnostics but cannot be selected.

## Executable overrides

The detector honors the same explicit executable variables used by the adapters:

- `CODEX_BIN`
- `OI_BIN`
- `AIDER_BIN`
- `CLAUDE_BIN`

Use the **Refresh** action in the discussion panel after installing, signing in, or changing an executable override. Detection runs with per-command timeouts and returns partial results when another agent check fails.
