import fs from "node:fs";
import path from "node:path";
import { USER_DIR } from "./paths";

/** Аккаунт Steam, для которого загружены пул и личная история. */
export type Account = { id: number; name?: string; addedAt: number; anonymous?: boolean }; // anonymous: профиль закрыт в Доте, Stratz не видит его матчи
export type AppConfig = {
  stratzToken: string;
  steamAccountId: number | null; // аккаунт по умолчанию: берётся, когда Дота не сообщила, кто играет
  accounts: Account[];
  githubToken?: string;
  screenCapture?: boolean;
  onboardingDone?: boolean; // экран первого запуска пройден или пропущен
};

const FILE = path.join(USER_DIR, "config.json");

/** Настройки: файл config.json в папке пользователя, с запасным вариантом из переменных окружения (.env в разработке). */
export function readConfig(): AppConfig {
  let c: Partial<AppConfig> = {};
  try { c = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch {}
  const steamAccountId = c.steamAccountId ?? (process.env.STEAM_ACCOUNT_ID ? Number(process.env.STEAM_ACCOUNT_ID) : null);
  const accounts = Array.isArray(c.accounts) ? c.accounts.filter((a) => Number.isInteger(a?.id) && a.id > 0) : [];
  // старый конфиг с одним Steam ID: он и есть первый аккаунт
  if (steamAccountId && !accounts.some((a) => a.id === steamAccountId)) accounts.unshift({ id: steamAccountId, addedAt: 0 });
  return {
    stratzToken: c.stratzToken || process.env.STRATZ_TOKEN || "",
    steamAccountId,
    accounts,
    githubToken: c.githubToken || "",
    screenCapture: c.screenCapture !== false, // по умолчанию включено
    onboardingDone: c.onboardingDone === true,
  };
}

export function writeConfig(c: AppConfig) {
  fs.mkdirSync(USER_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(c, null, 2));
}

/** Нормализует Steam ID: принимает и 64-битный. */
export function toSteam32(v: string | number): number | null {
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = BigInt(s);
  if (n <= BigInt(0)) return null;
  const base = BigInt("76561197960265728");
  return Number(n > base ? n - base : n);
}
