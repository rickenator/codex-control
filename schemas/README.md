# Protocol Event Schemas

JSON Schema definitions for Codex protocol events. These are used to generate
Rust and TypeScript types via `jsonschema2ts` or equivalent tooling.

Pin versions to specific Codex releases to avoid breakage from protocol churn.

## Files

- `event.json` — base event structure
- `session.json` — session state transitions
- `approval.json` — approval request/response
- `diff.json` — file change events

See `src-tauri/src/codex/protocol.rs` and `src/protocol/` for generated types.
