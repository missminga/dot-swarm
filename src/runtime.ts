import { randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { addPersona, addSquad, emptyState, MissionInput, missionTargets, persona, setParent, settleMission, type State, type Mission, type Run, type Engine } from './domain.js';
import { CodexAdapter } from './adapters/codex.js';
import { KimiAdapter } from './adapters/kimi.js';
import type { Adapter, NativeRun, NativeEvent } from './adapters/types.js';

export interface RuntimeOptions { cwd: string; stateFile?: string; maxParallel?: number; timeoutMs?: number; adapters?: Record<Engine, Adapter> }
export class Runtime extends EventEmitter {
  readonly cwd: string;
  readonly stateFile: string;
  readonly state: State;
  readonly adapters: Record<Engine, Adapter>;
  readonly active = new Map<string, NativeRun>();
  readonly maxParallel: number;
  private timer?: NodeJS.Timeout;
  private stopping = false;
  persistenceError?: string;
  constructor(readonly options: RuntimeOptions) {
    super(); this.cwd = realpathSync(options.cwd);
    this.maxParallel = options.maxParallel ?? 4;
    this.stateFile = options.stateFile ?? join(homedir(), '.local/state/dot-swarm', createHash('sha256').update(this.cwd).digest('hex').slice(0, 16), 'state.json');
    this.adapters = options.adapters ?? { codex: new CodexAdapter(), kimi: new KimiAdapter() };
    this.state = existsSync(this.stateFile) ? JSON.parse(readFileSync(this.stateFile, 'utf8')) as State : emptyState();
    if (this.state.version !== 1 || !Array.isArray(this.state.personas) || !Array.isArray(this.state.squads) || !Array.isArray(this.state.missions)) throw new Error('Unsupported state file; restore a valid v1 backup.');
    for (const mission of this.state.missions) {
      for (const run of mission.runs) if (run.status === 'working' || run.status === 'needs_person') {
        run.status = 'blocked'; run.error = 'Host stopped during this mission. Review native session before explicitly continuing.'; delete run.permission;
        persona(this.state, run.personaId).status = 'blocked';
      }
      settleMission(mission);
    }
    this.save();
  }
  snapshot() { return { ...this.state, workspace: this.cwd, maxParallel: this.maxParallel, persistenceError: this.persistenceError }; }
  private save() {
    clearTimeout(this.timer); this.timer = undefined;
    mkdirSync(dirname(this.stateFile), { recursive: true, mode: 0o700 });
    const temporary = `${this.stateFile}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    renameSync(temporary, this.stateFile);
  }
  private changed(immediate = true) {
    if (immediate) this.save();
    else if (!this.timer) this.timer = setTimeout(() => {
      try { this.save(); } catch (e) {
        this.persistenceError = `State could not be saved: ${(e as Error).message}`;
        for (const handle of this.active.values()) handle.cancel();
      }
      this.emit('change');
    }, 200);
    this.emit('change');
  }
  createPersona(input: unknown) { const p = addPersona(this.state, input); this.changed(); return p; }
  parent(id: string, parentId: string | null) { setParent(this.state, id, parentId); this.changed(); }
  createSquad(input: unknown) { const s = addSquad(this.state, input); this.changed(); return s; }
  assign(input: unknown): Mission {
    if (this.stopping || this.persistenceError) throw new Error(this.persistenceError ?? 'Host is stopping');
    const data = MissionInput.parse(input), ids = missionTargets(this.state, data);
    if (this.active.size + ids.length > this.maxParallel) throw new Error(`At most ${this.maxParallel} native runs at once; wait or cancel a mission.`);
    for (const id of ids) {
      const p = persona(this.state, id);
      if (p.status === 'working' || p.status === 'needs_person') throw new Error(`${p.displayName} already has an active mission`);
      if (data.continueSession && !p.nativeSessionId) throw new Error(`${p.displayName} has no session to continue`);
    }
    const m: Mission = { id: randomUUID(), summary: data.summary, personaIds: ids, squadId: data.squadId,
      authorization: { kind: 'human', at: new Date().toISOString() }, createdAt: new Date().toISOString(), status: 'working',
      runs: ids.map(personaId => ({ id: randomUUID(), personaId, status: 'working', output: '' })) };
    this.state.missions = this.state.missions.filter(m => m.status === 'working').concat(this.state.missions.filter(m => m.status !== 'working').slice(-29));
    this.state.missions.push(m);
    for (const id of ids) { const p = persona(this.state, id); p.status = 'working'; p.currentTaskSummary = data.summary; }
    this.changed(); // Persist explicit authorization before launching any process.
    for (const run of m.runs) {
      const p = persona(this.state, run.personaId);
      try {
        const handle = this.adapters[p.engine].start({ cwd: this.cwd, prompt: m.summary,
          sessionId: data.continueSession ? p.nativeSessionId : undefined, timeoutMs: this.options.timeoutMs }, e => this.event(run, e));
        this.active.set(run.id, handle);
        void handle.done.then(result => {
          run.status = result.status; run.error = result.error; delete run.permission;
          p.status = result.status === 'blocked' ? 'blocked' : 'idle';
          if (p.status === 'idle') p.currentTaskSummary = null;
          this.active.delete(run.id); settleMission(m); this.changed(false);
        }).catch(e => { this.fail(m, run, (e as Error).message); });
      } catch (e) { this.fail(m, run, (e as Error).message); }
    }
    return m;
  }
  private fail(m: Mission, run: Run, error: string) {
    run.status = 'blocked'; run.error = error; delete run.permission;
    persona(this.state, run.personaId).status = 'blocked'; this.active.delete(run.id); settleMission(m); this.changed(false);
  }
  private event(run: Run, e: NativeEvent) {
    const p = persona(this.state, run.personaId);
    if (e.type === 'session') { p.nativeSessionId = e.id; run.nativeSessionId = e.id; }
    if (e.type === 'text' || e.type === 'activity') run.output = (run.output + (e.type === 'activity' ? `\n· ${e.text}\n` : e.text)).slice(-24000);
    if (e.type === 'permission') { run.permission = e.permission; run.status = 'needs_person'; p.status = 'needs_person'; }
    this.changed(false);
  }
  cancel(missionId: string) {
    const m = this.state.missions.find(m => m.id === missionId);
    if (!m) throw new Error('Unknown mission');
    for (const run of m.runs) this.active.get(run.id)?.cancel();
  }
  respond(runId: string, permissionId: string, optionId: string | null) {
    const run = this.state.missions.flatMap(m => m.runs).find(r => r.id === runId);
    const handle = this.active.get(runId);
    if (!run || !handle || run.permission?.id !== permissionId) throw new Error('Permission is no longer pending');
    handle.respond(permissionId, optionId); delete run.permission; run.status = 'working';
    persona(this.state, run.personaId).status = 'working'; this.changed();
  }
  async close() {
    this.stopping = true;
    const handles = [...this.active.values()];
    for (const h of handles) h.cancel();
    await Promise.all(handles.map(h => h.done));
    this.save(); this.removeAllListeners();
  }
}
