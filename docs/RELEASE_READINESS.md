# Consiglio Release Readiness Gate

Consiglio is ready for a public multi-agent release only when every required row below has a recorded pass on the target operating system. Compilation alone does not qualify an adapter as supported.

## Automated gate

Run from a clean checkout:

```bash
npm ci
npm run verify
```

The pull-request CI must pass on Linux, Windows, and macOS. This includes type checking, unit tests, renderer/main/preload builds, mobile builds, and package generation.

## Real-agent validation matrix

Use a disposable Git repository containing a text file, a small source file, and one intentionally failing test. Record the CLI version, model/provider, operating system, and result for each run.

| Capability | Codex | Open Interpreter | Aider | Claude Code |
| --- | --- | --- | --- | --- |
| Detect installed CLI and version | Required | Required | Required | Required |
| Reject missing or unauthenticated configuration clearly | Required | Required | Required | Required |
| Launch in selected repository | Required | Required | Required | Required |
| Return a plain text response | Required | Required | Required | Required |
| Stream a multi-chunk response without duplication | Required | Required | Required | Required |
| Execute or propose a harmless command | Required | Required | Required | Required |
| Surface an approval request when configured to require approval | Required | Required | Required | Required |
| Reject an approval without hanging the session | Required | Required | Required | Required |
| Modify a disposable file and report the changed path | Required | Required | Required | Required |
| Stop during a response | Required | Required | Required | Required |
| Start a second prompt after the first completes | Required | Required | Required | Required |
| Report non-zero CLI exit with useful diagnostics | Required | Required | Required | Required |
| Recover after application restart | Required | Document unsupported | Document unsupported | Document unsupported |

## Multi-agent discussion gate

Test at least these combinations:

1. Codex direct response plus Open Interpreter streamed response.
2. Codex direct response plus Aider streamed response.
3. Codex direct response plus Claude Code streamed response.
4. Three-agent round-robin discussion.
5. Context-aware routing for a Python request and a shell/Git request.
6. Streamed synthesis using Open Interpreter.
7. One missing or crashing agent during discussion creation.
8. One agent that produces no response before timeout.
9. Stop a discussion while a streamed agent is responding.
10. Send another user message after the previous discussion completes.

A pass requires:

- no 60-second dead wait after response text has already arrived;
- no duplicate response text;
- every message attributed to the correct agent;
- failures surfaced to the renderer rather than only logged;
- all launched agent processes stopped when discussion creation fails or the user stops the discussion.

## Product and documentation gate

Before calling the release generally available:

- The README must distinguish the stable Codex workflow from experimental multi-agent adapters.
- The UI must show only detected agents, including version and readiness state.
- Agent selection must be available outside the discussion panel if single-agent sessions are advertised.
- Unsupported reconnection behavior must be explicit.
- Approval behavior must be verified against each real CLI; parser guesses are not sufficient.
- The release notes must list exact tested CLI versions and operating systems.

## Release decision

Use these labels consistently:

- **Supported:** automated gate and every required real-agent row pass.
- **Preview:** automated gate passes, but one or more real-agent rows remain incomplete.
- **Detected only:** installation detection works, but launch/response behavior has not been validated.

Until the matrix is complete, Codex may be described as supported and the other adapters should be described as preview integrations.
