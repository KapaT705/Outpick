// Аккаунты Steam: какой сейчас играет (по GSI), где лежат его пул и личная история.
//
// Токен Stratz один на всех: по нему качаются общие данные (контрпики, мета). К аккаунту привязаны только
// пул героев, личные винрейты, результаты матчей в истории и разметка для самообучения портретов.
// Дота сообщает Steam ID играющего аккаунта в GSI, поэтому профиль переключается сам; незнакомый аккаунт
// работает в общем режиме (без пула), пока для него не загрузят историю.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, USER_DIR } from "./paths";
import { readConfig, toSteam32, writeConfig, type Account } from "./config";
import { gsiSteamId } from "./gsi";

export const ACCOUNTS_DIR = path.join(USER_DIR, "data", "accounts");
export const accountDir = (id: number) => path.join(ACCOUNTS_DIR, String(id));

export type CurrentAccount = {
  id: number | null;
  source: "gsi" | "manual" | "none"; // откуда известен: Дота сообщила, выбран в настройках, неизвестен
  known: boolean;                    // есть загруженный пул (иначе общий режим)
  name: string | null;
};

/** Аккаунт, для которого упакованы данные пула в сборке (data/player-pool.json). */
function packagedOwner(): number | null {
  try { return Number(JSON.parse(fs.readFileSync(path.join(DATA_DIR, "pool-owner.json"), "utf8")).steamAccountId) || null; } catch { return null; }
}

/** Переносит пул из старого места (USER_DIR/data/*.json без аккаунта) в папку аккаунта по умолчанию. Один раз. */
function migrateLegacy() {
  const { steamAccountId } = readConfig();
  if (!steamAccountId) return;
  const legacy = path.join(USER_DIR, "data");
  const dst = accountDir(steamAccountId);
  if (fs.existsSync(dst)) return;
  const files = ["player-pool.json", "personal-pairs.json"];
  if (!files.some((f) => fs.existsSync(path.join(legacy, f)))) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const f of files) { const src = path.join(legacy, f); if (fs.existsSync(src)) fs.renameSync(src, path.join(dst, f)); }
}

/** Файл с данными аккаунта: папка аккаунта, для владельца упакованных данных — файл из сборки, иначе null. */
export function accountFile(id: number, name: "player-pool.json" | "personal-pairs.json"): string | null {
  migrateLegacy();
  const own = path.join(accountDir(id), name);
  if (fs.existsSync(own)) return own;
  if (packagedOwner() === id) { const p = path.join(DATA_DIR, name); if (fs.existsSync(p)) return p; }
  return null;
}
export const accountKnown = (id: number) => accountFile(id, "player-pool.json") != null;

export function accountUpdatedAt(id: number): number | null {
  try { return JSON.parse(fs.readFileSync(path.join(accountDir(id), "updated-at.json"), "utf8")).at; } catch { return null; }
}

/** Кто играет сейчас: Steam ID из GSI (последнее сообщение Доты), иначе аккаунт по умолчанию из настроек. */
export function currentAccount(): CurrentAccount {
  const cfg = readConfig();
  const fromGsi = toSteam32(gsiSteamId() ?? "");
  const id = fromGsi ?? cfg.steamAccountId;
  const source: CurrentAccount["source"] = fromGsi ? "gsi" : cfg.steamAccountId ? "manual" : "none";
  const acc = id ? cfg.accounts.find((a) => a.id === id) : undefined;
  return { id, source, known: id ? accountKnown(id) : false, name: acc?.name ?? null };
}

/** Добавляет аккаунт в список (без загрузки данных) и при желании делает его аккаунтом по умолчанию. */
export function addAccount(id: number, name?: string, makeDefault = false): Account {
  const cfg = readConfig();
  let acc = cfg.accounts.find((a) => a.id === id);
  if (!acc) { acc = { id, name, addedAt: Math.floor(Date.now() / 1000) }; cfg.accounts.push(acc); }
  else if (name && !acc.name) acc.name = name;
  if (makeDefault || !cfg.steamAccountId) cfg.steamAccountId = id;
  writeConfig(cfg);
  return acc;
}

export function removeAccount(id: number) {
  const cfg = readConfig();
  cfg.accounts = cfg.accounts.filter((a) => a.id !== id);
  if (cfg.steamAccountId === id) cfg.steamAccountId = cfg.accounts[0]?.id ?? null;
  writeConfig(cfg);
  try { fs.rmSync(accountDir(id), { recursive: true, force: true }); } catch {}
}

export function setDefaultAccount(id: number) {
  const cfg = readConfig();
  if (!cfg.accounts.some((a) => a.id === id)) return false;
  cfg.steamAccountId = id;
  writeConfig(cfg);
  return true;
}

/** Список аккаунтов с отметками: знаком ли (есть пул), когда обновлён. */
export function listAccounts() {
  const cfg = readConfig();
  return cfg.accounts.map((a) => ({ ...a, known: accountKnown(a.id), updatedAt: accountUpdatedAt(a.id), isDefault: a.id === cfg.steamAccountId }));
}
