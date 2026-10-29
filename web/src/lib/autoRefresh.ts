// Автообновление меты: раз в неделю, само, когда Дота не на стадии пиков.
// Раньше мета обновлялась только кнопкой в настройках и устаревала.
import { dataUpdatedAt } from "./refresh";
import { refreshState, startRefresh } from "./refreshState";
import { currentAccount } from "./accounts";
import { readConfig } from "./config";
import { snapshot } from "./gsi";

export const REFRESH_EVERY_DAYS = 7;
const BUSY_PHASES = new Set(["DOTA_GAMERULES_STATE_HERO_SELECTION", "DOTA_GAMERULES_STATE_STRATEGY_TIME"]);

const g = globalThis as unknown as { __autoRefresh?: boolean };
export function ensureAutoRefresh() {
  if (g.__autoRefresh) return;
  g.__autoRefresh = true;
  const t = setInterval(() => { try { autoRefreshTick(); } catch {} }, 30 * 60_000);
  (t as { unref?: () => void }).unref?.();
  setTimeout(() => { try { autoRefreshTick(); } catch {} }, 60_000); // первая проверка через минуту после старта
}

/** Пора ли обновлять: данных нет или им больше недели. */
export function refreshDue(): boolean {
  const at = dataUpdatedAt();
  return !at || Date.now() / 1000 - at > REFRESH_EVERY_DAYS * 86400;
}

function autoRefreshTick() {
  if (!refreshDue()) return;
  if (refreshState().running) return;
  if (!readConfig().stratzToken) return;
  const s = snapshot();
  if (s.connected && BUSY_PHASES.has(s.draft?.phase ?? "")) return; // не мешаем на пиках
  startRefresh({ accountId: currentAccount().id, general: true });
}
