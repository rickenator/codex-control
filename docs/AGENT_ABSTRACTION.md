# Agent Abstraction — Goal

## Objective

Replace the hardcoded Codex dependency with a pluggable `AgentAdapter` interface so Consiglio works with Open Interpreter, Aider, Claude Code, and any future CLI-based AI agent — with zero visible difference in the UI.

## Status

- [x] Phase 1: Extract CodexAdapter (complete)
- [x] Phase 2: Add OpenInterpreterAdapter (complete)
- [x] Phase 3: Unify the UI labels and config (complete)
- [x] Phase 4: Add more agents — Aider adapter (complete)
- [x] Phase 5: Add more agents — Claude Code adapter (complete)
- [ ] Phase 6: Integration testing with real agents
- [ ] Phase 7: Agent selection UI in settings

## Branch

`agent-abstract` — isolated from `slave`. Will not be merged until both agents produce identical UI behavior in parallel testing.

## Architecture

```
App.tsx
  └── DiscussionPanel.tsx (multi-agent orchestration)
  └── SessionList.tsx / EventTimeline.tsx (single agent)
        │
        ▼
  getAdapter() → AgentAdapter interface
        ├── CodexAdapter (540 lines, fully implemented)
        ├── OpenInterpreterAdapter (392 lines, fully implemented)
        ├── AiderAdapter (~350 lines, fully implemented)
        └── ClaudeCodeAdapter (~380 lines, fully implemented)
```

## Adapter Contract

Each adapter implements:
- `detectAvailable()` → `AgentInfo[]` — health check and version detection
- `launch(options)` → `AgentSession` — spawn PTY, build args, handle lifecycle
- `sendPrompt(sessionId, input)` → `Promise<boolean>` — write to stdin
- `stopSession(sessionId)` → `Promise<boolean>` — kill PTY, cleanup
- `reconnectSession(sessionId)` → `Promise<boolean>` — restore session (Codex only)

## Output Normalization

All adapters emit through the same `EventEmitters` interface:
- `emitEvent(event: AgentEvent)` — unified event stream
- `emitApproval(approval: AgentApproval)` — approval requests
- `emitTerminalOutput(sessionId, data)` — raw PTY data for activity view

## Last Updated
2026-07-14
