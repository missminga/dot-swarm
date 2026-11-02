import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { CodexAdapter, codexArgs } from "../src/adapters/codex.js";
import { KimiAdapter } from "../src/adapters/kimi.js";
import { lines } from "../src/adapters/process.js";
import type { NativeEvent } from "../src/adapters/types.js";
const fixture = fileURLToPath(
  new URL("./fixtures/native.mjs", import.meta.url),
);
const cwd = process.cwd();
for (const adapter of [new CodexAdapter(fixture), new KimiAdapter(fixture)]) {
  test(`${adapter.engine}: dry-run probes only version`, async () => {
    const result = await adapter.dryRun(cwd);
    assert.equal(result.version, "native-fixture 1.0");
  });
  test(`${adapter.engine}: launch, native session ID, stream and resume`, async () => {
    const events: NativeEvent[] = [];
    const run = adapter.start({ cwd, prompt: "hello" }, (e) => events.push(e));
    assert.equal((await run.done).status, "completed");
    assert.ok(
      events.some((e) => e.type === "text" && e.text.includes("hello")),
    );
    const session = events.find((e) => e.type === "session");
    assert.ok(session?.type === "session");
    const resumed: NativeEvent[] = [];
    assert.equal(
      (
        await adapter.start(
          { cwd, prompt: "again", sessionId: session.id },
          (e) => resumed.push(e),
        ).done
      ).status,
      "completed",
    );
    assert.ok(resumed.some((e) => e.type === "session" && e.id === session.id));
  });
  test(`${adapter.engine}: cancel and deadline release processes`, async () => {
    const run = adapter.start({ cwd, prompt: "hang" }, () => {});
    setTimeout(() => run.cancel(), 80);
    assert.equal((await run.done).status, "cancelled");
    const timeout = await adapter.start(
      { cwd, prompt: "hang", timeoutMs: 80 },
      () => {},
    ).done;
    assert.equal(timeout.status, "blocked");
    assert.match(timeout.error!, /time limit/);
  });
  test(`${adapter.engine}: cancellation after completion does not signal a stale process`, async () => {
    const run = adapter.start({ cwd, prompt: "hello" }, () => {});
    assert.equal((await run.done).status, "completed");
    const originalKill = process.kill;
    let signals = 0;
    process.kill = (() => { signals++; return true; }) as typeof process.kill;
    try {
      run.cancel();
      run.cancel();
      assert.equal(signals, 0);
      assert.equal((await run.done).status, "completed");
    } finally {
      process.kill = originalKill;
    }
  });
  test(`${adapter.engine}: missing binary and protocol failures are visible`, async () => {
    const missing =
      adapter.engine === "codex"
        ? new CodexAdapter("/missing/dot-swarm-cli")
        : new KimiAdapter("/missing/dot-swarm-cli");
    await assert.rejects(() => missing.dryRun(cwd), /CLI missing/);
    assert.equal(
      (await missing.start({ cwd, prompt: "hello" }, () => {}).done).status,
      "blocked",
    );
    for (const prompt of ["fail", "malformed"])
      assert.equal(
        (await adapter.start({ cwd, prompt }, () => {}).done).status,
        "blocked",
      );
  });
}
test("Codex does not treat zero exit without turn completion as success", async () => {
  assert.equal(
    (
      await new CodexAdapter(fixture).start(
        { cwd, prompt: "early-exit" },
        () => {},
      ).done
    ).status,
    "blocked",
  );
  assert.ok(
    codexArgs({ cwd, prompt: "x", sessionId: "thread" }).includes("resume"),
  );
  assert.ok(
    codexArgs({ cwd, prompt: "x" }).includes('sandbox_mode="read-only"'),
  );
});
test("Kimi permission pauses for an explicit choice; stale/invalid decisions fail", async () => {
  const adapter = new KimiAdapter(fixture);
  let resolve!: (e: NativeEvent) => void;
  const permission = new Promise<NativeEvent>((r) => {
    resolve = r;
  });
  const run = adapter.start({ cwd, prompt: "permission" }, (e) => {
    if (e.type === "permission") resolve(e);
  });
  const event = await permission;
  assert.equal(event.type, "permission");
  assert.throws(() => run.respond("approval-1", "invalid"), /Unknown/);
  run.respond("approval-1", "once");
  assert.throws(() => run.respond("approval-1", "once"), /no longer/);
  assert.equal((await run.done).status, "completed");
});
test("JSONL framing preserves split UTF-8 and bounds untrusted lines", () => {
  const seen: string[] = [],
    errors: Error[] = [];
  const feed = lines(
    (s) => seen.push(s),
    (e) => errors.push(e),
  );
  const bytes = Buffer.from("你好\nnext\n");
  feed(bytes.subarray(0, 2));
  feed(bytes.subarray(2));
  assert.deepEqual(seen, ["你好", "next"]);
  feed(Buffer.alloc(1_048_577, "x"));
  assert.equal(errors.length, 1);
});

test("Kimi empty end_turn is blocked, not a successful mission", async () => {
  const result = await new KimiAdapter(fixture).start(
    { cwd, prompt: "empty" },
    () => {},
  ).done;
  assert.equal(result.status, "blocked");
  assert.match(result.error!, /without an assistant response/);
});
