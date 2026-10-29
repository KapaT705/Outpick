import { loadData } from "./data";
import { inferRoles, roleProbability } from "./roles";
import { cachedPlayerStats, currentLobby, type PlayerStats } from "./players";
import type { Candidate, DraftInput, DraftStage, Hero, HeroTag, LaneOpponent, PersonalNote, PredictedPicks, Reason, Role, RoleGuess, TeamNeed } from "./types";

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
// Очередь пика: пока врагов известно мало, они ответят контрпиком, и устойчивость к нему важнее лучшего матчапа
// против уже взятых. Риск контрпика = средний проигрыш героя его худшим популярным матчапам (взвешено по популярности).
const RISK_N = 8, RISK_W: Record<DraftStage, number> = { early: 0.6, mid: 0.3, late: 0 };
// Нехватка команды по тегам героев: союзники (без тебя) суммарно по тегу с уровнями 1–3; ниже NEED_MIN — не хватает.
const NEED_MIN: Partial<Record<HeroTag, number>> = { DISABLER: 3, INITIATOR: 2, PUSHER: 2, DURABLE: 2, CARRY: 2, ESCAPE: 0, NUKER: 2, SUPPORT: 0 };
const NEED_LABEL: Record<HeroTag, string> = { DISABLER: "контроля", INITIATOR: "инициации", PUSHER: "пуша", DURABLE: "фронта", CARRY: "урона в лейте", NUKER: "бурста", ESCAPE: "мобильности", SUPPORT: "саппорта" };
const NEED_BONUS = 0.6;       // pp за уровень тега, закрывающего нехватку (максимум 1.8 за тег)
const PREDICT_N = 4;          // сколько вероятных героев на незанятую роль врага показываем
const PREDICT_WEIGHT = 0.35;  // вес матчапа против вероятного соперника по линии, пока он не выбран (по долям пиков)

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r1 = (v: number) => Math.round(v * 10) / 10;

function teamNeeds(allies: Hero[]): TeamNeed[] {
  const have = new Map<HeroTag, number>();
  for (const h of allies) for (const t of h.roles ?? []) have.set(t.r, (have.get(t.r) ?? 0) + t.l);
  const out: TeamNeed[] = [];
  for (const [key, min] of Object.entries(NEED_MIN) as [HeroTag, number][]) { if (!min) continue; const v = have.get(key) ?? 0; if (v < min) out.push({ key, label: NEED_LABEL[key], have: v }); }
  return out;
}

