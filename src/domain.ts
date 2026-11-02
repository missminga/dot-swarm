import { randomUUID } from "node:crypto";
import { z } from "zod";

export const EngineSchema = z.enum(["codex", "kimi"]);
export type Engine = z.infer<typeof EngineSchema>;
export type PersonaStatus = "idle" | "working" | "blocked" | "needs_person";
export const Text = z
  .string()
  .trim()
  .min(1)
  .max(4000)
  .refine((s) => !s.includes("\0"), "NUL is not allowed");
const Id = z.string().min(1).max(128);
export const PersonaInput = z
  .object({
    displayName: Text.max(60),
    role: Text.max(120),
    engine: EngineSchema,
    parentId: Id.nullable().default(null),
    avatar: z
      .object({
        glyph: z.string().min(1).max(8),
        color: z.string().regex(/^#[0-9a-f]{6}$/i),
      })
      .default({ glyph: "◈", color: "#b7e88b" }),
  })
  .strict();
export interface Persona extends z.infer<typeof PersonaInput> {
  id: string;
  status: PersonaStatus;
  currentTaskSummary: string | null;
  nativeSessionId?: string;
}
export const SquadInput = z
  .object({
    name: Text.max(60),
    leadId: Id,
    memberIds: z.array(Id).min(1).max(4),
  })
  .strict();
export interface Squad extends z.infer<typeof SquadInput> {
  id: string;
}
export const MissionInput = z
  .object({
    summary: Text,
    personaIds: z.array(Id).min(1).max(4).optional(),
    squadId: Id.optional(),
    continueSession: z.boolean().default(false),
  })
  .strict()
  .refine(
    (x) => Boolean(x.personaIds) !== Boolean(x.squadId),
    "Choose personas OR a squad",
  );
export type MissionStatus = "working" | "completed" | "blocked" | "cancelled";
export interface Permission {
  id: string;
  title: string;
  detail: string;
  options: { optionId: string; name: string; kind: string }[];
}
export interface Run {
  id: string;
  personaId: string;
  status: MissionStatus | "needs_person";
  output: string;
  nativeSessionId?: string;
  error?: string;
  permission?: Permission;
}
export interface Mission {
  id: string;
  summary: string;
  personaIds: string[];
  squadId?: string;
  authorization: { kind: "human"; at: string };
  status: MissionStatus;
  createdAt: string;
  runs: Run[];
}
export interface State {
  version: 1;
  personas: Persona[];
  squads: Squad[];
  missions: Mission[];
}
export const emptyState = (): State => ({
  version: 1,
  personas: [],
  squads: [],
  missions: [],
});
export function persona(state: State, id: string): Persona {
  const p = state.personas.find((p) => p.id === id);
  if (!p) throw new Error(`Unknown persona: ${id}`);
  return p;
}
export function addPersona(state: State, input: unknown): Persona {
  const data = PersonaInput.parse(input);
  if (state.personas.length >= 100)
    throw new Error("Persona limit (100) reached");
  if (data.parentId) persona(state, data.parentId);
  const p: Persona = {
    ...data,
    id: randomUUID(),
    status: "idle",
    currentTaskSummary: null,
  };
  state.personas.push(p);
  return p;
}
export function setParent(
  state: State,
  id: string,
  parentId: string | null,
): void {
  const p = persona(state, id);
  let cursor = parentId;
  const seen = new Set([id]);
  while (cursor) {
    if (seen.has(cursor)) throw new Error("Hierarchy cannot contain a cycle");
    seen.add(cursor);
    cursor = persona(state, cursor).parentId;
  }
  p.parentId = parentId;
}
export function addSquad(state: State, input: unknown): Squad {
  const data = SquadInput.parse(input);
  if (state.squads.length >= 100) throw new Error("Squad limit (100) reached");
  if (new Set(data.memberIds).size !== data.memberIds.length)
    throw new Error("Duplicate squad member");
  for (const id of data.memberIds) persona(state, id);
  if (!data.memberIds.includes(data.leadId))
    throw new Error("Lead must be a squad member");
  const squad = { ...data, id: randomUUID() };
  state.squads.push(squad);
  return squad;
}
export function missionTargets(
  state: State,
  input: z.infer<typeof MissionInput>,
): string[] {
  const squad = input.squadId
    ? state.squads.find((s) => s.id === input.squadId)
    : undefined;
  if (input.squadId && !squad) throw new Error("Unknown squad");
  const ids = squad ? [...squad.memberIds] : input.personaIds!;
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate assignee");
  for (const id of ids) persona(state, id);
  return ids;
}
export function settleMission(m: Mission): void {
  m.status = m.runs.some(
    (r) => r.status === "working" || r.status === "needs_person",
  )
    ? "working"
    : m.runs.some((r) => r.status === "blocked")
      ? "blocked"
      : m.runs.some((r) => r.status === "cancelled")
        ? "cancelled"
        : "completed";
}
