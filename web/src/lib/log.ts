import fs from "node:fs";
import path from "node:path";
import { USER_DIR } from "./paths";
import type { Pick, Role } from "./types";

export type LogRec = {
  heroId: number;
  name: string;
  finalScore: number;
  draftScore: number;
  rank: number;           // место в общем списке (1 = лучший)
  poolStatus: "pool" | "familiar" | "outside";
};

export type DraftLog = {
  id: string;
  createdAt: number;              // unix seconds
  bans: number[];
  enemies: Pick[];
  allies: Pick[];
  enemyRoles: { id: number; role: Role; locked: boolean }[];
  chosenHeroId: number;
  role?: number;                  // роль игрока при оценке (1..5)
  gsiMatchId?: string;            // id матча из Доты, если был
  chosen: LogRec | null;          // как оценивался выбранный герой
  topPool: LogRec[];              // топ-5 из пула на момент выбора
  topAll: LogRec[];               // топ-5 общий
  // заполняется синхронизацией со Stratz
  matchId?: number;
  won?: boolean;
  durationSeconds?: number;
  syncedAt?: number;
  noMatch?: boolean;              // искали, но не нашли подходящий матч
};

const FILE = path.join(USER_DIR, "draft-log.json");

export function readLog(): DraftLog[] {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")) as DraftLog[]; } catch { return []; }
}

export function writeLog(items: DraftLog[]) {
  fs.mkdirSync(USER_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(items, null, 1));
}

export function appendLog(item: DraftLog) {
  const items = readLog();
  items.push(item);
  writeLog(items);
}
