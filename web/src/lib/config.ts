import fs from "node:fs";
import path from "node:path";
import { USER_DIR } from "./paths";

export type AppConfig = { stratzToken: string; steamAccountId: number | null; githubToken?: string };

const FILE = path.join(USER_DIR, "config.json");

/** Настройки: файл config.json в папке пользователя, с запасным вариантом из переменных окружения (.env в разработке). */
export function readConfig(): AppConfig {
  let c: Partial<AppConfig> = {};
  try { c = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch {}
  return {
    stratzToken: c.stratzToken || process.env.STRATZ_TOKEN || "",
    steamAccountId: c.steamAccountId ?? (process.env.STEAM_ACCOUNT_ID ? Number(process.env.STEAM_ACCOUNT_ID) : null),
    githubToken: c.githubToken || "",
  };
}

export function writeConfig(c: AppConfig) {
  fs.mkdirSync(USER_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(c, null, 2));
}