export function evaluateDraft(input: DraftInput, accountId?: number | null): { candidates: Candidate[]; enemyRoles: RoleGuess[]; allyRoles: RoleGuess[]; role: Role; laneOpponent: LaneOpponent | null; predicted: PredictedPicks[]; stage: DraftStage; needs: TeamNeed[] } {
  const { heroes, heroById, matchups, pool, pairs, roleMeta, roleMetaTop } = loadData(accountId);
  const role: Role = ([1, 2, 3, 4, 5] as Role[]).includes(input.role as Role) ? (input.role as Role) : 2;
  const meta = roleMeta.get(role)!;
  const laneRoles = LANE_OPP[role];
  const laneBonus = role === 2 ? LANE_OPP_BONUS : LANE_OPP_BONUS_OTHER;
  const enemyPicks = input.enemies.filter((p) => heroById.has(p.id));
  const allyPicks = input.allies.filter((p) => heroById.has(p.id));
  const enemies = enemyPicks.map((p) => p.id);
  const allies = allyPicks.map((p) => p.id);
  const taken = new Set([...input.bans, ...enemies, ...allies]);
  // игроки матча (server_log.txt + Stratz): роли врагов по их истории, статистика соперника по линии, прогноз пиков
  const lobby = currentLobby();
  const pstats = lobby ? cachedPlayerStats(lobby.players.map((p) => p.accountId)) : new Map<number, PlayerStats>();
  const enemyTeam = input.team === "radiant" ? "dire" : input.team === "dire" ? "radiant" : null;
  const playerAt = (team: "radiant" | "dire" | null, slot: number | undefined): PlayerStats | null => {
    if (!lobby || !team || slot === undefined) return null;
    const lp = lobby.players.find((p) => p.team === team && p.slot % 5 === slot);
    return lp ? (pstats.get(lp.accountId) ?? null) : null;
  };
  const enemyRoles = inferRoles(enemyPicks, [], enemyPicks.map((p) => { const ps = playerAt(enemyTeam, p.slot); return ps?.rolesKnown ? ps.roles : null; }));
  // союзники: твоя роль занята тобой, поэтому её для них исключаем
  const allyRoles = inferRoles(allyPicks.map((p) => (p.role === role ? { ...p, role: null } : p)), [role]);
  // соперник по линии: враг с наибольшей вероятностью стоять против тебя (для мида — их мидер)
  let laneOpponent: LaneOpponent | null = null;
  for (const e of enemies) {
    const prob = roleProbability(enemyRoles, e, laneRoles);
    if (prob >= 0.35 && (!laneOpponent || prob > laneOpponent.prob)) {
      const h = heroById.get(e)!; const g = enemyRoles.find((x) => x.id === e);
      const ps = playerAt(enemyTeam, enemyPicks.find((p) => p.id === e)?.slot);
      const hs = ps?.heroes[e];
      laneOpponent = { heroId: e, name: h.name, short: h.short, role: g?.role ?? laneRoles[0], prob, player: ps ? { name: ps.name, games: hs?.games ?? 0, wins: hs?.wins ?? 0, rolesKnown: ps.rolesKnown } : null };
    }
  }

  // вероятные пики врага на роли, которые у них ещё не заняты: популярность героя на роли за 4 недели
  const takenRoles = new Set(enemyRoles.map((g) => g.role));
  const predicted: PredictedPicks[] = [];
  const freeRoles = ([1, 2, 3, 4, 5] as Role[]).filter((r) => !takenRoles.has(r));
  // по игрокам: враги, чьи слоты ещё без героя, с известной историей — их вероятная роль и любимые герои
  const usedSlots = new Set(enemyPicks.map((p) => p.slot).filter((s) => s !== undefined));
  const rolesByPlayer = new Set<Role>();
  if (lobby && enemyTeam) for (let slot = 0; slot < 5; slot++) {
    if (usedSlots.has(slot) || enemies.length >= 5) continue;
    const ps = playerAt(enemyTeam, slot);
    if (!ps || !ps.rolesKnown || ps.topHeroes.length === 0) continue;
    const role = freeRoles.filter((r) => !rolesByPlayer.has(r)).sort((a, b) => ps.roles[b] - ps.roles[a])[0];
    if (!role) continue;
    rolesByPlayer.add(role);
    const list = ps.topHeroes.filter((h) => !taken.has(h.heroId) && heroById.has(h.heroId)).slice(0, PREDICT_N);
    const sum = list.reduce((a, h) => a + h.games, 0) || 1;
    predicted.push({ role, player: ps.name, heroes: list.map((h) => ({ heroId: h.heroId, name: heroById.get(h.heroId)!.name, short: heroById.get(h.heroId)!.short, share: h.games / sum })) });
  }
  if (enemies.length < 5) for (const r of freeRoles) {
    if (rolesByPlayer.has(r)) continue;
    const list = [...(roleMeta.get(r)?.values() ?? [])].filter((e) => !taken.has(e.heroId) && heroById.has(e.heroId)).sort((a, b) => b.games - a.games).slice(0, PREDICT_N);
    const sum = list.reduce((a, e) => a + e.games, 0) || 1;
    predicted.push({ role: r, heroes: list.map((e) => ({ heroId: e.heroId, name: heroById.get(e.heroId)!.name, short: heroById.get(e.heroId)!.short, share: e.games / sum })) });
  }
  predicted.sort((a, b) => a.role - b.role);
  // пока соперник по линии не выбран: вероятные герои на его роль с небольшим весом
  const predictedLane = laneOpponent ? [] : predicted.filter((p) => laneRoles.includes(p.role)).flatMap((p) => p.heroes);
  const topMeta = roleMetaTop.get(role);
  const stage: DraftStage = enemies.length <= 1 ? "early" : enemies.length <= 3 ? "mid" : "late";
  // популярность героя в целом (сумма по ролям) для веса его матчапов в риске контрпика
  const popularity = new Map<number, number>(); let popTotal = 0;
  for (const r of [1, 2, 3, 4, 5]) for (const e of roleMeta.get(r)?.values() ?? []) { popularity.set(e.heroId, (popularity.get(e.heroId) ?? 0) + e.games); popTotal += e.games; }
  const needs = allies.length > 0 ? teamNeeds(allies.map((a) => heroById.get(a)!)) : [];

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
    let predictedAdj = 0;
    for (const ph of predictedLane) { const row = mu.vs.find((x) => x.h === ph.heroId); if (row) predictedAdj += row.s * (row.n / (row.n + PAIR_SHRINK)) * ph.share * PREDICT_WEIGHT; }

    // риск контрпика: худшие RISK_N матчапов среди не занятых популярных героев, взвешенные по популярности
    const worst = mu.vs.filter((x) => !taken.has(x.h) && x.n >= 100 && x.s < 0).map((x) => ({ v: -x.s * (x.n / (x.n + PAIR_SHRINK)), w: (popularity.get(x.h) ?? 0) / (popTotal || 1) })).sort((a, b) => b.v - a.v).slice(0, RISK_N);
    const wsum = worst.reduce((a, x) => a + x.w, 0);
    const counterRisk = wsum > 0 ? worst.reduce((a, x) => a + x.v * x.w, 0) / wsum : 0;
    const stageAdj = -counterRisk * RISK_W[stage];
    let needsAdj = 0;
    for (const n of needs) { const t = (hero.roles ?? []).find((x) => x.r === n.key); if (t) needsAdj += Math.min(3, t.l) * NEED_BONUS; }
    const draftScore = clamp(50 + base + vsTotal + withTotal + predictedAdj + stageAdj + needsAdj, 20, 80);
    const tm = topMeta?.get(hero.id);
    const top = tm ? { winrate: Math.round(tm.winrate * 1000) / 10, rate: Math.round(tm.rate * 1000) / 10, games: tm.games } : null;

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

    const vsLane = laneOpponent ? (() => { const r = reasons.find((x) => x.kind === "vs" && x.heroId === laneOpponent!.heroId); const pn = personalNotes.find((x) => !x.ally && x.heroId === laneOpponent!.heroId); return { value: r?.value ?? 0, games: r?.games ?? 0, personal: pn ? { games: pn.games, wins: pn.wins } : undefined }; })() : null;
    out.push({
      vsLane,
      top,
      predictedAdj: r1(predictedAdj),
      counterRisk: r1(counterRisk), stageAdj: r1(stageAdj), needsAdj: r1(needsAdj),
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
  return { candidates: out, enemyRoles, allyRoles, role, laneOpponent, predicted, stage, needs };
}
