# Agent Abstraction — Goal

## Objective

Replace the hardcoded Codex dependency with a pluggable `AgentAdapter` interface so Consiglio works with Open Interpreter, Aider, Claude Code, and any future CLI-based AI agent — with zero visible difference in the UI.

## Status

- [ ] Phase 1: Extract CodexAdapter (2-3 days)
- [ ] Phase 2: Add OpenInterpreterAdapter (1-2 weeks)
- [ ] Phase 3: Unify the UI labels and config (1 week)
- [ ] Phase 4: Add more agents (ongoing)

## Branch

`agent-abstract` — isolated from `slave`. Will not be merged until both agents produce identical UI behavior in parallel testing.

## Design Doc

See `docs/AGENT_ABSTRACTION.md` (this file).

## Last Updated
2026-07-14
