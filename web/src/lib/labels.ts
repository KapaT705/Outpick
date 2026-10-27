import fs from "node:fs";
import path from "node:path";
import { USER_DIR } from "./paths";

/** Герой каждого слота матча (по данным Stratz) для самообучения распознавания экрана пиков в приложении. */
export type MatchLabel = { matchId: string; radiant: number[]; dire: number[]; at: number };

const FILE = path.join(USER_DIR, "pick-labels.json");

export function saveLabels(list: MatchLabel[]) {
  let cur: { matches: Record<string, MatchLabel> } = { matches: {} };
  try { cur = JSON.parse(fs.readFileSync(FILE, "utf8")); cur.matches ??= {}; } catch {}
  for (const l of list) cur.matches[l.matchId] = l;
  const keys = Object.keys(cur.matches).sort((a, b) => cur.matches[b].at - cur.matches[a].at).slice(0, 60);
  cur.matches = Object.fromEntries(keys.map((k) => [k, cur.matches[k]]));
  fs.mkdirSync(USER_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(cur, null, 1));
}
