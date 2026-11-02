import React, { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type { State, Persona } from '../src/domain.js';
import './style.css';

type Snapshot = State & { workspace: string; maxParallel: number; persistenceError?: string };
async function api(path: string, input?: unknown) {
  const response = await fetch(`/api/${path}`, input === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'Request failed'); return data;
}
const statusLabel = { idle: 'Ready', working: 'Working', blocked: 'Blocked', needs_person: 'Needs you' };
function Avatar({ p, small = false }: { p: Persona; small?: boolean }) {
  return <div className={`avatar ${small ? 'small' : ''}`} style={{ '--character': p.avatar.color } as React.CSSProperties} aria-hidden="true">
    <div className="antenna"/><div className="face"><i/><i/></div><div className="body">{p.avatar.glyph}</div><div className="feet"><i/><i/></div>
  </div>;
}
function Hierarchy({ personas }: { personas: Persona[] }) {
  const depth = (p: Persona): number => { let n = 0, parent = p.parentId; const seen = new Set<string>(); while (parent && !seen.has(parent)) { seen.add(parent); n++; parent = personas.find(p => p.id === parent)?.parentId ?? null; } return n; };
  const levels = new Map<number, Persona[]>();
  for (const p of personas) { const d = depth(p); levels.set(d, [...levels.get(d) ?? [], p]); }
  const width = Math.max(600, ...[...levels.values()].map(l => l.length * 180));
  const positions = new Map(personas.map(p => { const d = depth(p), level = levels.get(d)!; return [p.id, { x: (level.indexOf(p) + .5) * width / level.length, y: d * 88 + 35 }]; }));
  return <div className="hierarchy"><svg width={width} height={levels.size * 88} role="img" aria-label="Persona hierarchy; lines connect parents to children">
    {personas.filter(p => p.parentId).map(p => { const a = positions.get(p.parentId!)!, b = positions.get(p.id)!; return <path key={p.id} d={`M${a.x},${a.y + 18} V${b.y - 35} H${b.x} V${b.y - 18}`} fill="none" stroke="#6f866d" strokeWidth="1.5"/>; })}
    {personas.map(p => { const pos = positions.get(p.id)!; return <g key={p.id} transform={`translate(${pos.x},${pos.y})`}><rect x="-76" y="-18" width="152" height="36" rx="9" fill="#24372b" stroke="#536e50"/><circle cx="-59" r="4" fill={p.avatar.color}/><text x="-46" y="5" fill="#e8f1dd" fontSize="12">{p.displayName.slice(0, 17)}</text></g>; })}
  </svg></div>;
}
function App() {
  const [state, setState] = useState<Snapshot>();
  const [error, setError] = useState(''); const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false); const [create, setCreate] = useState(false);
  const [squadForm, setSquadForm] = useState(false); const [target, setTarget] = useState('');
  const [summary, setSummary] = useState(''); const [continueSession, setContinue] = useState(false);
  const [view, setView] = useState<'characters' | 'hierarchy'>('characters');
  useEffect(() => {
    let alive = true, fetching = false, again = false;
    const load = async () => {
      if (fetching) { again = true; return; } fetching = true;
      try { const next = await api('state'); if (alive) setState(next); }
      catch (e) { if (alive) setError((e as Error).message); }
      finally { fetching = false; if (again && alive) { again = false; void load(); } }
    };
    void load(); const events = new EventSource('/api/events');
    events.onopen = () => { setConnected(true); void load(); };
    events.onmessage = () => void load(); events.onerror = () => setConnected(false);
    return () => { alive = false; events.close(); };
  }, []);
  async function mutate(path: string, data: unknown, success?: () => void) {
    setBusy(true); setError('');
    try { await api(path, data); setState(await api('state')); success?.(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const submitPersona = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const data = new FormData(e.currentTarget);
    void mutate('personas', { displayName: data.get('name'), role: data.get('role'), engine: data.get('engine'), parentId: data.get('parent') || null,
      avatar: { glyph: data.get('glyph'), color: data.get('color') } }, () => setCreate(false));
  };
  const submitSquad = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const data = new FormData(e.currentTarget);
    void mutate('squads', { name: data.get('name'), leadId: data.get('lead'), memberIds: data.getAll('members') }, () => setSquadForm(false));
  };
  if (!state) return <main className="loading">{error || 'Opening your workspace…'}</main>;
  const active = state.personas.filter(p => p.status === 'working').length;
  const attention = state.personas.filter(p => p.status === 'blocked' || p.status === 'needs_person').length;
  return <div className="app">
    <aside className="rail"><a className="brand" href="/" aria-label="Dot Swarm home">∴</a><span className="rail-mark">DS</span><span className="rail-bottom">01</span></aside>
    <main>
      <header><div className="wordmark">DOT SWARM <span>LOCAL WORKSPACE</span></div><div className="connection"><i className={connected ? 'live' : ''}/>{connected ? 'Connected' : 'Reconnecting…'}</div></header>
      <section className="intro"><div><p className="eyebrow">ONE DOT. A WHOLE SWARM.</p><h1>Your crew, at a glance.</h1><p className="subtitle">Give work a character. Keep your attention for what matters.</p></div><div className="phase">PHASE 01 <span>Codex + Kimi</span></div></section>
      <div className="workspace"><span>↳</span><code title={state.workspace}>{state.workspace}</code><span className="quiet-rule">Acts when asked · Quiet by default</span></div>
      {(error || state.persistenceError) && <div role="alert" className="error">{error || state.persistenceError}<button onClick={() => setError('')}>Dismiss</button></div>}
      <div className="columns"><section className="crew">
        <div className="section-head"><div><h2>Characters <span>{state.personas.length.toString().padStart(2, '0')}</span></h2><p>{active} working <b>·</b> {attention} need attention</p></div><button className="primary" onClick={() => setCreate(!create)}>＋ Create persona</button></div>
        {create && <form className="editor" onSubmit={submitPersona}><h3>Meet your next character</h3><div className="form-grid"><label>Name<input name="name" required maxLength={60} placeholder="e.g. Atlas"/></label><label>Role<input name="role" required maxLength={120} placeholder="e.g. Systems builder"/></label><label>Native engine<select name="engine"><option value="codex">Codex · read-only</option><option value="kimi">Kimi · native permissions</option></select></label><label>Reports to<select name="parent"><option value="">Independent peer</option>{state.personas.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}</select></label><label>Emblem<select name="glyph"><option>◈</option><option>✦</option><option>≋</option><option>⌘</option></select></label><label>Color<input name="color" type="color" defaultValue="#b7e88b"/></label></div><button disabled={busy} className="primary">Create character</button><button type="button" className="text-button" onClick={() => setCreate(false)}>Close</button></form>}
        <div className="board"><div className="board-top"><div className="tabs"><button className={view === 'characters' ? 'selected' : ''} onClick={() => setView('characters')}>Character view</button><button className={view === 'hierarchy' ? 'selected' : ''} onClick={() => setView('hierarchy')}>Hierarchy</button></div><span>{state.maxParallel} concurrent slots</span></div>
          {!state.personas.length ? <div className="empty"><div className="empty-symbol">∴</div><h3>A quiet place to start.</h3><p>Create your first character, choose an engine,<br/>and give them a mission. Nothing runs on its own.</p><button onClick={() => setCreate(true)}>＋ Create your first persona</button></div>
          : view === 'hierarchy' ? <><Hierarchy personas={state.personas}/><p className="board-note">Edges show reporting relationships. Every character can still receive direct work.</p></>
          : <div className="cards">{state.personas.map(p => <article key={p.id} className={`card ${p.status}`}><div className="card-top"><span className={`engine ${p.engine}`}>{p.engine === 'codex' ? '⌘' : 'K'} {p.engine.toUpperCase()}</span><span className={`status ${p.status}`}><i/>{statusLabel[p.status]}</span></div><Avatar p={p}/><h3>{p.displayName}</h3><p className="role">{p.role}</p><p className="task">{p.currentTaskSummary ?? 'Ready for the next mission.'}</p><label className="parent-label">↳<select aria-label={`Parent of ${p.displayName}`} value={p.parentId ?? ''} disabled={busy} onChange={e => void mutate('parent', { id: p.id, parentId: e.target.value || null })}><option value="">Independent peer</option>{state.personas.filter(q => q.id !== p.id).map(q => <option key={q.id} value={q.id}>{q.displayName}</option>)}</select></label><button className="assign" disabled={p.status === 'working' || p.status === 'needs_person'} onClick={() => { setTarget(`p:${p.id}`); document.getElementById('mission-text')?.focus(); }}>Assign mission <span>↗</span></button></article>)}</div>}
        </div>
        <div className="section-head squads-head"><div><h2>Squads <span>{state.squads.length.toString().padStart(2, '0')}</span></h2><p>A shared mission, with a named lead.</p></div><button disabled={!state.personas.length} onClick={() => setSquadForm(!squadForm)}>＋ New squad</button></div>
        {squadForm && <form className="editor" onSubmit={submitSquad}><label>Squad name<input name="name" required maxLength={60}/></label><label>Lead<select name="lead">{state.personas.map(p => <option key={p.id} value={p.id}>{p.displayName}</option>)}</select></label><fieldset><legend>Members · include the lead · up to 4</legend>{state.personas.map(p => <label className="check" key={p.id}><input type="checkbox" name="members" value={p.id}/>{p.displayName}</label>)}</fieldset><button disabled={busy} className="primary">Create squad</button></form>}
        <div className="squad-list">{state.squads.length ? state.squads.map(s => <button key={s.id} onClick={() => setTarget(`s:${s.id}`)}><strong>∴ {s.name}</strong><span>{s.memberIds.length} characters · Lead: {state.personas.find(p => p.id === s.leadId)?.displayName}</span><b>↗</b></button>) : <p className="muted">Start flat. Add a squad when a mission needs a crew.</p>}</div>
      </section><aside className="mission-column"><section className="dispatch"><p className="eyebrow">YOUR NEXT MOVE</p><h2>Give a mission.</h2><p>A clear request is enough to begin.</p><form onSubmit={e => { e.preventDefault(); void mutate('missions', { summary, ...(target.startsWith('s:') ? { squadId: target.slice(2) } : { personaIds: [target.slice(2)] }), continueSession }, () => { setSummary(''); }); }}><label>Assign to<select required value={target} onChange={e => setTarget(e.target.value)}><option value="">Choose a character or squad</option><optgroup label="Characters">{state.personas.map(p => <option key={p.id} value={`p:${p.id}`} disabled={p.status === 'working' || p.status === 'needs_person'}>{p.displayName} · {p.engine}</option>)}</optgroup><optgroup label="Squads">{state.squads.map(s => <option key={s.id} value={`s:${s.id}`}>{s.name}</option>)}</optgroup></select></label><label>Mission<textarea id="mission-text" required maxLength={4000} rows={5} value={summary} onChange={e => setSummary(e.target.value)} placeholder="What should they accomplish?"/></label><label className="check"><input type="checkbox" checked={continueSession} onChange={e => setContinue(e.target.checked)}/>Continue each native session</label><p className="execution-note">Codex runs read-only. Kimi uses its native permissions and asks here when needed. Squad members receive this same mission in the shared workspace.</p><button className="primary launch" disabled={busy || !connected || !target || !summary.trim()}>Launch mission <span>↗</span></button></form></section><div className="principle"><span>✦</span><p><strong>Your attention is the scarce resource.</strong><br/>No background delegation. No status chatter. Results and decisions stay here.</p></div></aside></div>
      <section className="missions"><div className="section-head"><div><h2>Mission log <span>{state.missions.length.toString().padStart(2, '0')}</span></h2><p>Native activity, usable results, and decisions that need you.</p></div><span className="muted">Most recent first</span></div>
        {!state.missions.length && <div className="log-empty">No missions yet. Your crew is standing by.</div>}
        {[...state.missions].reverse().map(m => <article className="mission" key={m.id}><div className="mission-heading"><div><span className={`mission-status ${m.status}`}>{m.status}</span><time>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><h3>{m.summary}</h3></div>{m.status === 'working' && <button disabled={busy} onClick={() => void mutate('cancel', { id: m.id })}>Cancel mission</button>}</div>{m.runs.map(r => <div className="run" key={r.id}><div className="run-title"><strong>{state.personas.find(p => p.id === r.personaId)?.displayName}</strong><span>{r.status}</span></div>{r.permission && <div className="permission"><strong>{r.permission.title}</strong><pre>{r.permission.detail}</pre><div>{r.permission.options.map(o => <button disabled={busy} key={o.optionId} onClick={() => void mutate('permission', { runId: r.id, permissionId: r.permission!.id, optionId: o.optionId })}>{o.name}</button>)}<button disabled={busy} onClick={() => void mutate('permission', { runId: r.id, permissionId: r.permission!.id, optionId: null })}>Dismiss request</button></div></div>}{r.error && <p className="run-error">{r.error}</p>}<details open={r.status === 'working' || r.status === 'needs_person'}><summary>Native output{r.nativeSessionId ? ` · ${r.nativeSessionId}` : ''}</summary><pre>{r.output || 'Waiting for native output…'}</pre></details>{r.nativeSessionId && <p className="resume-hint">Resume in the native CLI from this workspace: <code>{state.personas.find(p => p.id === r.personaId)?.engine === 'codex' ? 'codex resume' : 'kimi -S'} {r.nativeSessionId}</code></p>}</div>)}</article>)}
      </section><footer><span>DOT SWARM / 0.1</span><span>Flat when simple. Hierarchical when useful.</span><a href="https://github.com/missminga/dot-swarm" target="_blank" rel="noreferrer">Open source ↗</a></footer>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
