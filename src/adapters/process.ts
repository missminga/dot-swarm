import {
  spawn,
  execFile,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { StringDecoder } from "node:string_decoder";

export async function resolveExecutable(candidate: string): Promise<string> {
  for (const path of isAbsolute(candidate)
    ? [candidate]
    : (process.env.PATH ?? "")
        .split(delimiter)
        .map((p) => join(p, candidate))) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      /* try PATH */
    }
  }
  throw new Error(
    `CLI missing or not executable: ${candidate}. Install/login with the native CLI or set DOT_SWARM_CODEX / DOT_SWARM_KIMI.`,
  );
}
export async function probe(
  candidate: string,
  cwd: string,
): Promise<{ executable: string; version: string }> {
  const executable = await resolveExecutable(candidate);
  const { stdout } = await promisify(execFile)(executable, ["--version"], {
    cwd,
    timeout: 10_000,
    maxBuffer: 65536,
  });
  return { executable, version: stdout.trim() };
}
export function spawnNative(
  executable: string,
  args: string[],
  cwd: string,
): ChildProcessWithoutNullStreams {
  return spawn(executable, args, {
    cwd,
    shell: false,
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
}
export function killTree(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): void {
  if (!child.pid) return;
  try {
    process.platform === "win32"
      ? child.kill(signal)
      : process.kill(-child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}
/** Bounded UTF-8 JSONL framing; rejects runaway lines rather than growing indefinitely. */
export function lines(
  onLine: (line: string) => void,
  onError: (error: Error) => void,
) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let failed = false;
  return (data: Buffer) => {
    if (failed) return;
    pending += decoder.write(data);
    let at: number;
    while ((at = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, at);
      pending = pending.slice(at + 1);
      if (line.length > 1_048_576) {
        failed = true;
        onError(new Error("Native stream line exceeds 1 MiB"));
        return;
      }
      if (line.trim()) onLine(line);
    }
    if (pending.length > 1_048_576) {
      failed = true;
      onError(new Error("Native stream line exceeds 1 MiB"));
    }
  };
}
