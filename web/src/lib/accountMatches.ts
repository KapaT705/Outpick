// Рейтинговые матчи аккаунта из Stratz для истории: и те, что пикер не записывал. Короткая запись на матч
// (герой, позиция, итог, KDA, минуты смертей) хранится в папке аккаунта, matches.json; первый раз качается
// ~100 дней, дальше раз в 10 минут только свежая страница. У закрытого профиля Stratz ничего не отдаёт.
import fs from "node:fs";
import path from "node:path";
import { accountDir } from "./accounts";
import { readConfig } from "./config";
import { fetchBenches } from "./bench";

export type AccMatch = {
  id: number; startDateTime: number; durationSeconds: number;
  heroId: number; position: number | null; won: boolean; kills: number; deaths: number; assists: number;
  parsed: boolean; deathTimes: number[]; // секунды; только у разобранных Stratz матчей
};
type Store = { at: number; full: boolean; items: AccMatch[]; v?: number };

const V = 1;
const FRESH = 10 * 60;
const DEPTH = 100 * 86400;
const file = (acc: number) => path.join(accountDir(acc), "matches.json");

function read(acc: number): Store | null {
  try { const s = JSON.parse(fs.readFileSync(file(acc), "utf8")) as Store; return s.v === V ? s : null; } catch { return null; }
}

type SD = { time: number; timeDead: number | null };
type SM = { id: number; startDateTime: number; durationSeconds: number; players: { heroId: number; position: string | null; isVictory: boolean; kills: number; deaths: number; assists: number; stats?: { deathEvents?: SD[] | null } | null }[] };

async function page(token: string, acc: number, skip: number): Promise<AccMatch[] | null> {
  const q = `{ player(steamAccountId: ${acc}) { matches(request: {take: 50, skip: ${skip}, lobbyTypeIds: [7]}) { id startDateTime durationSeconds players(steamAccountId: ${acc}) { heroId position isVictory kills deaths assists stats { deathEvents { time timeDead } } } } } }`;
  try {
    const r = await fetch("https://api.stratz.com/graphql", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "STRATZ_API" }, body: JSON.stringify({ query: q }) });
    const j = await r.json();
    const ms: SM[] | undefined = j?.data?.player?.matches;
    if (!Array.isArray(ms)) return null;
    return ms.filter((m) => m.players?.[0]).map((m) => {
      const p = m.players[0];
      const ev = p.stats?.deathEvents;
      // как в matchData: настоящая смерть та, после которой герой лежит, и следующая не раньше воскрешения
      const times: number[] = [];
      let until = -Infinity;
      for (const d of [...(ev ?? [])].filter((d) => (d.timeDead ?? 0) > 0).sort((a, b) => a.time - b.time)) if (d.time >= until) { times.push(d.time); until = d.time + (d.timeDead ?? 0); }
      return { id: m.id, startDateTime: m.startDateTime, durationSeconds: m.durationSeconds, heroId: p.heroId, position: p.position ? Number(p.position.replace("POSITION_", "")) || null : null, won: p.isVictory, kills: p.kills, deaths: p.deaths, assists: p.assists, parsed: Array.isArray(ev), deathTimes: times };
    });
  } catch { return null; }
}

/** Матчи аккаунта, самые новые сначала. force: обновить свежую страницу сразу, не дожидаясь 10 минут. */
export async function accountMatches(acc: number, force = false): Promise<{ items: AccMatch[]; at: number; error?: string }> {
  const cfg = readConfig();
  const store = read(acc) ?? { at: 0, full: false, items: [], v: V };
  const now = Math.floor(Date.now() / 1000);
  if (cfg.accounts.find((a) => a.id === acc)?.anonymous) return { items: store.items, at: store.at, error: "Профиль закрыт: Stratz не видит матчи этого аккаунта" };
  if (!cfg.stratzToken) return { items: store.items, at: store.at, error: "Укажи токен Stratz в настройках" };
  if (!force && store.full && now - store.at < FRESH) return { items: store.items, at: store.at };
  const byId = new Map(store.items.map((m) => [m.id, m]));
  let error: string | undefined;
  for (let skip = 0; skip < 600; skip += 50) {
    const got = await page(cfg.stratzToken, acc, skip);
    if (!got) { error = "Stratz не ответил, показаны сохранённые матчи"; break; }
    const known = got.filter((m) => byId.has(m.id) && byId.get(m.id)!.parsed).length;
    for (const m of got) byId.set(m.id, m);
    // дальше не нужно: страница последняя, ушли глубже 100 дней или (после первой загрузки) дошли до уже известных
    if (got.length < 50 || Math.min(...got.map((m) => m.startDateTime)) < now - DEPTH || (store.full && known > 0)) { if (!error) store.full = true; break; }
  }
  const items = [...byId.values()].filter((m) => m.startDateTime >= now - DEPTH - 30 * 86400).sort((a, b) => b.startDateTime - a.startDateTime);
  const next: Store = { at: error ? store.at : now, full: store.full, items, v: V };
  fs.mkdirSync(accountDir(acc), { recursive: true });
  fs.writeFileSync(file(acc), JSON.stringify(next));
  return { items, at: next.at, error };
}

/** Нормы смертей для сводки: «герой-позиция» → смерти к минуте t (элемент t, накопительно), средние Divine/Immortal. */
export async function deathNorms(items: AccMatch[]): Promise<Record<string, number[]>> {
  const byPos = new Map<number, Set<number>>();
  for (const m of items) if (m.parsed && m.position) byPos.set(m.position, (byPos.get(m.position) ?? new Set()).add(m.heroId));
  const out: Record<string, number[]> = {};
  for (const [pos, heroes] of byPos) {
    const benches = await fetchBenches(pos, [...heroes]);
    for (const [heroId, b] of benches) {
      const arr = [0];
      for (let t = 1; t <= 60; t++) arr[t] = b.byTime?.filter((r) => r.t <= t).at(-1)?.deaths ?? arr[t - 1];
      out[`${heroId}-${pos}`] = arr.map((x) => Math.round(x * 100) / 100);
    }
  }
  return out;
}
