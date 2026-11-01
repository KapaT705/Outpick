// Отчёт после игры: что решило матч, каждая смерть с обстоятельствами, линия на 5 и 10 минуте против соперника
// и нормы героя, советы «минута + что сделать иначе». Тексты собираются по правилам из данных Stratz, без ИИ,
// и читаются через план героя (heroPlan.ts): одна и та же смерть у Эмбера после 6 уровня и у Инвокера до выхода
// значит разное.
import type { MatchData, MDeath, MPlayer } from "./matchData";
import { benchAt, type Bench } from "./bench";
import { heroPlan, type HeroPlan } from "./heroPlan";
import type { Hero } from "./types";

export type ReportDeath = {
  t: number; killer: number | null; helpers: number[]; enemies: number;
  where: string; enemyHalf: boolean;
  ownLosses: number; enemyLosses: number; // смерти своих (с тобой) и врагов в той же стычке, ±20 секунд
  goldLost: number; timeDead: number;
  traded: boolean;                         // враги тоже кого-то потеряли
  text: string; note: string | null;
};
export type ReportWindow = { from: number; to: number | null; label: string; mine: number; norm: number | null };
export type LaneCell = { me: number; opp: number | null; norm: number | null };
export type LaneRow = { minute: number; lh: LaneCell; dn: LaneCell; nw: LaneCell };
export type ReportTip = { t: number; text: string };
export type LaneOutcome = "stomp" | "won" | "even" | "lost" | "stomped" | null; // итог линии по Stratz для тебя
export type MatchReport = {
  matchId: number; startDateTime: number; durationSeconds: number; lobbyType: string | null;
  won: boolean; heroId: number; position: number | null; isRadiant: boolean;
  kills: number; deaths: number; assists: number; lastHits: number; denies: number; gpm: number; xpm: number; networth: number;
  allies: number[]; enemies: number[];
  plan: HeroPlan;
  parsed: boolean;
  summary: string[];
  winCurve: number[] | null; // шанс своей команды на победу по минутам, %
  deathList: ReportDeath[];
  windows: ReportWindow[];
  lane: { oppHeroId: number | null; outcome: LaneOutcome; rows: LaneRow[] } | null;
  tips: ReportTip[];
  benchMatches: number | null;
};

