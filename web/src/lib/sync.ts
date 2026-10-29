import { readLog, writeLog, type DraftLog } from "./log";
import { readConfig } from "./config";
import { saveLabels, type MatchLabel } from "./labels";
import { fetchMatchDetails } from "./matchDetails";
import { fetchBench } from "./bench";

type P = { steamAccountId: number | null; heroId: number; isRadiant: boolean; isVictory: boolean; playerSlot: number };
type M = { id: number; startDateTime: number; durationSeconds: number; didRadiantWin: boolean; lobbyType?: string; players: P[] };

export type SyncResult = { ok: boolean; error?: string; updated: number; pending: number; fetched?: number };

const STRATZ = (token: string, query: string) => fetch("https://api.stratz.com/graphql", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "STRATZ_API" },
  body: JSON.stringify({ query }),
}).then((r) => r.json());

const PLAYER_FIELDS = "players { steamAccountId heroId isRadiant isVictory playerSlot }";

/** Матч по номеру из Stratz; null, если Stratz его не знает (все игроки с закрытыми профилями, матч ещё не подтянут). */
async function stratzMatch(token: string, id: string): Promise<M | null> {
  try {
    const j = await STRATZ(token, `{ match(id: ${id}) { id startDateTime durationSeconds didRadiantWin lobbyType ${PLAYER_FIELDS} } }`);
    const m = j?.data?.match;
    return m && Array.isArray(m.players) && m.players.length ? m : null;
  } catch { return null; }
}

/**
 * Матч по номеру из OpenDota: открытый API без ключа, при первом запросе сам берёт матч у Valve, поэтому отвечает
 * и за закрытые профили (игроки без account_id). Нужен, когда играли с аккаунта с выключенным «Expose Public Match Data»:
 * Stratz такие матчи не хранит.
 */
async function openDotaMatch(id: string): Promise<M | null> {
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20_000);
    const r = await fetch(`https://api.opendota.com/api/matches/${id}`, { headers: { "User-Agent": "dota-mid-helper" }, signal: ctrl.signal }).finally(() => clearTimeout(t));
    if (!r.ok) return null;
    const d = await r.json() as { match_id?: number; radiant_win?: boolean; duration?: number; start_time?: number; players?: { player_slot: number; hero_id: number; account_id?: number | null }[] };
    if (!d?.match_id || !Array.isArray(d.players) || d.players.length === 0 || typeof d.radiant_win !== "boolean") return null;
    const players: P[] = d.players.map((p) => { const isRadiant = p.player_slot < 128; return { steamAccountId: p.account_id ?? null, heroId: p.hero_id, isRadiant, isVictory: isRadiant === d.radiant_win, playerSlot: p.player_slot }; });
    return { id: d.match_id, startDateTime: d.start_time ?? 0, durationSeconds: d.duration ?? 0, didRadiantWin: d.radiant_win, players };
  } catch { return null; }
}

/** Список матчей аккаунта из Stratz (пустой у закрытого профиля). */
async function stratzPlayerMatches(token: string, me: number, oldest: number): Promise<M[]> {
  const matches: M[] = [];
  for (let skip = 0; skip < 500; skip += 50) {
    const j = await STRATZ(token, `{ player(steamAccountId: ${me}) { matches(request: {take: 50, skip: ${skip}}) { id startDateTime durationSeconds didRadiantWin lobbyType ${PLAYER_FIELDS} } } }`);
    const page: M[] = j?.data?.player?.matches ?? [];
    matches.push(...page);
    if (page.length < 50 || Math.min(...page.map((m) => m.startDateTime)) < oldest - 3600) break;
  }
  return matches;
}

/** Свой игрок в матче: по Steam ID, а у закрытого профиля (id скрыт) по выбранному герою, он в матче один. */
function meIn(m: M, me: number, heroId: number): P | undefined {
  return m.players.find((p) => p.steamAccountId === me) ?? m.players.find((p) => p.heroId === heroId);
}

/** Разбор матча и норма героя для записи; тихо, без исключений. */
export async function attachDetails(rec: DraftLog, ME: number) {
  if (!rec.matchId || rec.details) return;
  rec.details = await fetchMatchDetails(rec.matchId, ME, rec.chosenHeroId);
  const pos = rec.details?.position ?? rec.role ?? 2;
  rec.bench = await fetchBench(rec.chosenHeroId, pos);
}

function apply(rec: DraftLog, m: M, me: P, now: number, labels: MatchLabel[]) {
  rec.matchId = m.id; rec.won = me.isVictory; rec.durationSeconds = m.durationSeconds; rec.syncedAt = now;
  // старые записи без аккаунта: кто из известных аккаунтов был в матче, тот и играл
  if (!rec.accountId) { const known = readConfig().accounts.map((a) => a.id); const mine = m.players.find((p) => p.steamAccountId && known.includes(p.steamAccountId)); if (mine?.steamAccountId) rec.accountId = mine.steamAccountId; else if (me.steamAccountId) rec.accountId = me.steamAccountId; }
  // сверка игроков из server_log.txt с матчем: те же Steam ID и тот же порядок (слот 0–4 Свет, 5–9 Тьма по playerSlot)
  if (rec.players?.length === 10) {
    const bySlot = [...m.players].sort((a, b) => a.playerSlot - b.playerSlot);
    const known = bySlot.filter((p) => p.steamAccountId);
    const sameSet = known.every((p) => rec.players!.some((x) => x.accountId === p.steamAccountId));
    const sameOrder = known.every((p) => { const i = bySlot.indexOf(p); return rec.players![i]?.accountId === p.steamAccountId; });
    rec.playersVerified = known.length >= 5 ? sameSet && sameOrder : undefined;
  }
  // разметка слотов для самообучения портретов: порядок игроков в верхней панели = playerSlot
  const bySlot = (radiant: boolean) => m.players.filter((p) => p.isRadiant === radiant).sort((a, b) => a.playerSlot - b.playerSlot).map((p) => p.heroId);
  labels.push({ matchId: String(m.id), radiant: bySlot(true), dire: bySlot(false), at: now });
}

