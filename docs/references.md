# Reference study and verification

Read on 2026-11-02 and rechecked from fresh clones under `/tmp/dot-swarm-refs.u9JDiA`. Reference clones live only under `/tmp`; none were vendored. This repository implements its own small typed domain, process adapters and panel.

| Reference | Read revision | Applied pattern |
|---|---|---|
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | [`ce7073d51254`](https://github.com/deepseek-ai/deepseek-harness/tree/ce7073d51254c26cd63b22a60835b8f948deb447) | Bundle patch, engines.dsh, host lifecycle, client module ABI and sidebar slots. |
| [Superagent](https://github.com/deepseek-ai/dsh-superagent-prototype) | [`6337fc823ce2`](https://github.com/deepseek-ai/dsh-superagent-prototype/tree/6337fc823ce20251c8de8085948165c81aaa701e) | Explicit authorization, tickets, quiet attention policy and host-owned panel. |
| [Harness Ally](https://github.com/BaronCyrus/dsh-harness-ally) | [`987fc0b10b9d`](https://github.com/BaronCyrus/dsh-harness-ally/tree/987fc0b10b9d569b5058f2f56ab70ea8d92ef8f6) | Native session identity and continuity; avoid replaying briefs into generic chat. |
| [Loop Engine](https://github.com/kuun993/dsh-loop-engine) | [`713ef1440a26`](https://github.com/kuun993/dsh-loop-engine/tree/713ef1440a26744f3767d91eb928277c1dcc4c67) | Per-engine process lifetime, ACP capabilities and bounded cancellation. |
| [Kimi Bridge](https://github.com/pandashere/dsh-kimi-bridge) | [`7ae6e68e8b87`](https://github.com/pandashere/dsh-kimi-bridge/tree/7ae6e68e8b87276c659a2f823fe24787c2e1ceae) | Native stream/session IDs; print-mode permission caveats motivated ACP. |
| [Codex Bridge](https://github.com/juyanjy/dsh-codex-bridge) | [`2a09a251cb2c`](https://github.com/juyanjy/dsh-codex-bridge/tree/2a09a251cb2cc2de2e7789993e2d3134df6ddf6a) | Native app-server architecture and honest capability limits; app-server remains a TODO here. |

Harness master was ahead of the published package. Runtime compatibility was verified against **0.2.1-rc.5**, not inferred from master. We used a disposable DSH install and DSH_HOME under `/tmp`, leaving the user's existing DSH profiles untouched.

## Local verification

Final recheck on 2026-11-02: frozen-lockfile install, type checking, **21 passing tests**, build and tarball packaging. Both installed CLI version probes passed; both explicit missing-path probes exited 1 with actionable errors. A fresh disposable DSH profile accepted the link install and served the panel. Browser checks created Atlas (Codex) and Moss (Kimi), rendered their hierarchy edge, and completed a real Kimi ACP `/status` mission. A real Codex no-tool mission returned `DOT_SWARM_OK` with a native session ID. Cancellation after settlement is a regression case: a completed handle must never signal a stale process ID.

- macOS, Node 26.10.0, pnpm 10.32.1.
- `pnpm install`, `pnpm check`, both engine dry runs, explicit missing-binary failures.
- Real subprocess fixture tests for Codex JSONL and Kimi ACP, with streamed output, resume IDs, cancellation, deadlines, permissions and malformed/error events.
- Installed the built bundle with `dsh plugin --profile web add link:/absolute/path/to/dot-swarm` into the temporary profile and launched `dsh web --no-open`.
- Browser verified: DSH sidebar → Dot Swarm → panel link, persona creation, Codex/Kimi cards, a rendered Atlas → Moss hierarchy edge, squad creation, and a completed Kimi `/status` mission with native output.
- Real Codex 0.166.0 no-tool prompt returned `DOT_SWARM_OK`, streamed a native thread ID and assistant message, then completed.
- Real native cancellation passed for both CLIs; Kimi `session/load` resumed the `/status` session successfully.
- Real Kimi 2.4.0 ACP `/status` returned a native session ID and assistant text. A real generation smoke returned `end_turn` without assistant output; this observed case has a regression test and now becomes blocked. No claim that model generation was successfully verified for Kimi on this account.

DSH serves client bundles through its versioned module-loader route. A legacy `/plugins/dsh-dot-swarm/client.js` curl URL is not the compatibility test for this version; actual browser registration and navigation are.

## Sources used for native commands

- [Official Codex non-interactive mode](https://developers.openai.com/codex/noninteractive)
- [Official Codex app-server](https://developers.openai.com/codex/app-server)
- Local `codex --version`, `codex exec --help`, `codex exec resume --help`
- Local `kimi --version`, `kimi --help`, `kimi acp --help`
- [Kimi Code source](https://github.com/MoonshotAI/kimi-code) and the installed CLI's actual ACP wire behavior

Authentication files, raw CLI diagnostics, session databases and temporary DSH login URLs are not repository artifacts.
