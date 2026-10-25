import { loadData } from "./data";
import { inferRoles, roleProbability } from "./roles";
import type { Candidate, DraftInput, PersonalNote, Reason, Role, RoleGuess } from "./types";

// Tunables
const PAIR_SHRINK = 150;      // games at which a matchup entry gets half weight
const PERSONAL_SHRINK = 15;   // personal games at which personal winrate gets half weight
const PERSONAL_WEIGHT = 0.6;  // how strongly personal winrate moves the final score
const MID_RATE_MIN = 0.15;    // hero counts as a mid hero if >= 15% of its games are mid
const MID_GAMES_MIN = 15000;  // ...and has enough mid games in the last 4 weeks (Divine+Immortal)
const BASE_SHRINK = 30000;    // mid games at which the hero base winrate gets half weight (niche-hero bias)
const POOL_MIN_GAMES = 10;
const LANE_OPP_BONUS = 0.75;  // матчап против их мидера весит до 1.75x (пропорционально вероятности, что он мид)
const LANE_OPP_BONUS_OTHER = 0.4; // на остальных ролях лейн делится с союзником, вес оппонентов по лейну меньше
// кто стоит против тебя на лейне, по ролям
const LANE_OPP: Record<Role, Role[]> = { 1: [3, 4], 2: [2], 3: [1, 5], 4: [1, 5], 5: [3, 4] };
const FAMILIAR_MIN_GAMES = 3;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r1 = (v: number) => Math.round(v * 10) / 10;

export function evaluateDraft(input: DraftInput): { candidates: Candidate[]; enemyRoles: RoleGuess[]; allyRoles: RoleGuess[]; role: Role } {
  const { heroes, heroById, matchups, pool, pairs, roleMeta } = loadData();
  const role: Role = ([1, 2, 3, 4, 5] as Role[]).includes(input.role as Role) ? (input.role as Role) : 2;
  const meta = roleMeta.get(role)!;
  const laneRoles = LANE_OPP[role];
  const laneBonus = role === 2 ? LANE_OPP_BONUS : LANE_OPP_BONUS_OTHER;
  const enemyPicks = input.enemies.filter((p) => heroById.has(p.id));
  const allyPicks = input.allies.filter((p) => heroById.has(p.id));
  const enemies = enemyPicks.map((p) => p.id);
  const allies = allyPicks.map((p) => p.id);
  const taken = new Set([...input.bans, ...enemies, ...allies]);
  const enemyRoles = inferRoles(enemyPicks);
  // союзники: твоя роль занята тобой, поэтому её для них исключаем
  const allyRoles = inferRoles(allyPicks.map((p) => (p.role === role ? { ...p, role: null } : p)), [role]);

  const out: Candidate[] = [];
  for (const hero of heroes) {
    if (taken.has(hero.id)) continue;
    const mu = matchups.get(hero.id);
    const rm = meta.get(hero.id);
    if (!mu || !rm) continue;
    const p = pool.get(hero.id);
    const br = p?.byRole?.[String(role)];
    const midGames = br ? br.games : role === 2 ? (p?.midGames ?? 0) : 0; // игры на выбранной роли
    const midWins = br ? br.wins : role === 2 ? (p?.midWins ?? 0) : 0;
    let poolStatus: Candidate["poolStatus"] = midGames >= POOL_MIN_GAMES ? "pool" : midGames >= FAMILIAR_MIN_GAMES ? "familiar" : "outside";
    if (input.pool?.add.includes(hero.id)) poolStatus = "pool";
    if (input.pool?.remove.includes(hero.id)) poolStatus = "outside";
    if ((rm.rate < MID_RATE_MIN || rm.games < MID_GAMES_MIN) && poolStatus === "outside") continue;

    const base = (rm.winrate - 0.5) * 100 * (rm.games / (rm.games + BASE_SHRINK));
    const reasons: Reason[] = [];
    let vsTotal = 0;
    for (const e of enemies) {
      const row = mu.vs.find((x) => x.h === e);
      if (!row) continue;
      const pMid = roleProbability(enemyRoles, e, laneRoles);
      const v = row.s * (row.n / (row.n + PAIR_SHRINK)) * (1 + laneBonus * pMid);
      vsTotal += v;
      reasons.push({ kind: "vs", heroId: e, name: heroById.get(e)!.name, value: r1(v), games: row.n, laneOpp: pMid >= 0.5 });
    }
    let withTotal = 0;
    for (const a of allies) {
      const row = mu.with.find((x) => x.h === a);
      if (!row) continue;
      const v = row.s * (row.n / (row.n + PAIR_SHRINK));
      withTotal += v;
      reasons.push({ kind: "with", heroId: a, name: heroById.get(a)!.name, value: r1(v), games: row.n });
    }
    reasons.sort((x, y) => Math.abs(y.value) - Math.abs(x.value));

    const draftScore = clamp(50 + base + vsTotal + withTotal, 20, 80);

    let personalWinrate: number | null = null;
    let personalAdj = 0;
    if (midGames > 0) {
      personalWinrate = (midWins / midGames) * 100;
      personalAdj = (personalWinrate - 50) * (midGames / (midGames + PERSONAL_SHRINK)) * PERSONAL_WEIGHT;
    }

    const personalNotes: PersonalNote[] = [];
    for (const other of [...enemies, ...allies]) {
      const ally = allies.includes(other);
      const pr = pairs.find((x) => (x.role ?? 2) === role && x.own === hero.id && x.other === other && x.ally === ally);
      if (pr && pr.games >= 2) personalNotes.push({ heroId: other, name: heroById.get(other)!.name, ally, games: pr.games, wins: pr.wins });
    }

    out.push({
      heroId: hero.id,
      name: hero.name,
      short: hero.short,
      draftScore: r1(draftScore),
      base: r1(50 + base),
      vsTotal: r1(vsTotal),
      withTotal: r1(withTotal),
      reasons,
      poolStatus,
      midGames,
      midWins,
      personalWinrate: personalWinrate === null ? null : Math.round(personalWinrate),
      personalAdj: r1(personalAdj),
      finalScore: r1(clamp(draftScore + personalAdj, 15, 85)),
      midRate: rm.rate,
      personalNotes,
    });
  }
  out.sort((a, b) => b.finalScore - a.finalScore);
  return { candidates: out, enemyRoles, allyRoles, role };
}
