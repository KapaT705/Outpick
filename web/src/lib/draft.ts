import { loadData } from "./data";
import { inferRoles, midProbability } from "./roles";
import type { Candidate, DraftInput, PersonalNote, Reason, RoleGuess } from "./types";

// Tunables
const PAIR_SHRINK = 150;      // games at which a matchup entry gets half weight
const PERSONAL_SHRINK = 15;   // personal games at which personal winrate gets half weight
const PERSONAL_WEIGHT = 0.6;  // how strongly personal winrate moves the final score
const MID_RATE_MIN = 0.15;    // hero counts as a mid hero if >= 15% of its games are mid
const MID_GAMES_MIN = 15000;  // ...and has enough mid games in the last 4 weeks (Divine+Immortal)
const BASE_SHRINK = 30000;    // mid games at which the hero base winrate gets half weight (niche-hero bias)
const POOL_MIN_GAMES = 10;
const LANE_OPP_BONUS = 0.75;  // матчап против их мидера весит до 1.75x (пропорционально вероятности, что он мид)
const FAMILIAR_MIN_GAMES = 3;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r1 = (v: number) => Math.round(v * 10) / 10;

export function evaluateDraft(input: DraftInput): { candidates: Candidate[]; enemyRoles: RoleGuess[]; allyRoles: RoleGuess[] } {
  const { heroes, heroById, matchups, midMeta, pool, pairs } = loadData();
  const enemyPicks = input.enemies.filter((p) => heroById.has(p.id));
  const allyPicks = input.allies.filter((p) => heroById.has(p.id));
  const enemies = enemyPicks.map((p) => p.id);
  const allies = allyPicks.map((p) => p.id);
  const taken = new Set([...input.bans, ...enemies, ...allies]);
  const enemyRoles = inferRoles(enemyPicks);
  // союзники: мид занят самим игроком, поэтому роль 2 для них исключаем
  const allyRoles = inferRoles(allyPicks.map((p) => (p.role === 2 ? { ...p, role: null } : p)), [2]);

  const out: Candidate[] = [];
  for (const hero of heroes) {
    if (taken.has(hero.id)) continue;
    const mu = matchups.get(hero.id);
    const meta = midMeta.get(hero.id);
    if (!mu || !meta) continue;
    const p = pool.get(hero.id);
    const midGames = p?.midGames ?? 0;
    const midWins = p?.midWins ?? 0;
    let poolStatus: Candidate["poolStatus"] = midGames >= POOL_MIN_GAMES ? "pool" : midGames >= FAMILIAR_MIN_GAMES ? "familiar" : "outside";
    if (input.pool?.add.includes(hero.id)) poolStatus = "pool";
    if (input.pool?.remove.includes(hero.id)) poolStatus = "outside";
    if ((meta.midRate < MID_RATE_MIN || meta.midGames < MID_GAMES_MIN) && poolStatus === "outside") continue;

    const base = (meta.midWinrate - 0.5) * 100 * (meta.midGames / (meta.midGames + BASE_SHRINK));
    const reasons: Reason[] = [];
    let vsTotal = 0;
    for (const e of enemies) {
      const row = mu.vs.find((x) => x.h === e);
      if (!row) continue;
      const pMid = midProbability(enemyRoles, e);
      const v = row.s * (row.n / (row.n + PAIR_SHRINK)) * (1 + LANE_OPP_BONUS * pMid);
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
      const pr = pairs.find((x) => x.own === hero.id && x.other === other && x.ally === ally);
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
      midRate: meta.midRate,
      personalNotes,
    });
  }
  out.sort((a, b) => b.finalScore - a.finalScore);
  return { candidates: out, enemyRoles, allyRoles };
}
