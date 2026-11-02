import { startServer } from './server.js';
import { CodexAdapter } from './adapters/codex.js';
import { KimiAdapter } from './adapters/kimi.js';
import { EngineSchema } from './domain.js';
const [command = 'serve', engine] = process.argv.slice(2);
try {
  const cwd = process.env.DOT_SWARM_WORKSPACE ?? process.cwd();
  if (command === 'dry-run') {
    const parsed = EngineSchema.parse(engine);
    const adapter = parsed === 'codex' ? new CodexAdapter() : new KimiAdapter();
    console.log(JSON.stringify({ engine: parsed, cwd, ...await adapter.dryRun(cwd), note: 'Version probe only. No model request, session creation, or mission execution.' }, null, 2));
  } else if (command === 'serve') {
    const server = await startServer({ cwd, stateFile: process.env.DOT_SWARM_STATE_FILE });
    console.log(`Dot Swarm → ${server.url}\nWorkspace: ${server.runtime.cwd}\nState: ${server.runtime.stateFile}`);
    let stopping = false;
    const stop = () => { if (!stopping) { stopping = true; void server.close().catch(e => { console.error(e.message); process.exitCode = 1; }); } };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  } else throw new Error('Usage: pnpm dev | pnpm dry-run codex | pnpm dry-run kimi');
} catch (e) { console.error((e as Error).message); process.exitCode = 1; }
