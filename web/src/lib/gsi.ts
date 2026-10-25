// Game State Integration: Дота шлёт JSON на /api/gsi, здесь храним последнее состояние и вытаскиваем драфт.
import type { Pick } from "./types";

export const GSI_TOKEN = "dotamidhelper";

type TeamDraft = Record<string, number | string | boolean>;
export type GsiPayload = {
  provider?: { timestamp?: number };
  map?: { matchid?: string; game_state?: string; game_time?: number; name?: string };
  player?: { team_name?: string; steamid?: string; name?: string };
  hero?: { id?: number; name?: string };
  draft?: { activeteam?: number; pick?: boolean; activeteam_time_remaining?: number; team2?: TeamDraft; team3?: TeamDraft };
  auth?: { token?: string };
};

export type DraftState = {
  phase: string;                  // DOTA_GAMERULES_STATE_*
  matchId: string | null;
  team: "radiant" | "dire" | null;
  ownHeroId: number | null;
  bans: number[];
  enemies: Pick[];
  allies: Pick[];
  activeTeamIsOurs: boolean | null;
  timeRemaining: number | null;
};

const state: { last: GsiPayload | null; receivedAt: number; draft: DraftState | null } = { last: null, receivedAt: 0, draft: null };

function picksOf(t: TeamDraft | undefined, key: "pick" | "ban"): number[] {
  if (!t) return [];
  const out: number[] = [];
  for (let i = 0; i < 7; i++) { const v = Number(t[`${key}${i}_id`] ?? 0); if (v > 0) out.push(v); }
  return out;
}

export function parseDraft(p: GsiPayload): DraftState | null {
  const phase = p.map?.game_state ?? "";
  const team = p.player?.team_name === "radiant" ? "radiant" : p.player?.team_name === "dire" ? "dire" : null;
  const d = p.draft;
  if (!d || !team) return { phase, matchId: p.map?.matchid ?? null, team, ownHeroId: p.hero?.id || null, bans: [], enemies: [], allies: [], activeTeamIsOurs: null, timeRemaining: null };
  const ours = team === "radiant" ? d.team2 : d.team3;
  const theirs = team === "radiant" ? d.team3 : d.team2;
  const ownHeroId = p.hero?.id || null;
  const ourPicks = picksOf(ours, "pick");
  const bans = [...picksOf(d.team2, "ban"), ...picksOf(d.team3, "ban")];
  return {
    phase,
    matchId: p.map?.matchid ?? null,
    team,
    ownHeroId,
    bans,
    enemies: picksOf(theirs, "pick").map((id) => ({ id, role: null })),
    allies: ourPicks.filter((id) => id !== ownHeroId).map((id) => ({ id, role: null })),
    activeTeamIsOurs: d.activeteam == null ? null : (d.activeteam === 2) === (team === "radiant"),
    timeRemaining: d.activeteam_time_remaining ?? null,
  };
}

export function receive(p: GsiPayload) {
  state.last = p;
  state.receivedAt = Date.now();
  state.draft = parseDraft(p);
}

export function snapshot() {
  const age = Date.now() - state.receivedAt;
  return { connected: state.receivedAt > 0 && age < 30_000, ageMs: state.receivedAt ? age : null, draft: state.draft };
}
