import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPersona, addSquad, emptyState, MissionInput, missionTargets, setParent } from '../src/domain.js';
const input = { displayName: 'Atlas', role: 'Builder', engine: 'codex' };
test('typed personas reject unsupported engines, blank names and unknown parents', () => {
  const s = emptyState();
  assert.throws(() => addPersona(s, { ...input, engine: 'unsupported' }));
  assert.throws(() => addPersona(s, { ...input, displayName: ' ' }));
  assert.throws(() => addPersona(s, { ...input, parentId: 'unknown' }));
  assert.equal(addPersona(s, input).status, 'idle');
});
test('hierarchy prevents cycles without restricting direct assignments', () => {
  const s = emptyState(), lead = addPersona(s, input), peer = addPersona(s, { ...input, parentId: lead.id });
  assert.throws(() => setParent(s, lead.id, peer.id), /cycle/);
  assert.throws(() => setParent(s, peer.id, peer.id), /cycle/);
  assert.deepEqual(missionTargets(s, MissionInput.parse({ summary: 'Direct task', personaIds: [peer.id] })), [peer.id]);
  setParent(s, peer.id, null); assert.equal(peer.parentId, null);
});
test('squad lead must be a member, target selection is explicit and bounded', () => {
  const s = emptyState(), a = addPersona(s, input), b = addPersona(s, input);
  assert.throws(() => addSquad(s, { name: 'Crew', leadId: a.id, memberIds: [b.id] }), /Lead/);
  assert.throws(() => addSquad(s, { name: 'Crew', leadId: a.id, memberIds: [a.id, a.id] }), /Duplicate/);
  const squad = addSquad(s, { name: 'Crew', leadId: a.id, memberIds: [a.id, b.id] });
  assert.deepEqual(missionTargets(s, MissionInput.parse({ summary: 'Review', squadId: squad.id })), [a.id, b.id]);
  assert.throws(() => MissionInput.parse({ summary: 'Review' }));
  assert.throws(() => MissionInput.parse({ summary: 'Review', squadId: squad.id, personaIds: [a.id] }));
  assert.throws(() => MissionInput.parse({ summary: 'Review', personaIds: Array(5).fill(a.id) }));
});
