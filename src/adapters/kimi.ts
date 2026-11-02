import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Adapter, NativeEvent, NativeRun, RunRequest, RunResult } from './types.js';
import { killTree, lines, probe, spawnNative } from './process.js';

export class KimiAdapter implements Adapter {
  readonly engine = 'kimi' as const;
  constructor(readonly executable = process.env.DOT_SWARM_KIMI ?? (existsSync(join(homedir(), '.kimi-code/bin/kimi')) ? join(homedir(), '.kimi-code/bin/kimi') : 'kimi')) {}
  async dryRun(cwd: string) { return { ...await probe(this.executable, cwd), command: [this.executable, 'acp'] }; }
  start(request: RunRequest, emit: (e: NativeEvent) => void): NativeRun {
    const child = spawnNative(this.executable, ['acp'], request.cwd);
    let producedOutput = false;
    let sequence = 0, sessionId: string | undefined, cancelled = false, closing = false, stderr = '';
    let outcome: RunResult | undefined, killTimer: NodeJS.Timeout | undefined;
    const pending = new Map<number, { resolve(value: any): void; reject(e: Error): void }>();
    const approvals = new Map<string, { wireId: string | number; options: string[] }>();
    const send = (value: unknown) => { if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(value) + '\n'); };
    const rpc = (method: string, params: unknown): Promise<any> => new Promise((resolve, reject) => {
      if (closing || cancelled) { reject(new Error('Kimi run closed')); return; }
      const id = ++sequence; pending.set(id, { resolve, reject }); send({ jsonrpc: '2.0', id, method, params });
    });
    const stop = () => {
      if (closing) return;
      closing = true;
      if (sessionId) send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
      killTree(child, 'SIGTERM'); killTimer = setTimeout(() => killTree(child, 'SIGKILL'), 1500);
    };
    const timer = setTimeout(() => { outcome = { status: 'blocked', error: 'Kimi exceeded the mission time limit' }; stop(); }, request.timeoutMs ?? 600_000);
    const done = new Promise<RunResult>(resolve => {
      child.on('error', e => { outcome = { status: 'blocked', error: `Cannot launch Kimi at ${this.executable}: ${e.message}` }; });
      child.stdin.on('error', () => { /* child close reports result */ });
      child.stderr.on('data', (b: Buffer) => { stderr = (stderr + b.toString()).slice(-4000); });
      child.stdout.on('data', lines(line => {
        try {
          const msg = JSON.parse(line);
          if (msg.method && msg.id !== undefined) {
            if (msg.method === 'session/request_permission') {
              if (closing || cancelled) { send({ jsonrpc: '2.0', id: msg.id, result: { outcome: { outcome: 'cancelled' } } }); return; }
              const id = String(msg.id);
              const options = (msg.params?.options ?? []).filter((o: any) => typeof o.optionId === 'string' && typeof o.name === 'string');
              approvals.set(id, { wireId: msg.id, options: options.map((o: any) => o.optionId) });
              emit({ type: 'permission', permission: { id, title: String(msg.params?.toolCall?.title ?? 'Kimi needs your decision'),
                detail: JSON.stringify(msg.params?.toolCall ?? {}, null, 2).slice(0, 8000), options } });
            } else send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Client capability not supported' } });
          } else if (msg.method === 'session/update') {
            const u = msg.params?.update;
            if (u?.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text') { producedOutput ||= Boolean(u.content.text?.trim()); emit({ type: 'text', text: u.content.text }); }
            else if (u?.sessionUpdate === 'tool_call' || u?.sessionUpdate === 'tool_call_update') emit({ type: 'activity', text: `${u.title ?? u.toolCallId}: ${u.status ?? 'pending'}` });
          } else if (msg.id !== undefined && pending.has(msg.id)) {
            const p = pending.get(msg.id)!; pending.delete(msg.id);
            msg.error ? p.reject(new Error(msg.error.message ?? 'Kimi RPC failed')) : p.resolve(msg.result);
          }
        } catch { outcome = { status: 'blocked', error: 'Invalid Kimi ACP JSON event' }; stop(); }
      }, e => { outcome = { status: 'blocked', error: e.message }; stop(); }));
      child.once('close', code => {
        closing = true; clearTimeout(timer); clearTimeout(killTimer);
        for (const p of pending.values()) p.reject(new Error('Kimi process closed'));
        pending.clear();
        resolve(cancelled ? { status: 'cancelled' } : outcome ?? { status: 'blocked', error: `Kimi exited ${code}: ${stderr || 'check native login / ACP support'}` });
      });
    });
    void (async () => {
      try {
        const init = await rpc('initialize', { protocolVersion: 1, clientInfo: { name: 'dot-swarm', version: '0.1.0' }, clientCapabilities: {} });
        if (request.sessionId && !init.agentCapabilities?.loadSession) throw new Error('This Kimi version cannot load sessions. Start a new mission without Continue.');
        const session = await rpc(request.sessionId ? 'session/load' : 'session/new', { cwd: request.cwd, mcpServers: [], ...(request.sessionId ? { sessionId: request.sessionId } : {}) });
        sessionId = request.sessionId ?? session.sessionId;
        if (!sessionId) throw new Error('Kimi returned no native session ID');
        emit({ type: 'session', id: sessionId });
        producedOutput = false; // History replay from session/load is not new work.
        // Do not change native permissions to auto/yolo; let ACP request human decisions.
        const result = await rpc('session/prompt', { sessionId, prompt: [{ type: 'text', text: request.prompt }] });
        outcome = result.stopReason === 'end_turn' ? (producedOutput ? { status: 'completed' } : { status: 'blocked', error: 'Kimi returned end_turn without an assistant response. Inspect the native session or try /status; no automatic retry was made.' })
          : result.stopReason === 'cancelled' ? { status: 'cancelled' }
          : { status: 'blocked', error: `Kimi stopped: ${result.stopReason ?? 'unknown reason'}` };
        stop();
      } catch (e) {
        outcome ??= { status: 'blocked', error: (e as Error).message }; stop();
      }
    })();
    return {
      done, cancel() { cancelled = true; stop(); },
      respond(id, optionId) {
        const approval = approvals.get(id);
        if (!approval || closing || cancelled) throw new Error('Permission request is no longer pending');
        if (optionId !== null && !approval.options.includes(optionId)) throw new Error('Unknown permission option');
        send({ jsonrpc: '2.0', id: approval.wireId, result: { outcome: optionId === null ? { outcome: 'cancelled' } : { outcome: 'selected', optionId } } });
        approvals.delete(id);
      },
    };
  }
}
