import { startServer } from './server.js';
export const name = 'dot-swarm';
export const inject: string[] = [];
/** Structural Cordis lifecycle contract avoids loading a second Cordis singleton. */
export interface HostContext {
  effect(callback: () => (() => void | Promise<void>)): unknown;
  logger: { info(message: string): void };
}
export async function apply(ctx: HostContext): Promise<void> {
  const server = await startServer({ cwd: process.env.DOT_SWARM_WORKSPACE ?? process.cwd(),
    stateFile: process.env.DOT_SWARM_STATE_FILE, port: 4317 });
  ctx.effect(() => () => server.close());
  ctx.logger.info(`Dot Swarm: ${server.url} · workspace: ${server.runtime.cwd}`);
}
export * from './domain.js';
