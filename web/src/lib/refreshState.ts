// Одно обновление данных за раз; состояние живёт в памяти сервера (его опрашивают настройки и пикер).
import { readConfig } from "./config";
import { refreshAccount, refreshGeneral } from "./refresh";

export type RefreshState = { running: boolean; message: string; error: string | null; finishedAt: number | null; accountId: number | null };
const g = globalThis as unknown as { __refreshState?: RefreshState };
export const refreshState = (): RefreshState => (g.__refreshState ??= { running: false, message: "", error: null, finishedAt: null, accountId: null });

/** Запускает обновление: общие данные (если general) и/или пул аккаунта. */
export function startRefresh({ accountId, general }: { accountId: number | null; general: boolean }): { ok: true } | { ok: false; error: string } {
  const st = refreshState();
  if (st.running) return { ok: false, error: "уже идёт" };
  const { stratzToken } = readConfig();
  if (!stratzToken) return { ok: false, error: "Сначала укажи токен Stratz в настройках" };
  st.running = true; st.error = null; st.message = "старт"; st.accountId = accountId;
  const progress = (m: string) => { st.message = m; };
  (async () => {
    if (general) await refreshGeneral(stratzToken, progress);
    if (accountId) await refreshAccount(stratzToken, accountId, progress);
    progress("готово");
  })()
    .catch((e) => { st.error = String(e?.message ?? e); })
    .finally(() => { st.running = false; st.finishedAt = Math.floor(Date.now() / 1000); });
  return { ok: true };
}
