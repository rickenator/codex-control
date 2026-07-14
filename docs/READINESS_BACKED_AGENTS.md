# Readiness-backed agent selection

Consiglio detects agent CLIs asynchronously before enabling them in the discussion selector.

The readiness result records installation, authentication or configuration state, version, diagnostics, support tier, and whether the agent is selectable. Codex is selectable only when its CLI is installed and authenticated. Preview integrations are selectable when their executable answers a version probe; provider and authentication readiness remain explicit as unknown until launch and real-CLI validation.

Use the **Refresh** action in the discussion panel after installing or signing in to an agent. Detection runs with per-command timeouts and returns partial results when another agent check fails.
