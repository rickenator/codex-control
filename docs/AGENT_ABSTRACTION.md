# Agent Abstraction

## Objective

Replace the hardcoded Codex dependency with a pluggable `AgentAdapter` interface so Consiglio can host Codex, Open Interpreter, Aider, Claude Code, and future CLI-based agents behind one normalized event model.

## Status

- [x] Phase 1: Extract `CodexAdapter`
- [x] Phase 2: Add `OpenInterpreterAdapter`
- [x] Phase 3: Unify UI labels and configuration language
- [x] Phase 4: Add `AiderAdapter`
- [x] Phase 5: Add `ClaudeCodeAdapter`
- [x] Phase 6a: Automated discussion orchestration tests
- [ ] Phase 6b: Integration testing against real agent CLIs
- [x] Phase 7a: Agent selection in the discussion panel
- [ ] Phase 7b: Readiness-backed selection and single-agent adapter selection

The original `agent-abstract` branch was merged into `slave` in PR #18. Non-Codex adapters remain preview integrations until the real-agent matrix in [`RELEASE_READINESS.md`](RELEASE_READINESS.md) passes.

## Architecture

```text
App.tsx
  ├── DiscussionPanel.tsx
  │     └── DiscussionSession
  │           └── injected/lazy AgentAdapter factory
  └── SessionList.tsx / EventTimeline.tsx
        └── AgentAdapter
              ├── CodexAdapter
              ├── OpenInterpreterAdapter
              ├── AiderAdapter
              └── ClaudeCodeAdapter
```

`DiscussionSession` is intentionally importable without Electron or native PTY modules. Automated tests inject fake adapters; production lazily loads the real adapter registry.

## Adapter contract

Each adapter implements:

- `launch(options) -> Promise<AgentSession>` — start the CLI process and establish adapter state.
- `sendPrompt(sessionId, input) -> Promise<string>` — return accumulated text directly, or an empty string when responses arrive through streamed events.
- `stopSession(sessionId) -> Promise<boolean>` — stop the process and remove adapter state.
- `reconnectSession(sessionId) -> Promise<boolean>` — restore persistent state when supported.

Adapters also expose installation/version detection for startup and selection UI, although readiness detection is not yet part of the core `AgentAdapter` interface.

## Output normalization

All adapters emit through the same `EventEmitters` interface:

- `emitEvent(event: AgentEvent)` — normalized responses, code, console output, errors, files, and system events.
- `emitApproval(approval: AgentApproval)` — normalized approval requests.
- `emitTerminalOutput(sessionId, data)` — raw PTY activity for diagnostics.

The discussion orchestrator maps streamed response events back to the owning agent session, waits for a configurable quiet period, and records one attributed discussion message per turn.

## Current limitations

- Real CLI compatibility is not yet proven for Open Interpreter, Aider, or Claude Code.
- Approval decisions are not yet routed back through every adapter.
- Only Codex has a persistent thread/reconnection design.
- Agent readiness is not yet reflected in the discussion selector.

## Last updated

2026-07-14
