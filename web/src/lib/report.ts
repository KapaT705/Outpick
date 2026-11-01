// Отчёт после игры: что решило матч, каждая смерть с обстоятельствами, линия на 5 и 10 минуте против соперника
// и нормы героя, советы «минута + что сделать иначе». Тексты собираются по правилам из данных Stratz, без ИИ,
// и читаются через план героя (heroPlan.ts): одна и та же смерть у Эмбера после 6 уровня и у Инвокера до выхода
// значит разное.
import type { MatchData, MDeath, MPlayer } from "./matchData";
import { benchAt, type Bench } from "./bench";
import { heroPlan, type HeroPlan } from "./heroPlan";
import { heroName as nameOf, v } from "./heroName";
import type { Hero } from "./types";

export type ReportDeath = {
  t: number; killer: number | null; helpers: number[]; enemies: number;
  where: string; enemyHalf: boolean; zone: Zone;
  ownLosses: number; enemyLosses: number; // смерти своих (с тобой) и врагов в той же стычке, ±20 секунд
  goldLost: number; timeDead: number;
  traded: boolean;                         // враги тоже кого-то потеряли
  text: string; note: string | null;
};
export type ReportWindow = { from: number; to: number | null; label: string; mine: number; norm: number | null };
export type LaneCell = { me: number; opp: number | null; norm: number | null };
export type LaneRow = { minute: number; lh: LaneCell; dn: LaneCell; nw: LaneCell };
/** Саппорт на линии: ваша пара против их пары (золото, сколько раз умирали) и твой вклад против нормы героя. */
export type NormCell = { me: number; norm: number | null };
export type SupLaneRow = { minute: number; gold: { me: number; opp: number } | null; kills: { me: number; opp: number } | null; dmg: NormCell; level: NormCell; stacks: NormCell };
export type ReportTip = { t: number; text: string };
/** Полезное действие: выигранная драка, мультикилл, соло-килл, первая кровь, вышка, линия. */
export type ReportMoment = { t: number; text: string; kind: "fight" | "multi" | "solo" | "first" | "tower" | "lane" | "trade" | "runes" };
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
  lane: { oppHeroId: number | null; outcome: LaneOutcome; rows: LaneRow[]; sup: { allies: number[]; enemies: number[]; rows: SupLaneRow[] } | null } | null;
  tips: ReportTip[];
  moments: ReportMoment[];   // что получилось, по времени
  strengths: string[];       // сильные стороны матча против нормы
  benchMatches: number | null;
};