export const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.abs(t) % 60).padStart(2, "0")}`;
export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
const together = (n: number) => ["", "", "вдвоём", "втроём", "вчетвером", "впятером"][Math.min(n, 5)];
const r1 = (n: number) => Math.round(n * 10) / 10;
const sum = (a: number[], n: number) => a.slice(0, n).reduce((x, y) => x + (y ?? 0), 0);

/** Где на карте (координаты Stratz: от 60 до 190, Свет внизу слева, Тьма вверху справа, река по диагонали x+y≈252). */
export function region(x: number, y: number, radiant: boolean): { text: string; enemyHalf: boolean } {
  const rBase = x < 100 && y < 100 && x + y < 184, dBase = x > 156 && y > 152 && x + y > 318;
  if (rBase || dBase) { const own = rBase === radiant; return { text: own ? "на своей базе" : "на базе врага", enemyHalf: !own }; }
  const side = x + y < 244 ? "radiant" : x + y > 260 ? "dire" : "river";
  const enemyHalf = side !== "river" && (side === "radiant") !== radiant;
  const half = enemyHalf ? ", на половине врага" : "";
  if (Math.abs(x - y) <= 13) return { text: "на миде" + half, enemyHalf };
  if (x <= 90 || y >= 166) return { text: "на верхней линии" + half, enemyHalf };
  if (y <= 90 || x >= 164) return { text: "на нижней линии" + half, enemyHalf };
  if (side === "river") return { text: "у реки", enemyHalf };
  return { text: enemyHalf ? "в лесу врага" : "в своём лесу", enemyHalf };
}

export function findMe(m: MatchData, me: number | null, heroId?: number | null): MPlayer | null {
  return (me ? m.players.find((p) => p.steamAccountId === me) : undefined) ?? (heroId ? m.players.find((p) => p.heroId === heroId) : undefined) ?? null;
}

/** Соперник по линии: на миде вражеский мидер, на краях враг на той же линии (у врага она называется наоборот), ядро против ядра. */
export function laneOpponent(m: MatchData, p: MPlayer): MPlayer | null {
  const enemies = m.players.filter((x) => x.isRadiant !== p.isRadiant);
  if (p.lane === "mid" || (!p.lane && p.position === 2)) return enemies.find((x) => x.lane === "mid" && x.position === 2) ?? enemies.find((x) => x.lane === "mid") ?? null;
  const mirror = p.lane === "safe" ? "off" : p.lane === "off" ? "safe" : null;
  if (!mirror) return null;
  const same = enemies.filter((x) => x.lane === mirror);
  const core = p.position == null || p.position <= 3;
  return same.find((x) => (core ? (x.position ?? 9) <= 3 : (x.position ?? 0) >= 4)) ?? same[0] ?? null;
}

function laneOutcome(m: MatchData, p: MPlayer): LaneOutcome {
  const physical = p.lane === "mid" ? "mid" : p.lane === "safe" ? (p.isRadiant ? "bottom" : "top") : p.lane === "off" ? (p.isRadiant ? "top" : "bottom") : null;
  const o = physical ? m.laneOutcome[physical] : null;
  if (!o) return null;
  if (o === "TIE") return "even";
  const mine = o.startsWith(p.isRadiant ? "RADIANT" : "DIRE");
  const stomp = o.endsWith("STOMP");
  return mine ? (stomp ? "stomp" : "won") : stomp ? "stomped" : "lost";
}

export function buildReport(m: MatchData, me: MPlayer, bench: Bench | null, heroes: Map<number, Hero>): MatchReport {
  const name = (id: number | null | undefined) => (id ? heroes.get(id)?.name ?? "враг" : "враг");
  const hero = heroes.get(me.heroId);
  const heroName = hero?.name ?? "Герой";
  const plan = heroPlan(hero, me.position ?? (me.lane === "mid" ? 2 : null));
  const allies = m.players.filter((p) => p.isRadiant === me.isRadiant && p !== me);
  const enemies = m.players.filter((p) => p.isRadiant !== me.isRadiant);
  const enemyIds = new Set(enemies.map((p) => p.heroId));
  const dur = m.durationSeconds;
  const opp = laneOpponent(m, me);
  const winCurve = m.winRates ? m.winRates.map((w) => Math.round((me.isRadiant ? w : 1 - w) * 100)) : null;

  const base: MatchReport = {
    matchId: m.id, startDateTime: m.startDateTime, durationSeconds: dur, lobbyType: m.lobbyType,
    won: me.isVictory, heroId: me.heroId, position: me.position, isRadiant: me.isRadiant,
    kills: me.kills, deaths: me.deaths, assists: me.assists, lastHits: me.lastHits, denies: me.denies, gpm: me.gpm, xpm: me.xpm, networth: me.networth,
    allies: allies.map((p) => p.heroId), enemies: enemies.map((p) => p.heroId),
    plan, parsed: m.parsed, summary: [], winCurve, deathList: [], windows: [], lane: null, tips: [], benchMatches: bench?.matchCount ?? null,
  };
  if (!m.parsed) return base;

  // каждая смерть: кто, где, что было вокруг
  const near = (ps: MPlayer[], t: number) => ps.reduce((n, p) => n + p.deathsAt.filter((d) => Math.abs(d.t - t) <= 20).length, 0);
  const notes = new Set<string>();
  const deathList: ReportDeath[] = me.deathsAt.map((d: MDeath) => {
    const killer = d.attacker && enemyIds.has(d.attacker) ? d.attacker : null;
    const helpers = d.assist.filter((h) => enemyIds.has(h) && h !== killer);
    const enemiesN = (killer ? 1 : 0) + helpers.length;
    const where = region(d.x, d.y, me.isRadiant);
    const ownLosses = 1 + near(allies, d.t), enemyLosses = near(enemies, d.t);
    const traded = enemyLosses > 0;
    const who = enemiesN === 0 ? "Без героев врага: крипы, башня или нейтралы"
      : enemiesN === 1 ? `${name(killer ?? helpers[0])}${ownLosses === 1 && enemyLosses === 0 ? " один на один" : ""}`
      : enemiesN === 2 ? `${name(killer ?? helpers[0])} и ${name(killer ? helpers[0] : helpers[1])}`
      : `${ownLosses > 1 ? "Драка" : "Ганг"} ${together(enemiesN)}${killer ? `, добил ${name(killer)}` : ""}`;
    const fight = ownLosses === 1 && enemyLosses === 0 ? "" : ownLosses === 1 ? ` Размен: ты за ${enemyLosses}.` : ` Свои потеряли ${ownLosses}, враги ${enemyLosses}.`;
    const loss = d.goldLost > 0 ? ` Потерял ${d.goldLost} золота, лежал ${d.timeDead} сек.` : ` Лежал ${d.timeDead} сек.`;
    // пояснение через план героя, у каждого вида один раз, чтобы не повторяться
    let note: string | null = null;
    const once = (key: string, text: string) => { if (!notes.has(key)) { notes.add(key); note = text; } };
    if (plan.style === "farm" && d.t < plan.onlineAt * 60 && !traded) once("farm", `До ${plan.onlineAt}-й минуты ${heroName} фармит: смерть без размена отодвигает выход.`);
    else if (plan.style === "tempo" && d.t >= plan.fightFrom * 60 && traded) once("tempo", `Для ${heroName} смерть в драке с разменом после ${plan.fightFrom}-й минуты в порядке вещей.`);
    else if (plan.style === "initiator" && d.t < plan.fightFrom * 60 && !traded) once("init", `До ${plan.fightFrom}-й минуты ${heroName} копит на ключевой предмет: смерть без размена его откладывает.`);
    return { t: d.t, killer, helpers, enemies: enemiesN, where: where.text, enemyHalf: where.enemyHalf, ownLosses, enemyLosses, goldLost: d.goldLost, timeDead: d.timeDead, traded, text: `${who}, ${where.text}.${fight}${loss}`, note };
  });

  // смерти по отрезкам игры против нормы героя на этой позиции
  const normDeaths = (t: number) => (t <= 0 ? 0 : benchAt(bench, t)?.deaths ?? null);
  const windows: ReportWindow[] = [];
  for (const [from, to, label] of [[0, 10, "до 10-й минуты"], [10, 20, "с 10-й по 20-ю минуту"], [20, null, "после 20-й минуты"]] as [number, number | null, string][]) {
    if (dur <= from * 60) continue;
    const end = Math.min(dur / 60, to ?? Infinity);
    const a = normDeaths(from), b = normDeaths(Math.floor(end));
    windows.push({ from, to, label, mine: me.deathsAt.filter((d) => d.t >= from * 60 && d.t < end * 60).length, norm: a != null && b != null ? r1(b - a) : null });
  }

  // линия на 5 и 10 минуте
  const at = (p: MPlayer, t: number) => ({ lh: sum(p.lh, t), dn: sum(p.dn, t), nw: p.nw[t - 1] ?? null });
  const rows: LaneRow[] = [5, 10].filter((t) => dur >= t * 60 && me.lh.length >= t).map((t) => {
    const a = at(me, t), o = opp ? at(opp, t) : null, n = benchAt(bench, t);
    const nT = n && n.t === t ? n : null;
    return { minute: t, lh: { me: a.lh, opp: o?.lh ?? null, norm: nT ? r1(nT.cs) : null }, dn: { me: a.dn, opp: o?.dn ?? null, norm: nT ? r1(nT.dn) : null }, nw: { me: a.nw ?? 0, opp: o?.nw ?? null, norm: nT ? Math.round(nT.networth) : null } };
  });
  const lane = { oppHeroId: opp?.heroId ?? null, outcome: laneOutcome(m, me), rows };

  // итог: где решилась игра, смерти, линия
  const summary: string[] = [];
  if (winCurve && winCurve.length > 3) {
    let best = { i: 0, j: 0, swing: 0 };
    for (let i = 0; i < winCurve.length; i++) for (let j = i + 1; j <= Math.min(winCurve.length - 1, i + 6); j++) {
      const swing = me.isVictory ? winCurve[j] - winCurve[i] : winCurve[i] - winCurve[j];
      if (swing > best.swing) best = { i, j, swing };
    }
    if (best.swing >= 20) {
      const phase = best.j <= 10 ? "на линии" : best.j <= 25 ? "в середине игры" : "в поздней игре";
      const ourDeaths = [me, ...allies].reduce((n, p) => n + p.deathsAt.filter((d) => d.t >= best.i * 60 && d.t < best.j * 60).length, 0);
      const theirDeaths = enemies.reduce((n, p) => n + p.deathsAt.filter((d) => d.t >= best.i * 60 && d.t < best.j * 60).length, 0);
      summary.push(`Главный перелом ${phase}: к ${best.j}-й минуте шанс на победу ${me.isVictory ? "вырос" : "упал"} с ${winCurve[best.i]}% до ${winCurve[best.j]}%${ourDeaths + theirDeaths === 0 ? "" : ourDeaths === 0 ? `, за эти минуты враги умерли ${theirDeaths} ${plural(theirDeaths, "раз", "раза", "раз")}, свои ни разу` : `, за эти минуты свои умерли ${ourDeaths} ${plural(ourDeaths, "раз", "раза", "раз")}, враги ${theirDeaths === 0 ? "ни разу" : theirDeaths}`}.`);
    } else summary.push("Резкого перелома не было: шанс на победу менялся постепенно.");
  }
  // худший отрезок по превышению нормы в разах: пять смертей до 10 минуты при норме 0.9 важнее семи после 20 при норме 2
  const worst = windows.filter((w) => w.norm != null && w.mine >= 2 && w.mine - w.norm >= 1.5).sort((a, b) => b.mine / Math.max(b.norm!, 0.5) - a.mine / Math.max(a.norm!, 0.5)).map((w) => ({ w }))[0];
  if (worst) {
    const inW = deathList.filter((d) => d.t >= worst.w.from * 60 && (worst.w.to == null || d.t < worst.w.to * 60));
    const byKiller = new Map<number, number>();
    for (const d of inW) if (d.killer) byKiller.set(d.killer, (byKiller.get(d.killer) ?? 0) + 1);
    const top = [...byKiller].sort((a, b) => b[1] - a[1])[0];
    summary.push(`${worst.w.mine} ${plural(worst.w.mine, "смерть", "смерти", "смертей")} ${worst.w.label} при норме ${worst.w.norm}${top && top[1] >= 2 && top[1] * 2 >= inW.length ? `, ${top[1]} из них от ${name(top[0])}` : ""}.`);
  } else if (windows.some((w) => w.norm != null)) summary.push("Заметно больше нормы героя не умирал ни на одном отрезке игры.");
  const r10 = rows.find((r) => r.minute === 10);
  if (opp && r10 && r10.nw.opp != null && Math.abs(r10.nw.me - r10.nw.opp) >= 800) {
    const k = (n: number) => `${r1(n / 1000)}к`;
    summary.push(`Линию против ${name(opp.heroId)} ${r10.nw.me > r10.nw.opp ? "выиграл" : "проиграл"}: к 10-й минуте золото ${k(r10.nw.me)} против ${k(r10.nw.opp)}.`);
  }

  // советы: минута + что сделать иначе
  const tips: ReportTip[] = [];
  const used = new Set<number>();
  if (opp) {
    const laneDeaths = deathList.filter((d) => d.t < 600 && (d.killer === opp.heroId || d.helpers.includes(opp.heroId)));
    if (laneDeaths.length >= 2) {
      const d = laneDeaths[1]; used.add(d.t);
      const o = name(opp.heroId);
      tips.push({ t: d.t, text: plan.style === "farm" ? `После второй смерти от ${o} играть от своей башни и забирать опыт: ${heroName} важнее уровни и фарм, чем размен на линии.`
        : plan.style === "tempo" && d.t < (plan.fightFrom + 1) * 60 ? `До 6 уровня не размениваться с ${o}: ${heroName} сильнее после 6, а смерти на линии отдают ему темп.`
        : `После второй смерти от ${o} играть осторожнее: от своей башни и с обзором у реки.` });
    }
  }
  const gank = deathList.find((d) => !used.has(d.t) && d.enemies >= 3 && d.ownLosses === 1 && !d.traded && d.t >= 300 && d.t < 1500);
  if (gank) {
    used.add(gank.t);
    tips.push({ t: gank.t, text: `Тебя поймали ${together(gank.enemies)} без размена, ${gank.where}. ${gank.enemyHalf ? "На половину врага без обзора и союзников не ходить, особенно когда враги пропали с карты." : "Когда враги собираются вместе, фармить ближе к своей башне и проверять обзор перед выходом."}` });
  }
  if (plan.style === "farm") {
    // драки после линии: в стычке умерли хотя бы трое, свои потеряли больше
    const lost = deathList.filter((d) => d.t >= 600 && d.t < plan.onlineAt * 60 && d.ownLosses + d.enemyLosses >= 3 && d.enemyLosses < d.ownLosses);
    if (lost.length >= 2 && !used.has(lost[0].t)) {
      used.add(lost[0].t);
      tips.push({ t: lost[0].t, text: `До ${plan.onlineAt}-й минуты ${heroName} слабее в драках, а ты умер в ${lost.length} ${plural(lost.length, "проигранной драке", "проигранных драках", "проигранных драках")}. Входить после союзников, а в уже проигранную драку не заходить.` });
    }
  }
  if (plan.style === "tempo" || plan.style === "initiator") {
    const from = plan.fightFrom * 60, to = Math.min(dur, 1200);
    if (to - from >= 300) {
      const teamKills = enemies.reduce((n, p) => n + p.deathsAt.filter((d) => d.t >= from && d.t < to).length, 0);
      const part = new Set([...me.killsAt, ...me.assistsAt].filter((t) => t >= from && t < to)).size;
      if (teamKills >= 6 && part / teamKills < 0.4) tips.push({ t: from, text: `С ${plan.fightFrom}-й минуты ${heroName} должен драться: до 20-й минуты команда убила ${teamKills} ${plural(teamKills, "врага", "врагов", "врагов")}, а ты участвовал в ${part}. Чаще ходить к дракам и на ганги, даже ценой фарма.` });
    }
  }
  if (winCurve) {
    const late = deathList.find((d) => !used.has(d.t) && d.t >= 1200 && !d.traded && d.timeDead >= 40);
    if (late) {
      const i = Math.floor(late.t / 60), j = Math.min(winCurve.length - 1, i + 2);
      if (winCurve[i] != null && winCurve[i] - winCurve[j] >= 8) tips.push({ t: late.t, text: `Смерть без размена стоила ${late.timeDead} сек: за две минуты шанс на победу упал с ${winCurve[i]}% до ${winCurve[j]}%. После 20-й минуты ${late.enemyHalf ? "на половину врага без союзников и обзора не ходить" : "фармить там, куда свои успеют быстрее врагов"}.` });
    }
  }
  tips.sort((a, b) => a.t - b.t);

  return { ...base, summary, deathList, windows, lane, tips: tips.slice(0, 3) };
}
