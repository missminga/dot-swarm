import { existsSync } from "node:fs";
import type {
  Adapter,
  NativeEvent,
  NativeRun,
  RunRequest,
  RunResult,
} from "./types.js";
import { killTree, lines, probe, spawnNative } from "./process.js";

export function codexArgs(request: RunRequest): string[] {
  // Global config flags work for both new and resumed exec sessions.
  const flags = [
    "-c",
    'sandbox_mode="read-only"',
    "-c",
    'approval_policy="never"',
  ];
  return request.sessionId
    ? [...flags, "exec", "resume", "--json", request.sessionId, "-"]
    : [...flags, "exec", "--json", "--color", "never", "-"];
}
export class CodexAdapter implements Adapter {
  readonly engine = "codex" as const;
  constructor(
    readonly executable = process.env.DOT_SWARM_CODEX ??
      (existsSync("/opt/homebrew/bin/codex")
        ? "/opt/homebrew/bin/codex"
        : "codex"),
  ) {}
  async dryRun(cwd: string) {
    return {
      ...(await probe(this.executable, cwd)),
      command: [this.executable, ...codexArgs({ cwd, prompt: "<stdin>" })],
    };
  }
  start(request: RunRequest, emit: (e: NativeEvent) => void): NativeRun {
    const child = spawnNative(this.executable, codexArgs(request), request.cwd);
    let settled = false,
      cancelled = false,
      failure: string | undefined,
      completed = false,
      stderr = "";
    let killTimer: NodeJS.Timeout | undefined;
    const stop = () => {
      if (settled) return;
      killTree(child, "SIGTERM");
      killTimer ??= setTimeout(() => killTree(child, "SIGKILL"), 1500);
    };
    const timer = setTimeout(() => {
      failure = "Codex exceeded the mission time limit";
      stop();
    }, request.timeoutMs ?? 600_000);
    const done = new Promise<RunResult>((resolve) => {
      const finish = (code: number | null) => {
        settled = true;
        clearTimeout(timer);
        clearTimeout(killTimer);
        resolve(
          cancelled
            ? { status: "cancelled" }
            : failure || code !== 0 || !completed
              ? {
                  status: "blocked",
                  error:
                    failure ??
                    `Codex exited ${code}; ${stderr || "no turn.completed event (check native login and Git workspace)"}`,
                }
              : { status: "completed" },
        );
      };
      child.on("error", (e) => {
        failure = `Cannot launch Codex at ${this.executable}: ${e.message}`;
      });
      child.stdin.on("error", () => {
        /* close/error reports launch or early exit */
      });
      child.stderr.on("data", (b: Buffer) => {
        stderr = (stderr + b.toString()).slice(-4000);
      });
      child.stdout.on(
        "data",
        lines(
          (line) => {
            try {
              const e = JSON.parse(line);
              if (
                e.type === "thread.started" &&
                typeof e.thread_id === "string"
              )
                emit({ type: "session", id: e.thread_id });
              if (
                e.type === "item.completed" &&
                e.item?.type === "agent_message"
              )
                emit({ type: "text", text: `${e.item.text}\n` });
              else if (e.type === "item.started" || e.type === "item.completed")
                emit({
                  type: "activity",
                  text: `${e.item?.type ?? "item"}: ${e.type}`,
                });
              if (e.type === "turn.completed") completed = true;
              if (e.type === "turn.failed")
                failure = e.error?.message ?? "Codex turn failed";
              // `error` can be a transient reconnect notice; turn.failed / exit are authoritative.
              if (e.type === "error")
                emit({
                  type: "activity",
                  text: String(e.message ?? "Codex connection notice"),
                });
            } catch {
              failure = "Invalid Codex JSON event";
              stop();
            }
          },
          (e) => {
            failure = e.message;
            stop();
          },
        ),
      );
      child.once("close", finish);
    });
    child.stdin.end(request.prompt);
    return {
      done,
      cancel() {
        cancelled = true;
        stop();
      },
      respond() {
        throw new Error(
          "Codex exec has no interactive approval channel; resume in the native CLI.",
        );
      },
    };
  }
}
