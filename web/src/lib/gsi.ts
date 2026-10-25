// Game State Integration: Дота шлёт JSON на /api/gsi, здесь храним последнее состояние и вытаскиваем драфт.
import type { Pick } from "./types";

export const GSI_TOKEN = "dotamidhelper";

type TeamDraft = Record<string, number | string | boolean>;
export type GsiPayload = {
  provider?: { timestamp?: number };
  map?: { matchid?: string; game_state?: string; game_time?: number; name?: string };
  player?: { team_name?: string; steamid?: string; name?: string; team_slot?: number } & Record<string, unknown>;
  hero?: { id?: number; name?: string } & Record<string, unknown>;
  draft?: { activeteam?: number; pick?: boolean; activeteam_time_remaining?: number; team2?: TeamDraft; team3?: TeamDraft } & Record<string, unknown>;
  auth?: { token?: string };
} & Record<string, unknown>;

export type DraftState = {
  phase: string;                  // DOTA_GAMERULES_STATE_*
  matchId: string | null;
  team: "radiant" | "dire" | null;
  teamSlot: number | null;        // твой слот в своей команде (0..4), для распознавания экрана
  ownHeroId: number | null;
  bans: number[];
  enemies: Pick[];
  allies: Pick[];
  activeTeamIsOurs: boolean | null;
  timeRemaining: number | null;
};

const state: { last: GsiPayload | null; receivedAt: number; draft: DraftState | null; samples: { at: number; payload: GsiPayload }[] } = { last: null, receivedAt: 0, draft: null, samples: [] };

const DRAFT_PHASES = new Set(["DOTA_GAMERULES_STATE_HERO_SELECTION", "DOTA_GAMERULES_STATE_STRATEGY_TIME", "DOTA_GAMERULES_STATE_TEAM_SHOWCASE"]);

/** Команда игрока: player.team_name, иначе home_team в блоке драфта, иначе спектейтор-формат player.team2/team3. */
function detectTeam(p: GsiPayload): "radiant" | "dire" | null {
  const tn = String(p.player?.team_name ?? "").toLowerCase();
  if (tn === "radiant" || tn === "dire") return tn;
  const d = p.draft;
  if (d?.team2?.home_team === true) return "radiant";
  if (d?.team3?.home_team === true) return "dire";
  return null;
}

function picksOf(t: TeamDraft | undefined, key: "pick" | "ban"): number[] {
  if (!t) return [];
  const out: number[] = [];
  for (let i = 0; i < 7; i++) { const v = Number(t[`${key}${i}_id`] ?? 0); if (v > 0) out.push(v); }
  return out;
}

export function parseDraft(p: GsiPayload): DraftState | null {
  const phase = p.map?.game_state ?? "";
  const team = detectTeam(p);
  const d = p.draft;
  const teamSlot = typeof p.player?.team_slot === "number" ? p.player.team_slot : null;
  if (!d || !team) return { phase, matchId: p.map?.matchid ?? null, team, teamSlot, ownHeroId: p.hero?.id || null, bans: [], enemies: [], allies: [], activeTeamIsOurs: null, timeRemaining: null };
  const ours = team === "radiant" ? d.team2 : d.team3;
  const theirs = team === "radiant" ? d.team3 : d.team2;
  const ownHeroId = p.hero?.id || null;
  const ourPicks = picksOf(ours, "pick");
  const bans = [...picksOf(d.team2, "ban"), ...picksOf(d.team3, "ban")];
  return {
    phase,
    matchId: p.map?.matchid ?? null,
    team,
    teamSlot,
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
  // для диагностики храним несколько последних сообщений из стадии драфта (без auth)
  const phase = p.map?.game_state ?? "";
  if (DRAFT_PHASES.has(phase) || p.draft) {
    const { auth: _auth, ...rest } = p; void _auth;
    const prev = state.samples[state.samples.length - 1];
    if (!prev || JSON.stringify(prev.payload.draft) !== JSON.stringify(rest.draft) || Date.now() - prev.at > 10_000) {
      state.samples.push({ at: Date.now(), payload: rest as GsiPayload });
      if (state.samples.length > 8) state.samples.shift();
    }
  }
}

export function rawSnapshot() {
  const { auth: _auth, ...last } = (state.last ?? {}) as GsiPayload; void _auth;
  return { receivedAt: state.receivedAt, last, samples: state.samples, parsed: state.draft };
}

export function snapshot() {
  const age = Date.now() - state.receivedAt;
  return { connected: state.receivedAt > 0 && age < 30_000, ageMs: state.receivedAt ? age : null, draft: state.draft };
}
