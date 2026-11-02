import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';
test('loopback API validates origin, input, host, and serves shared state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dot-swarm-http-'));
  const server = await startServer({ cwd: dir, stateFile: join(dir, 'state.json'), port: 0, assets: fileURLToPath(new URL('../panel', import.meta.url)) });
  try {
    const send = (body: unknown, headers = {}) => fetch(server.url + '/api/personas', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    assert.equal((await send({}, { origin: 'https://hostile.example' })).status, 403);
    const rebound = await new Promise<number | undefined>((resolve, reject) => { const req = request(server.url + '/api/state', { headers: { host: 'hostile.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); });
    assert.equal(rebound, 403);
    assert.equal((await send({})).status, 400);
    assert.equal((await send({ displayName: 'Moss', role: 'Researcher', engine: 'kimi' })).status, 201);
    const state = await (await fetch(server.url + '/api/state')).json();
    assert.equal(state.personas.length, 1); assert.equal(state.missions.length, 0);
    const html = await fetch(server.url); assert.equal(html.status, 200);
    assert.match(await html.text(), /Dot Swarm/);
  } finally { await server.close(); await rm(dir, { recursive: true, force: true }); }
});
