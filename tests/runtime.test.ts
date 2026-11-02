import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Runtime } from "../src/runtime.js";
import { CodexAdapter } from "../src/adapters/codex.js";
import { KimiAdapter } from "../src/adapters/kimi.js";
const fixture = fileURLToPath(
  new URL("./fixtures/native.mjs", import.meta.url),
);
const adapters = {
  codex: new CodexAdapter(fixture),
  kimi: new KimiAdapter(fixture),
};
const wait = async (predicate: () => boolean) => {
  const end = Date.now() + 4000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("Timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};
test("human missions, single-flight, squad aggregation, persistence and shutdown", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dot-swarm-test-"));
  const runtime = new Runtime({
    cwd: dir,
    stateFile: join(dir, "state.json"),
    adapters,
  });
  try {
    const a = runtime.createPersona({
      displayName: "Atlas",
      role: "Builder",
      engine: "codex",
    });
    const b = runtime.createPersona({
      displayName: "Moss",
      role: "Research",
      engine: "kimi",
      parentId: a.id,
    });
    assert.equal(runtime.active.size, 0);
    const squad = runtime.createSquad({
      name: "Crew",
      leadId: a.id,
      memberIds: [a.id, b.id],
    });
    const mission = runtime.assign({ summary: "hang", squadId: squad.id });
    assert.equal(mission.authorization.kind, "human");
    assert.equal(mission.runs.length, 2);
    assert.throws(
      () => runtime.assign({ summary: "overlap", personaIds: [b.id] }),
      /active mission/,
    );
    runtime.cancel(mission.id);
    await wait(() => mission.status === "cancelled");
    const direct = runtime.assign({ summary: "hello", personaIds: [b.id] });
    await wait(() => direct.status === "completed");
    assert.equal(b.status, "idle");
    assert.ok(b.nativeSessionId);
    assert.ok(direct.runs[0].output.includes("hello"));
    await runtime.close();
    const restored = new Runtime({
      cwd: dir,
      stateFile: join(dir, "state.json"),
      adapters,
    });
    assert.equal(restored.active.size, 0);
    assert.equal(restored.state.personas[1].nativeSessionId, b.nativeSessionId);
    await restored.close();
  } finally {
    await runtime.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("interrupted work becomes blocked, never automatically retried", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dot-swarm-test-")),
    file = join(dir, "state.json");
  const runtime = new Runtime({ cwd: dir, stateFile: file, adapters });
  const p = runtime.createPersona({
    displayName: "A",
    role: "R",
    engine: "codex",
  });
  const m = runtime.assign({ summary: "hang", personaIds: [p.id] });
  const interrupted = JSON.parse(await readFile(file, "utf8"));
  await runtime.close();
  await writeFile(file, JSON.stringify(interrupted));
  const restored = new Runtime({ cwd: dir, stateFile: file, adapters });
  assert.equal(restored.state.missions[0].status, "blocked");
  assert.equal(restored.active.size, 0);
  assert.equal(restored.state.personas[0].status, "blocked");
  assert.ok(m.id);
  await restored.close();
  await rm(dir, { recursive: true, force: true });
});
test("Kimi permission maps to needs_person and only explicit response resumes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dot-swarm-test-"));
  const runtime = new Runtime({
    cwd: dir,
    stateFile: join(dir, "state.json"),
    adapters,
  });
  try {
    const p = runtime.createPersona({
      displayName: "Moss",
      role: "R",
      engine: "kimi",
    });
    const m = runtime.assign({ summary: "permission", personaIds: [p.id] });
    await wait(() => p.status === "needs_person");
    runtime.respond(m.runs[0].id, m.runs[0].permission!.id, "once");
    await wait(() => m.status === "completed");
    assert.equal(p.status, "idle");
  } finally {
    await runtime.close();
    await rm(dir, { recursive: true, force: true });
  }
});
