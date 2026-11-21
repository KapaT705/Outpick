import path from "node:path";
import { USER_DIR } from "./paths";
import { readJsonOrAside, writeJsonAtomic } from "./fsx";

/** Герой каждого слота матча (по данным Stratz) для самообучения распознавания экрана пиков в приложении. */
export type MatchLabel = { matchId: string; radiant: number[]; dire: number[]; at: number };

const FILE = path.join(USER_DIR, "pick-labels.json");

export function saveLabels(list: MatchLabel[]) {
  // битый файл откладывается рядом (readJsonOrAside), а не затирается молча
  const cur: { matches: Record<string, MatchLabel> } = readJsonOrAside<{ matches: Record<string, MatchLabel> }>(FILE) ?? { matches: {} };
  cur.matches ??= {};
  for (const l of list) cur.matches[l.matchId] = l;
  const keys = Object.keys(cur.matches).sort((a, b) => cur.matches[b].at - cur.matches[a].at).slice(0, 60);
  cur.matches = Object.fromEntries(keys.map((k) => [k, cur.matches[k]]));
  writeJsonAtomic(FILE, cur, 1);
}
