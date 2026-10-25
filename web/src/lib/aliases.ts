import type { Hero } from "./types";

export type AliasMap = Record<string, string[]>; // heroId -> aliases

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9\s-]/g, " ").replace(/\s+/g, " ").trim();

export type ParseResult = { ids: number[]; unknown: string[] };

/** Разбирает строку вроде "пудж ам сф лион шейкер" или "storm, crystal maiden" в список героев. */
export function parseHeroText(text: string, heroes: Hero[], aliases: AliasMap): ParseResult {
  const entries: { key: string; id: number }[] = [];
  for (const h of heroes) {
    const keys = new Set<string>([norm(h.name), norm(h.name).replace(/-/g, " "), norm(h.short.replace(/_/g, " ")), ...(aliases[String(h.id)] ?? []).map(norm)]);
    for (const k of keys) if (k) entries.push({ key: k, id: h.id });
  }
  const exact = new Map<string, number>();
  for (const e of entries) if (!exact.has(e.key)) exact.set(e.key, e.id);

  const tokens = norm(text.replace(/,/g, " ")).split(" ").filter(Boolean);
  const ids: number[] = [];
  const unknown: string[] = [];
  const push = (id: number) => { if (!ids.includes(id)) ids.push(id); };

  let i = 0;
  while (i < tokens.length) {
    // сначала пробуем пары слов: "crystal maiden", "дарк сир"
    const two = i + 1 < tokens.length ? `${tokens[i]} ${tokens[i + 1]}` : null;
    if (two && exact.has(two)) { push(exact.get(two)!); i += 2; continue; }
    const one = tokens[i];
    if (exact.has(one)) { push(exact.get(one)!); i += 1; continue; }
    // префикс: "инвок" -> инвокер, "necro" -> necrophos (только если однозначно)
    if (one.length >= 3) {
      const cand = new Set(entries.filter((e) => e.key.startsWith(one)).map((e) => e.id));
      if (cand.size === 1) { push([...cand][0]); i += 1; continue; }
    }
    unknown.push(one);
    i += 1;
  }
  return { ids, unknown };
}
