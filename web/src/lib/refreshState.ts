// Одно обновление данных за раз; состояние живёт в памяти сервера (его опрашивают настройки и пикер).
import { readConfig } from "./config";
import { refreshAccount, refreshGeneral } from "./refresh";

export type RefreshState = { running: boolean; message: string; error: string | null; finishedAt: number | null; accountId: number | null };
const g = globalThis as unknown as { __refreshState?: RefreshState };
export const refreshState = (): RefreshState => (g.__refreshState ??= { running: false, message: "", error: null, finishedAt: null, accountId: null });

/** Текст ошибки для человека: сетевые и ответы Stratz своими словами, остальное как есть. */
function humanError(e: unknown): string {
  const m = String((e as { message?: string })?.message ?? e);
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|TimeoutError|aborted|socket hang up/i.test(m)) return "нет связи со Stratz, проверь интернет";
  if (/401|403|unauthorized|forbidden/i.test(m)) return "Stratz не принял токен, проверь его в настройках";
  if (/429|rate limit|too many/i.test(m)) return "Stratz ограничил запросы, попробуй через час";
  if (/NO_MATCHES_PRIVATE/.test(m)) return "у Stratz нет ранговых игр этого аккаунта за год: профиль закрыт. В Доте включи «Expose Public Match Data» (Настройки → Социальное) и загрузи историю ещё раз";
  if (/NO_MATCHES/.test(m)) return "у Stratz нет ранговых игр этого аккаунта за год: проверь номер или включи в Доте «Expose Public Match Data» (Настройки → Социальное)";
  if (/Stratz HTTP 5\d\d|Stratz ответил не данными|Unexpected token/.test(m)) return "Stratz сейчас недоступен, попробуй позже";
  if (/Cannot read properties of null/.test(m)) return "Stratz не отдал данные аккаунта: профиль закрыт или номер неверный";
  if (/Cannot read properties of undefined/.test(m)) return "Stratz ответил неполными данными, попробуй позже";
  return m;
}

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
    .catch((e) => { st.error = humanError(e); })
    .finally(() => { st.running = false; st.finishedAt = Math.floor(Date.now() / 1000); });
  return { ok: true };
}
