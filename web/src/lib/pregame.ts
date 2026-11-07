// Прогноз на игру по полному драфту, до первого крипа: шанс команды 5 на 5 по контрпикам и синергиям всех десяти
// героев (та же оценка, что у пикера, только для каждого из пяти союзников) и твоя линия: 1 на 1 на миде, 2 на 2 на
// краях, по настоящим исходам линий у Divine/Immortal (laneStats.ts). Драфт решает мало, поэтому цифры всегда
// рядом с серединой и подаются словами: «драфт ровный», «линия тяжёлая».
import { evaluateDraft } from "./draft";
import { fetchLaneOutcomes, laneRate } from "./laneStats";
import type { DraftInput, Pick, Role, RoleGuess } from "./types";

export type Pregame = {
  team: { pct: number; words: string } | null;
  // guessed: кто на линии, хотя бы у одного героя угадано по героям, а не задано у чипа (игрок поправит, если не так)
  lane: { kind: "1v1" | "2v2"; me: { id: number; role: Role }[]; them: { id: number; role: Role }[]; pct: number; words: string; lanes: number; guessed?: boolean } | null;
  laneNote: string | null; // почему линии нет: роли не ясны, данных нет
};

/** Союзники по линии для роли: мид один, край парой. */
const PARTNER: Record<Role, Role | null> = { 1: 5, 2: null, 3: 4, 4: 3, 5: 1 };
const LANE_ENEMIES: Record<Role, Role[]> = { 1: [3, 4], 2: [2], 3: [1, 5], 4: [1, 5], 5: [3, 4] };

export const teamWords = (pct: number) => (pct >= 55 ? "драфт за вас" : pct <= 45 ? "драфт против вас" : "драфт ровный");
export const laneWords = (pct: number) => (pct >= 58 ? "линия должна зайти" : pct <= 42 ? "линия тяжёлая" : "линия ровная");

// герой на роли по самой вероятной раскладке, даже неуверенной: линию показываем сразу, роли с «?» игрок поправит у чипа
const at = (gs: RoleGuess[], role: Role): RoleGuess | null => gs.find((x) => x.role === role) ?? null;

export async function buildPregame(input: DraftInput, chosenHeroId: number, accountId: number | null): Promise<Pregame> {
  const role = input.role ?? 2;
  const enemies = input.enemies.filter((p) => p.id !== chosenHeroId);
  const allies = input.allies.filter((p) => p.id !== chosenHeroId);
  // роли: врагов и союзников угадывает та же оценка, что у пикера (с учётом ролей с экрана и истории игроков)
  const ev = evaluateDraft({ ...input, enemies, allies, role }, accountId);
  const allyRoles: RoleGuess[] = [...ev.allyRoles, { id: chosenHeroId, role, prob: 1, locked: true }];

  // команда 5 на 5: оценка каждого из пяти союзников в этом драфте, как если бы его выбирали сейчас; среднее
  let team: Pregame["team"] = null;
  if (enemies.length === 5 && allies.length === 4) {
    const scores: number[] = [];
    for (const g of allyRoles) {
      const others: Pick[] = allyRoles.filter((x) => x.id !== g.id).map((x) => ({ id: x.id, role: x.role }));
      const r = evaluateDraft({ bans: [], enemies, allies: others, pool: { add: [g.id], remove: [] }, role: g.role, team: input.team }, null);
      const c = r.candidates.find((x) => x.heroId === g.id);
      if (c) scores.push(c.draftScore - c.stageAdj);
    }
    if (scores.length >= 3) {
      const pct = Math.round(Math.max(30, Math.min(70, scores.reduce((a, b) => a + b, 0) / scores.length)));
      team = { pct, words: teamWords(pct) };
    }
  }

  // линия: мид 1 на 1, края 2 на 2; кто стоит на ней, берём из раскладки ролей (заданные у чипа роли в ней закреплены)
  let lane: Pregame["lane"] = null;
  let laneNote: string | null = null;
  const partnerRole = PARTNER[role];
  const partner = partnerRole ? at(ev.allyRoles, partnerRole) : null;
  const them = LANE_ENEMIES[role].map((r) => at(ev.enemyRoles, r)).filter((g): g is RoleGuess => !!g);
  if (enemies.length < 5 || allies.length < 4) laneNote = "Линия покажется, когда будут видны все герои.";
  else if (them.length < LANE_ENEMIES[role].length) laneNote = "Не понятно, кто у врагов пойдёт на твою линию.";
  else if (partnerRole && !partner) laneNote = "Не понятно, кто из союзников пойдёт с тобой на линию.";
  else {
    const me = [{ id: chosenHeroId, role }, ...(partner ? [{ id: partner.id, role: partner.role }] : [])];
    const rates: { rate: number; n: number }[] = [];
    for (const a of me) {
      const rows = await fetchLaneOutcomes(a.id, a.role);
      for (const e of them) { const lr = laneRate(rows, e.id, e.role); if (lr) rates.push(lr); }
    }
    if (rates.length === 0) laneNote = "По этим героям у Stratz нет данных о линиях.";
    else {
      const pct = Math.round(Math.max(25, Math.min(75, (rates.reduce((a, x) => a + x.rate, 0) / rates.length) * 100)));
      const guessed = [...(partner ? [partner] : []), ...them].some((g) => !g.locked);
      lane = { kind: partnerRole ? "2v2" : "1v1", me, them: them.map((g) => ({ id: g.id, role: g.role })), pct, words: laneWords(pct), lanes: Math.min(...rates.map((x) => x.n)), guessed };
    }
  }
  return { team, lane, laneNote };
}
