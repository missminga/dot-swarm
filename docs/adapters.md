# Native adapter contract

Dot Swarm owns assignment and process lifetime. The native CLI owns its agent loop, tools, account, instructions, and conversation history. Personas are UI identities; their role labels are not injected as a replacement system prompt. `start()` receives only this mission's text and an optional native session ID.

## Codex

Verified CLI: `/opt/homebrew/bin/codex`, `codex-cli 0.166.0`.

```sh
# New mission. The mission text is sent through stdin, without a shell.
/opt/homebrew/bin/codex \
  -c 'sandbox_mode="read-only"' -c 'approval_policy="never"' \
  exec --json --color never -

# Follow-up, same cwd, mission text again on stdin.
/opt/homebrew/bin/codex \
  -c 'sandbox_mode="read-only"' -c 'approval_policy="never"' \
  exec resume --json THREAD_ID -

# Human handoff in a terminal, from the same workspace:
codex resume THREAD_ID
```

`thread.started` supplies the native ID, `item.started/completed` supplies activity, and completed `agent_message` items supply text. Success requires both `turn.completed` and process exit 0. `turn.failed`, nonzero exit, invalid JSON, and missing completion fail visibly. Transient `error` notifications are activity; they are not alone proof that a turn failed.

`exec` is the deliberate v1 native path documented by [OpenAI non-interactive mode](https://developers.openai.com/codex/noninteractive). It gives bounded runs and native resume without maintaining a custom model loop. TODO: [Codex app-server](https://developers.openai.com/codex/app-server) for token deltas, approvals, turn interrupt/steer and live Desktop docking. Do not claim those are implemented by exec.

Read-only mode constrains Codex's local workspace execution; user-configured MCP servers and other native integrations retain their own policy. Dot Swarm does not add `--dangerously-bypass-*` flags. Review/write tasks requiring broader permissions must be resumed explicitly in the native client for v1.

## Kimi

Verified CLI: `~/.kimi-code/bin/kimi`, `2.4.0`. The argv is exactly `['acp']`, without `--auto` or `--yolo`.

1. Start the CLI in the fixed workspace and send newline-delimited JSON-RPC 2.0 over stdio.
2. `initialize { protocolVersion: 1, clientInfo, clientCapabilities: {} }`.
3. New mission: `session/new { cwd, mcpServers: [] }`. Continue: require `agentCapabilities.loadSession`, then `session/load { cwd, sessionId, mcpServers: [] }`. An unsupported or invalid resume fails rather than secretly starting fresh.
4. `session/prompt { sessionId, prompt: [{ type: 'text', text: mission }] }`.
5. Receive `session/update`: show `agent_message_chunk` text and `tool_call/tool_call_update` activity. Session-load replay is visible, but does not count as new output for completion.
6. For `session/request_permission`, retain the request ID and show the native tool details and options. A human choice sends `{ outcome: { outcome: 'selected', optionId } }`; dismiss sends `{ outcome: { outcome: 'cancelled' } }`. Unknown reverse RPCs return method-not-found. We advertise no client filesystem/terminal capabilities.
7. Require `end_turn` plus a nonempty assistant response for success; cancelled and other stop reasons remain distinct. Empty completion is blocked, with native handoff instructions.
8. Cancel sends `session/cancel { sessionId }`, then terminates the process group. A fresh ACP process can later `session/load` the same native history.

Actual native handoff: `kimi -S SESSION_ID` in the original workspace. `/status` is a useful no-inference smoke mission and follows the same streaming path as other assistant text.

The native CLI's modes and account configuration remain authoritative. No auto-approval is added by the plugin. Permission options can include lasting approval; the human sees the native label and chooses. Full terminal docking, richer question protocols, multiple simultaneous permission requests and lossless activity rendering are TODOs.

### Fallback stance

The installed CLI advertises `kimi -p PROMPT --output-format stream-json` and `kimi -S SESSION_ID -p PROMPT --output-format stream-json`. These are manual diagnostics/fallback commands, **not an automatic adapter fallback**: print-mode permission semantics differ between Kimi versions and can auto-approve tools. If ACP is unavailable, Dot Swarm reports the launch/protocol failure and preserves the mission. Install a compatible CLI or use its interactive session. No silent permission broadening, prompt replay, or second billable attempt.

Kimi 2.4.0 on the development Mac returned no assistant chunks for a short no-tool generation prompt, despite `end_turn`. `/status` did stream correctly. The empty-turn test covers this observed behavior; troubleshooting account/provider/native generation is separate from claiming the orchestration shell succeeded.

## Process and data boundaries

Both adapters use `spawn(executable, argv, { shell: false, cwd, detached: true })` on macOS/Linux. JSONL lines are capped at 1 MiB and decoded across UTF-8 boundaries. Native stderr is capped; only a short tail is surfaced on failure. Missions time out after ten minutes, including human decision time. Cancellation uses SIGTERM with a 1.5-second SIGKILL escalation; normal shutdown waits for run settlement. Windows process-tree behavior is not supported or verified in v1.

Dry runs call only `--version` with a ten-second deadline. They validate executable discovery, not authentication or model entitlement. Missing binaries produce actionable errors and a nonzero CLI exit. Tests use an executable fixture, never paid model calls.