/**
 * Подтягивает результаты для записей журнала без результата и пишет разметку слотов для самообучения.
 * Запись с номером матча из Доты ищется по номеру: Stratz, затем OpenDota. Остальные (ручные, без GSI) — по списку
 * матчей аккаунта, с которого играли (у каждой записи свой accountId; старые без него: аккаунт по умолчанию).
 */
export async function syncResults(): Promise<SyncResult> {
  const { stratzToken: TOKEN, steamAccountId: DEFAULT } = readConfig();
  if (!TOKEN) return { ok: false, error: "Укажи токен Stratz в настройках", updated: 0, pending: 0 };
  const items = readLog();
  const pending = items.filter((x) => x.matchId == null && !x.noMatch);
  if (pending.length === 0) return { ok: true, updated: 0, pending: 0 };

  let updated = 0, fetched = 0;
  const now = Math.floor(Date.now() / 1000);
  const labels: MatchLabel[] = [];
  const byList: DraftLog[] = [];
  for (const rec of pending) {
    rec.triedAt = now;
    const ME = rec.accountId ?? DEFAULT ?? 0;
    if (rec.gsiMatchId) {
      const m = (await stratzMatch(TOKEN, rec.gsiMatchId)) ?? (await openDotaMatch(rec.gsiMatchId));
      if (m) { fetched++; const me = meIn(m, ME, rec.chosenHeroId); if (me) { apply(rec, m, me, now, labels); await attachDetails(rec, ME); updated++; } }
      continue;
    }
    byList.push(rec);
  }
  // записи без номера матча: по списку матчей аккаунта
  const byAccount = new Map<number, DraftLog[]>();
  for (const rec of byList) { const id = rec.accountId ?? DEFAULT; if (id) byAccount.set(id, [...(byAccount.get(id) ?? []), rec]); }
  for (const [ME, recs] of byAccount) {
    const oldest = Math.min(...recs.map((x) => x.createdAt));
    let matches: M[] = [];
    try { matches = await stratzPlayerMatches(TOKEN, ME, oldest); } catch {}
    fetched += matches.length;
    for (const rec of recs) {
      // матч должен начаться не раньше чем за 15 минут до сохранения драфта и не позже чем через 40 минут после
      const cands = matches.filter((m) => m.startDateTime >= rec.createdAt - 15 * 60 && m.startDateTime <= rec.createdAt + 40 * 60);
      const hit = cands.find((m) => {
        const me = m.players.find((p) => p.steamAccountId === ME);
        if (!me || me.heroId !== rec.chosenHeroId) return false;
        const enemyIds = m.players.filter((p) => p.isRadiant !== me.isRadiant).map((p) => p.heroId);
        const overlap = rec.enemies.filter((e) => enemyIds.includes(e.id)).length;
        return rec.enemies.length === 0 || overlap >= Math.min(2, rec.enemies.length);
      });
      if (hit) { apply(rec, hit, hit.players.find((p) => p.steamAccountId === ME)!, now, labels); await attachDetails(rec, ME); updated++; }
      else if (now - rec.createdAt > 6 * 3600 && matches.some((m) => m.startDateTime > rec.createdAt + 40 * 60)) {
        // прошло много времени и есть более поздние матчи, а подходящего нет: игра не состоялась
        rec.noMatch = true; rec.syncedAt = now;
      }
    }
  }
  writeLog(items);
  if (labels.length) saveLabels(labels);
  return { ok: true, updated, pending: pending.length - updated, fetched };
}

/**
 * Автосинхронизация: раз в 5 минут проверяет, есть ли записи без результата, которым уже больше 8 минут
 * (матч мог закончиться и попасть в Stratz), и не чаще раза в 15 минут на запись ходит в Stratz.
 * Сами результаты раньше появлялись только по кнопке в истории, и самообучение портретов без них не запускалось.
 */
const g = globalThis as unknown as { __autoSync?: boolean };
export function ensureAutoSync() {
  if (g.__autoSync) return;
  g.__autoSync = true;
  const t = setInterval(() => { autoSyncTick().catch(() => {}); }, 5 * 60_000);
  (t as { unref?: () => void }).unref?.();
}
async function autoSyncTick() {
  const now = Math.floor(Date.now() / 1000);
  const due = readLog().some((x) => x.matchId == null && !x.noMatch && now - x.createdAt > 8 * 60 && now - x.createdAt < 12 * 3600 && (!x.triedAt || now - x.triedAt > 15 * 60));
  if (!due) return;
  await syncResults();
}
