# Agent approval protocol validation

Issue #20 routes approve and reject decisions to the exact adapter session that emitted a normalized approval request. The automated suite validates ownership, replay protection, session cleanup, desktop/mobile routing, and PTY input sequences.

## Automated validation

| Adapter path | Approval mode | Automated coverage |
| --- | --- | --- |
| Open Interpreter | Interactive confirmation; global `--auto_run` is removed and `--no_auto_run` is enforced | Approve writes `y\n`; reject writes `n\n`; duplicate and cross-session IDs are rejected; stop clears pending IDs |
| Aider | Interactive confirmation; global `--yes` is removed | Approve/reject PTY routing, duplicate protection, and cleanup use the shared approval-aware adapter tests |
| Claude Code | Interactive confirmation; global `--yes` is removed | Approve/reject PTY routing, duplicate protection, and cleanup use the shared approval-aware adapter tests |
| Codex | No normalized interactive approval is currently emitted by `CodexAdapter` | Router behavior is covered independently; Codex remains unchanged until its structured protocol exposes approval requests |

The authenticated mobile bridge is tested to verify that it queries the live router, sends the process decision before returning success, and returns HTTP 409 for replayed decisions. Desktop IPC uses the same router and trusted-renderer checks.

## Real-agent validation gate

Real CLI validation was not available in the GitHub connector environment used to implement this change. Before removing the draft status, run each installed preview adapter against a harmless operation that triggers confirmation and record:

- the exact CLI version;
- the prompt text that generated the normalized approval;
- approve result and continued session output;
- reject result and continued session output;
- stop behavior while an approval is pending;
- whether the CLI requires a response other than `y`/`n`.

Any adapter whose real CLI protocol differs from the shared `y\n` / `n\n` response must receive an adapter-specific protocol mapping before it is advertised as validated.
