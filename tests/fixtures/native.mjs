#!/usr/bin/env node
import { createInterface } from 'node:readline';
const args = process.argv.slice(2);
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
if (args.includes('--version')) { console.log('native-fixture 1.0'); process.exit(0); }
const hold = () => { setInterval(() => {}, 1000); };
if (args.includes('exec')) {
  let prompt = '';
  for await (const chunk of process.stdin) prompt += chunk;
  emit({ type: 'thread.started', thread_id: args.includes('resume') ? args.at(-2) : 'codex-test-thread' });
  if (prompt === 'hang') hold();
  else if (prompt === 'malformed') { console.log('not-json'); hold(); }
  else if (prompt === 'fail') { emit({ type: 'turn.failed', error: { message: 'fixture failure' } }); process.exitCode = 1; }
  else if (prompt === 'early-exit') { /* No completed event, even exit 0 must fail. */ }
  else { emit({ type: 'item.completed', item: { type: 'agent_message', text: `Codex: ${prompt}` } }); emit({ type: 'turn.completed' }); }
} else {
  let promptId;
  const input = createInterface({ input: process.stdin });
  input.on('line', line => {
    const m = JSON.parse(line), reply = result => emit({ jsonrpc: '2.0', id: m.id, result });
    if (m.method === 'initialize') reply({ protocolVersion: 1, agentCapabilities: { loadSession: true } });
    if (m.method === 'session/new') reply({ sessionId: 'kimi-test-session' });
    if (m.method === 'session/load') reply({});
    if (m.method === 'session/prompt') {
      const prompt = m.params.prompt[0].text;
      if (prompt === 'empty') { reply({ stopReason: 'end_turn' }); return; }
      if (prompt === 'hang') { hold(); return; }
      if (prompt === 'malformed') { console.log('not-json'); hold(); return; }
      if (prompt === 'fail') { emit({ jsonrpc: '2.0', id: m.id, error: { code: -1, message: 'fixture failure' } }); return; }
      if (prompt === 'permission') {
        promptId = m.id;
        emit({ jsonrpc: '2.0', id: 'approval-1', method: 'session/request_permission', params: { toolCall: { title: 'Run fixture action?', rawInput: { command: 'fixture only' } }, options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }] } }); return;
      }
      emit({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: m.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `Kimi: ${prompt}` } } } });
      reply({ stopReason: 'end_turn' });
    }
    if (m.id === 'approval-1') { emit({ jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Decision handled.' } } } }); emit({ jsonrpc: '2.0', id: promptId, result: { stopReason: m.result.outcome.outcome === 'selected' ? 'end_turn' : 'cancelled' } }); }
    if (m.method === 'session/cancel') process.exit(0);
  });
}