export type Zone = "mid" | "top" | "bot" | "river" | "jungle" | "base";
export const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.abs(t) % 60).padStart(2, "0")}`;
export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
const together = (n: number) => ["", "", "вдвоём", "втроём", "вчетвером", "впятером"][Math.min(n, 5)];
const times = (n: number) => (n === 2 ? "дважды" : n === 3 ? "трижды" : `${n} ${plural(n, "раз", "раза", "раз")}`);
const inN = (n: number) => ["", "одной", "двух", "трёх", "четырёх", "пяти"][n] ?? String(n);
const timesN = (n: number) => (n === 1 ? "один раз" : n === 2 ? "два раза" : `${n} ${plural(n, "раз", "раза", "раз")}`);
const r1 = (n: number) => Math.round(n * 10) / 10;
const sum = (a: number[], n: number) => a.slice(0, n).reduce((x, y) => x + (y ?? 0), 0);

/** Где на карте (координаты Stratz: от 60 до 190, Свет внизу слева, Тьма вверху справа, река по диагонали x+y≈252). */
export function region(x: number, y: number, radiant: boolean): { text: string; enemyHalf: boolean; zone: Zone } {
  const rBase = x < 100 && y < 100 && x + y < 184, dBase = x > 156 && y > 152 && x + y > 318;
  if (rBase || dBase) { const own = rBase === radiant; return { text: own ? "у себя на базе" : "на базе врага", enemyHalf: !own, zone: "base" }; }
  const side = x + y < 244 ? "radiant" : x + y > 260 ? "dire" : "river";
  const enemyHalf = side !== "river" && (side === "radiant") !== radiant;
  const half = enemyHalf ? " на чужой стороне" : "";
  if (Math.abs(x - y) <= 13) return { text: "на миде" + half, enemyHalf, zone: "mid" };
  if (x <= 90 || y >= 166) return { text: "на топе" + half, enemyHalf, zone: "top" };
  if (y <= 90 || x >= 164) return { text: "на боте" + half, enemyHalf, zone: "bot" };
  if (side === "river") return { text: "на реке", enemyHalf, zone: "river" };
  return { text: enemyHalf ? "во вражеском лесу" : "в своём лесу", enemyHalf, zone: "jungle" };
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
  const H = (id: number | null | undefined) => nameOf(id, heroes);
  const list = (ids: number[]) => { const ns = ids.map((id) => H(id).name); return ns.length < 2 ? ns.join("") : `${ns.slice(0, -1).join(", ")} и ${ns[ns.length - 1]}`; };
  const hero = heroes.get(me.heroId);
  const heroName = H(me.heroId).name;
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
    plan, parsed: m.parsed, summary: [], winCurve, deathList: [], windows: [], lane: null, tips: [], moments: [], strengths: [], benchMatches: bench?.matchCount ?? null,
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
    const all = killer ? [killer, ...helpers] : helpers;
    const pickoff = ownLosses === 1 && enemyLosses === 0; // поймали одного, в ответ никого
    const k = H(all[0]);
    const who = all.length === 0 ? `Умер от крипов, вышки или нейтралов ${where.text}.`
      : all.length === 1 ? `${k.name}${pickoff ? " соло" : ""} ${v(k, "убил", "убила")} тебя ${where.text}.`
      : all.length === 2 ? `${list(all)} ${pickoff ? "поймали" : "убили"} тебя ${where.text}.`
      : pickoff ? `Ганг ${together(all.length)} ${where.text}: ${list(all)}.`
      : `Тебя зафокусили ${together(all.length)} ${where.text}${killer ? `, ${v(k, "добил", "добила")} ${k.name}` : ""}.`;
    const fight = pickoff ? ""
      : ownLosses === 1 ? (enemyLosses === 1 ? " Размен один на один." : ` Размен в плюс: за тебя забрали ${enemyLosses}.`)
      : enemyLosses === 0 ? (ownLosses === 2 ? " Рядом умер и тиммейт, в ответ никого." : ` Драку слили всухую: отдали ${ownLosses}, не забрали никого.`)
      : enemyLosses < ownLosses ? ` Драку проиграли: отдали ${ownLosses}, забрали ${enemyLosses}.`
      : enemyLosses === ownLosses ? ` Драка вничью: ${ownLosses} на ${enemyLosses}.`
      : ` Драку выиграли: забрали ${enemyLosses}, отдали ${ownLosses}.`;
    // респ в пару секунд бывает только после выкупа; само время респа владелец просил не писать
    const bought = d.timeDead <= 3;
    const loss = d.goldLost > 0 ? ` Минус ${d.goldLost} золота${bought ? ", сразу выкупился" : ""}.` : bought ? " Сразу выкупился." : "";
    // пояснение через план героя, у каждого вида один раз, чтобы не повторяться
    let note: string | null = null;
    const once = (key: string, text: string) => { if (!notes.has(key)) { notes.add(key); note = text; } };
    if (plan.style === "farm" && d.t < plan.onlineAt * 60 && !traded) once("farm", `${heroName} до ${plan.onlineAt}-й минуты фармит, и смерть без размена отодвигает выход.`);
    else if (plan.style === "tempo" && d.t >= plan.fightFrom * 60 && traded) once("tempo", `${heroName} с ${plan.fightFrom}-й минуты дерётся, так что смерть с разменом - нормальная цена.`);
    else if (plan.style === "initiator" && d.t < plan.fightFrom * 60 && !traded) once("init", `${heroName} до ${plan.fightFrom}-й минуты копит на ключевой предмет, а смерть без размена его откладывает.`);
    return { t: d.t, killer, helpers, enemies: enemiesN, where: where.text, enemyHalf: where.enemyHalf, zone: where.zone, ownLosses, enemyLosses, goldLost: d.goldLost, timeDead: d.timeDead, traded, text: `${who}${fight}${loss}`, note };
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
  // саппорту добивания не главное: важно, кто выиграл линию парой, и что он сам сделал (харас, опыт, стаки)
  const isSup = (me.position ?? 0) >= 4;
  const mirror = me.lane === "safe" ? "off" : me.lane === "off" ? "safe" : me.lane === "mid" ? "mid" : null;
  const pairUs = mirror ? [me, ...allies.filter((p) => p.lane === me.lane)] : [me];
  const pairThem = mirror ? enemies.filter((p) => p.lane === mirror) : [];
  const duel = pairThem.length > 0;
  const supRows: SupLaneRow[] = !isSup ? [] : [5, 10].filter((t) => dur >= t * 60 && me.nw.length >= t).map((t) => {
    const n = benchAt(bench, t), nT = n && n.t === t ? n : null;
    const gold = (ps: MPlayer[]) => ps.reduce((a, p) => a + (p.nw[t - 1] ?? 0), 0);
    const died = (ps: MPlayer[]) => ps.reduce((a, p) => a + p.deathsAt.filter((d) => d.t < t * 60).length, 0);
    return {
      minute: t,
      gold: duel ? { me: gold(pairUs), opp: gold(pairThem) } : null,
      kills: duel ? { me: died(pairThem), opp: died(pairUs) } : null,
      dmg: { me: sum(me.dmg, t), norm: nT ? Math.round(nT.heroDamage) : null },
      level: { me: Math.max(1, me.lvlAt.filter((x) => x < t * 60).length), norm: nT ? r1(nT.level) : null },
      stacks: { me: me.stacks[t - 1] ?? 0, norm: nT ? r1(nT.stacks) : null },
    };
  });
  const lane = { oppHeroId: opp?.heroId ?? null, outcome: laneOutcome(m, me), rows, sup: isSup ? { allies: pairUs.map((p) => p.heroId), enemies: pairThem.map((p) => p.heroId), rows: supRows } : null };
  const s10 = supRows.find((r) => r.minute === 10);

  // итог: где решилась игра, смерти, линия
  const summary: string[] = [];
  if (winCurve && winCurve.length > 3) {
    let best = { i: 0, j: 0, swing: 0 };
    for (let i = 0; i < winCurve.length; i++) for (let j = i + 1; j <= Math.min(winCurve.length - 1, i + 6); j++) {
      const swing = me.isVictory ? winCurve[j] - winCurve[i] : winCurve[i] - winCurve[j];
      if (swing > best.swing) best = { i, j, swing };
    }
    if (best.swing >= 20) {
      const phase = best.j <= 10 ? "на линии" : best.j <= 25 ? "в мидгейме" : "в лейте";
      const ourDeaths = [me, ...allies].reduce((n, p) => n + p.deathsAt.filter((d) => d.t >= best.i * 60 && d.t < best.j * 60).length, 0);
      const theirDeaths = enemies.reduce((n, p) => n + p.deathsAt.filter((d) => d.t >= best.i * 60 && d.t < best.j * 60).length, 0);
      const deaths = ourDeaths + theirDeaths === 0 ? "" : ourDeaths === 0 ? ` За это время враги умерли ${timesN(theirDeaths)}, наши ни разу.` : ` За это время наши умерли ${timesN(ourDeaths)}, враги ${theirDeaths === 0 ? "ни разу" : theirDeaths}.`;
      summary.push(`${me.isVictory ? "Игру переломили" : "Игра сломалась"} ${phase}: к ${best.j}-й минуте шанс на победу ${me.isVictory ? "вырос" : "упал"} с ${winCurve[best.i]}% до ${winCurve[best.j]}%.${deaths}`);
    } else summary.push("Резких переломов не было: шанс на победу менялся постепенно.");
  }
  // худший отрезок по превышению нормы в разах: пять смертей до 10 минуты при норме 0.9 важнее семи после 20 при норме 2
  const worst = windows.filter((w) => w.norm != null && w.mine >= 2 && w.mine - w.norm >= 1.5).sort((a, b) => b.mine / Math.max(b.norm!, 0.5) - a.mine / Math.max(a.norm!, 0.5)).map((w) => ({ w }))[0];
  if (worst) {
    const inW = deathList.filter((d) => d.t >= worst.w.from * 60 && (worst.w.to == null || d.t < worst.w.to * 60));
    const byKiller = new Map<number, number>();
    for (const d of inW) if (d.killer) byKiller.set(d.killer, (byKiller.get(d.killer) ?? 0) + 1);
    const top = [...byKiller].sort((a, b) => b[1] - a[1])[0];
    const label = worst.w.label[0].toUpperCase() + worst.w.label.slice(1);
    const tk = top ? H(top[0]) : null;
    summary.push(`${label} ${worst.w.mine} ${plural(worst.w.mine, "смерть", "смерти", "смертей")} при норме ${worst.w.norm}${tk && top[1] >= 2 && top[1] * 2 >= inW.length ? `, из них ${times(top[1])} ${v(tk, "убил", "убила")} ${tk.name}` : ""}.`);
  } else if (windows.some((w) => w.norm != null)) summary.push("Заметно больше нормы не умирал ни на одном отрезке игры.");
  const r10 = rows.find((r) => r.minute === 10);
  if (isSup) {
    if (s10?.gold && Math.abs(s10.gold.me - s10.gold.opp) >= 800) {
      const d = `${r1(Math.abs(s10.gold.me - s10.gold.opp) / 1000)}к`;
      summary.push(s10.gold.me > s10.gold.opp ? `Линию выиграли: к 10-й минуте ваша пара на ${d} золота впереди.` : `Линию проиграли: к 10-й минуте ${list(pairThem.map((p) => p.heroId))} на ${d} золота впереди вашей пары.`);
    }
  } else if (opp && r10 && r10.nw.opp != null && Math.abs(r10.nw.me - r10.nw.opp) >= 800) {
    const k = (n: number) => `${r1(n / 1000)}к`;
    const o = H(opp.heroId);
    summary.push(r10.nw.me > r10.nw.opp ? `Линию выиграл: к 10-й минуте у тебя ${k(r10.nw.me)} нетворса, а ${o.name} ${v(o, "нафармил", "нафармила")} ${k(r10.nw.opp)}.` : `${o.name} ${v(o, "выиграл", "выиграла")} у тебя линию: к 10-й минуте ${k(r10.nw.opp)} нетворса против твоих ${k(r10.nw.me)}.`);
  }

  // советы: минута + что сделать иначе
  const tips: ReportTip[] = [];
  const used = new Set<number>();
  if (opp) {
    // смерти на своей линии (или у реки рядом с ней) с участием соперника; размен в ноль или в плюс не в счёт
    const laneZone: Zone | null = me.lane === "mid" ? "mid" : me.lane === "safe" ? (me.isRadiant ? "bot" : "top") : me.lane === "off" ? (me.isRadiant ? "top" : "bot") : null;
    const laneDeaths = deathList.filter((d) => d.t < 600 && (d.killer === opp.heroId || d.helpers.includes(opp.heroId)) && (d.zone === laneZone || d.zone === "river") && d.enemyLosses < d.ownLosses);
    if (laneDeaths.length >= 2) {
      const d = laneDeaths[1]; used.add(d.t);
      const o = H(opp.heroId), killed = `${o.name} ${v(o, "убил", "убила")} тебя на линии уже второй раз.`;
      tips.push({ t: d.t, text: plan.style === "farm" ? `${killed} Дальше играй от вышки и забирай опыт: ${heroName} - герой на фарм, уровни важнее размена.`
        : plan.style === "tempo" && d.t < (plan.fightFrom + 1) * 60 ? `${killed} Не лезь в размен до 6 уровня: после ульты ${heroName} сильнее, а ранние смерти отдают сопернику темп.`
        : `${killed} Дальше играй осторожнее: от вышки и с вардом на реке.` });
    }
  }
  const gank = deathList.find((d) => !used.has(d.t) && d.enemies >= 3 && d.ownLosses === 1 && !d.traded && d.t >= 300 && d.t < 1500);
  if (gank) {
    used.add(gank.t);
    tips.push({ t: gank.t, text: `Ганг ${together(gank.enemies)} ${gank.where} без размена. ${gank.enemyHalf ? "На чужую половину без варда и тиммейтов не ходи, особенно когда враги пропали с карты." : `Когда враги пропадают с карты, ${plan.style === "support" ? "держись ближе к своим" : "фарми ближе к своим вышкам"} и ставь вард перед выходом.`}` });
  }
  if (plan.style === "farm") {
    // драки после линии: в стычке умерли хотя бы трое, свои потеряли больше
    const lost = deathList.filter((d) => d.t >= 600 && d.t < plan.onlineAt * 60 && d.ownLosses + d.enemyLosses >= 3 && d.enemyLosses < d.ownLosses);
    if (lost.length >= 2 && !used.has(lost[0].t)) {
      used.add(lost[0].t);
      tips.push({ t: lost[0].t, text: `До ${plan.onlineAt}-й минуты ${heroName} ещё не на силе, а ты умер в ${inN(lost.length)} ${plural(lost.length, "проигранной драке", "проигранных драках", "проигранных драках")}. Заходи после тиммейтов, а в уже проигранную драку не лезь: сохранить фарм важнее.` });
    }
  }
  if (plan.style === "tempo" || plan.style === "initiator") {
    const from = plan.fightFrom * 60, to = Math.min(dur, 1200);
    if (to - from >= 300) {
      const teamKills = enemies.reduce((n, p) => n + p.deathsAt.filter((d) => d.t >= from && d.t < to).length, 0);
      const part = new Set([...me.killsAt, ...me.assistsAt].filter((t) => t >= from && t < to)).size;
      if (teamKills >= 6 && part / teamKills < 0.4) tips.push({ t: from, text: `С ${plan.fightFrom}-й минуты пора драться, а до 20-й минуты ты был только в ${part} из ${teamKills} убийств команды. Чаще ходи на ганги и в драки, даже в ущерб фарму.` });
    }
  }
  if (winCurve) {
    const late = deathList.find((d) => !used.has(d.t) && d.t >= 1200 && !d.traded && d.timeDead >= 40);
    if (late) {
      const i = Math.floor(late.t / 60), j = Math.min(winCurve.length - 1, i + 2);
      if (winCurve[i] != null && winCurve[i] - winCurve[j] >= 8) tips.push({ t: late.t, text: `Смерть без размена в лейте: за две минуты шанс на победу упал с ${winCurve[i]}% до ${winCurve[j]}%. ${late.enemyHalf ? "Без тиммейтов и варда на чужую половину не ходи." : "Фарми там, куда свои успеют быстрее врагов."}` });
    }
  }
  tips.sort((a, b) => a.t - b.t);

  // что получилось: драки, мультикиллы, соло-киллы, вышки, линия; чтобы было видно сильные стороны, а не только ошибки
  const moments: (ReportMoment & { w: number })[] = [];
  const myKills = [...me.kills2].sort((a, b) => a.t - b.t);
  const whereKill = (k: { x: number; y: number }) => region(k.x, k.y, me.isRadiant).text;
  // мультикиллы: убийства с промежутком до 18 секунд, как в игре
  const multis: { t: number; n: number; last: (typeof myKills)[number] }[] = [];
  for (let i = 0; i < myKills.length;) {
    let j = i;
    while (j + 1 < myKills.length && myKills[j + 1].t - myKills[j].t <= 18) j++;
    if (j > i) multis.push({ t: myKills[i].t, n: j - i + 1, last: myKills[j] });
    i = j + 1;
  }
  const MULTI = ["", "", "Дабл-килл", "Трипл-килл", "Ультра-килл", "Рампага!"];
  // драки: подряд идущие смерти обеих команд с перерывом не больше 15 секунд
  const allDeaths = [...[me, ...allies].flatMap((p) => p.deathsAt.map((d) => ({ ...d, ours: true }))), ...enemies.flatMap((p) => p.deathsAt.map((d) => ({ ...d, ours: false })))].sort((a, b) => a.t - b.t);
  const fights: (typeof allDeaths)[] = [];
  for (const d of allDeaths) { const last = fights[fights.length - 1]; if (last && d.t - last[last.length - 1].t <= 15) last.push(d); else fights.push([d]); }
  const usedMulti = new Set<number>();
  for (const f of fights) {
    const theirs = f.filter((d) => !d.ours), ours = f.filter((d) => d.ours);
    const from = f[0].t - 3, to = f[f.length - 1].t + 3;
    const k = me.killsAt.filter((t) => t >= from && t <= to).length, a = me.assistsAt.filter((t) => t >= from && t <= to).length;
    if (theirs.length < 2 || theirs.length <= ours.length || k + a === 0) continue;
    const multi = multis.find((x) => x.t >= from && x.t <= to);
    if (multi) usedMulti.add(multi.t);
    const mine = multi ? ` У тебя ${MULTI[Math.min(multi.n, 5)].replace("!", "").toLowerCase()}.` : ` У тебя ${[k ? `${k} ${plural(k, "килл", "килла", "киллов")}` : "", a ? `${a} ${plural(a, "ассист", "ассиста", "ассистов")}` : ""].filter(Boolean).join(" и ")}.`;
    const i = Math.floor(f[0].t / 60), j = Math.min((winCurve?.length ?? 1) - 1, Math.floor(f[f.length - 1].t / 60) + 2);
    const swing = winCurve && winCurve[i] != null && winCurve[j] != null && winCurve[j] - winCurve[i] >= 8 ? ` Шанс на победу вырос с ${winCurve[i]}% до ${winCurve[j]}%.` : "";
    moments.push({ t: f[0].t, kind: "fight", w: 3 + theirs.length - ours.length + (swing ? 2 : 0) + (multi ? multi.n : 0), text: `Выиграли драку ${region(theirs[0].x, theirs[0].y, me.isRadiant).text}: забрали ${theirs.length}, отдали ${ours.length}.${mine}${swing}` });
  }
  for (const x of multis) if (!usedMulti.has(x.t)) moments.push({ t: x.t, kind: "multi", w: 2 + x.n * 2, text: `${MULTI[Math.min(x.n, 5)]} ${whereKill(x.last)}.`.replace("!.", "!") });
  const firstKill = m.players.flatMap((p) => p.kills2.map((k2) => ({ ...k2, p }))).sort((a, b) => a.t - b.t)[0];
  if (firstKill && firstKill.p === me) moments.push({ t: firstKill.t, kind: "first", w: 4, text: `Первая кровь за тобой: ${H(firstKill.target).name}, ${whereKill(firstKill)}.` });
  const isFirst = (k2: { t: number; target: number }) => firstKill?.p === me && firstKill.t === k2.t && firstKill.target === k2.target;
  for (const k2 of myKills.filter((k2) => k2.solo && !isFirst(k2)).slice(0, 3)) moments.push({ t: k2.t, kind: "solo", w: 3, text: `Соло-килл ${whereKill(k2)}: ${H(k2.target).name}.` });
  for (const d of deathList.filter((d) => d.ownLosses === 1 && d.enemyLosses >= 2)) moments.push({ t: d.t, kind: "trade", w: 2 + d.enemyLosses, text: `Твоя смерть окупилась: за тебя забрали ${["", "", "двоих", "троих", "четверых", "пятерых"][Math.min(d.enemyLosses, 5)]}.` });
  const towersMine = m.towers.filter((t) => t.attacker === me.heroId && t.radiant !== me.isRadiant);
  for (const t of towersMine.slice(0, 3)) moments.push({ t: t.t, kind: "tower", w: 2, text: "Добил вражескую вышку." });
  if (s10) {
    const diff = s10.gold ? s10.gold.me - s10.gold.opp : null;
    if ((diff != null && diff >= 500) || lane.outcome === "won" || lane.outcome === "stomp") moments.push({ t: 600, kind: "lane", w: 4, text: `Линия за вами${diff != null && diff > 0 ? `: к 10-й минуте ваша пара на ${r1(diff / 1000)}к золота впереди` : ""}.` });
    if (s10.dmg.norm && s10.dmg.me >= s10.dmg.norm * 1.25) moments.push({ t: 600, kind: "lane", w: 3, text: `Хорошо харасил на линии: к 10-й минуте ${s10.dmg.me.toLocaleString("ru-RU")} урона по героям при норме ${s10.dmg.norm.toLocaleString("ru-RU")}.` });
    if (s10.stacks.me >= 2 && s10.stacks.norm != null && s10.stacks.me >= s10.stacks.norm + 1) moments.push({ t: 600, kind: "lane", w: 2, text: `Стаки: до 10-й минуты ${s10.stacks.me} ${plural(s10.stacks.me, "лагерь", "лагеря", "лагерей")} при норме ${s10.stacks.norm}.` });
  } else if (r10) {
    const diff = r10.nw.opp != null ? r10.nw.me - r10.nw.opp : null;
    const farm = r10.lh.norm ? r10.lh.me / r10.lh.norm : 0;
    const laneWon = (diff != null && diff >= 500) || lane.outcome === "won" || lane.outcome === "stomp";
    const farmText = farm >= 1.1 ? `${r10.lh.me} добитых при норме ${Math.round(r10.lh.norm!)}` : "";
    if (laneWon) moments.push({ t: 600, kind: "lane", w: 4, text: `Линия за тобой${diff != null && diff > 0 ? `: к 10-й минуте на ${r1(diff / 1000)}к нетворса больше, чем у соперника` : ""}${farmText ? `${diff != null && diff > 0 ? "," : ":"} ${farmText}` : ""}.` });
    else if (farmText) moments.push({ t: 600, kind: "lane", w: 3, text: `Фарм на линии выше нормы: к 10-й минуте ${farmText}.` });
  }
  // руны на миде: силовые руны до 20-й минуты против соперника
  if ((me.position ?? 2) === 2 && opp) {
    const power = (p: MPlayer) => p.runes.filter((r, i, a) => r.t < 1200 && !["BOUNTY", "WATER", "WISDOM"].includes(r.rune) && !a.slice(0, i).some((x) => x.rune === r.rune && r.t - x.t < 60));
    const mineR = power(me), theirR = power(opp);
    if (mineR.length >= 3 && mineR.length >= theirR.length + 2) moments.push({ t: mineR[mineR.length - 1].t, kind: "runes", w: 2, text: `Контроль рун: до 20-й минуты ты забрал ${mineR.length} ${plural(mineR.length, "руну", "руны", "рун")}, соперник ${theirR.length}.` });
  }
  const topMoments = moments.sort((a, b) => b.w - a.w).slice(0, 6).sort((a, b) => a.t - b.t).map(({ w: _w, ...x }) => x);

  // сильные стороны против нормы героя (средние Divine/Immortal за матч, пересчитанные на длину этого матча)
  const strengths: { score: number; label: string; text: string }[] = [];
  const mins = dur / 60;
  const teamKills = enemies.reduce((n, p) => n + p.deathsAt.length, 0);
  const kp = teamKills ? (me.kills + me.assists) / teamKills : 0;
  if (teamKills >= 10 && kp >= 0.6) strengths.push({ score: kp * 1.6, label: "участие в драках", text: `Участие в ${Math.round(kp * 100)}% убийств команды: ты был почти в каждой драке.` });
  if (bench?.avgDuration) {
    const per = (v: number) => v / bench.avgDuration;
    const dmg = me.heroDamage / mins, dmgN = per(bench.overall.heroDamage);
    if (dmgN > 0 && dmg / dmgN >= 1.15) strengths.push({ score: dmg / dmgN, label: "дамаг по героям", text: `Дамаг по героям ${Math.round(dmg)} в минуту при норме ${Math.round(dmgN)}: на ${Math.round((dmg / dmgN - 1) * 100)}% выше.` });
    const tw = me.towerDamage / mins, twN = per(bench.overall.towerDamage);
    if (twN > 20 && tw / twN >= 1.3) strengths.push({ score: tw / twN * 0.9, label: "пуш", text: `Урон по строениям на ${Math.round((tw / twN - 1) * 100)}% выше нормы: хорошо пушил.` });
    const nw = me.networth / mins, nwN = per(bench.overall.networth);
    if (nwN > 0 && nw / nwN >= 1.1) strengths.push({ score: nw / nwN, label: "фарм", text: `Нафармил больше нормы: ${r1(me.networth / 1000)}к нетворса, в среднем на этом герое за такую игру ${r1((nwN * mins) / 1000)}к.` });
  }
  if (!isSup && r10?.lh.norm && r10.lh.me / r10.lh.norm >= 1.1) strengths.push({ score: r10.lh.me / r10.lh.norm, label: "фарм на линии", text: `Фарм на линии: ${r10.lh.me} добитых к 10-й минуте при норме ${Math.round(r10.lh.norm)}.` });
  for (const w of windows) if (w.norm != null && w.norm >= 1 && w.mine <= w.norm * 0.7) strengths.push({ score: 1.1 + (w.norm - w.mine) / w.norm / 2, label: `мало смертей ${w.label}`, text: `${w.label[0].toUpperCase() + w.label.slice(1)} ${w.mine === 0 ? "ни одной смерти" : `${w.mine} ${plural(w.mine, "смерть", "смерти", "смертей")}`} при норме ${w.norm}: играл аккуратно.` });
  if (plan.style === "support" && me.wardsPlaced >= 12) strengths.push({ score: 1.2 + me.wardsPlaced / 100, label: "обзор", text: `Обзор: поставил ${me.wardsPlaced} ${plural(me.wardsPlaced, "вард", "варда", "вардов")}${me.wardsKilled ? ` и снёс ${me.wardsKilled} ${plural(me.wardsKilled, "вражеский", "вражеских", "вражеских")}` : ""}.` });
  const top3 = strengths.sort((a, b) => b.score - a.score).filter((x, i, a) => !(x.label === "фарм на линии" && a.some((y) => y.label === "фарм"))).slice(0, 3);
  const labels = top3.slice(0, 2).map((x) => x.label);
  if (labels.length) summary.splice(1, 0, `${labels.length > 1 ? "Сильные стороны матча" : "Сильная сторона матча"}: ${labels.join(" и ")}.`);
  const topStrengths = top3.map((x) => x.text);

  return { ...base, summary, deathList, windows, lane, tips: tips.slice(0, 3), moments: topMoments, strengths: topStrengths };
}
