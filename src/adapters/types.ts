import type { Engine, Permission } from '../domain.js';
export type NativeEvent =
  | { type: 'text'; text: string }
  | { type: 'activity'; text: string }
  | { type: 'session'; id: string }
  | { type: 'permission'; permission: Permission };
export interface RunRequest { cwd: string; prompt: string; sessionId?: string; timeoutMs?: number }
export interface RunResult { status: 'completed' | 'blocked' | 'cancelled'; error?: string }
export interface NativeRun {
  done: Promise<RunResult>; cancel(): void;
  respond(permissionId: string, optionId: string | null): void;
}
export interface Adapter {
  engine: Engine;
  dryRun(cwd: string): Promise<{ executable: string; version: string; command: string[] }>;
  start(request: RunRequest, emit: (event: NativeEvent) => void): NativeRun;
}
