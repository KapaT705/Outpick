import { loadData } from "./data";
import type { Pick, Role, RoleGuess } from "./types";

const ROLES: Role[] = [1, 2, 3, 4, 5];
const FLOOR = 0.01; // никакая роль не считается невозможной

/** Самая вероятная раскладка ролей: каждая роль не более одного раза, зафиксированные пользователем роли не меняются. */
export function inferRoles(picks: Pick[], exclude: Role[] = []): RoleGuess[] {
  const { positions } = loadData();
  const n = picks.length;
  if (n === 0) return [];
  const prior = picks.map((p) => {
    const pos = positions.get(p.id)?.p;
    return ROLES.map((r) => Math.max(FLOOR, pos ? pos[String(r) as "1"] : 0.2));
  });
  // перебор всех назначений без повторов (максимум 5 героев -> 5! = 120 вариантов)
  let best: Role[] | null = null;
  let bestScore = -Infinity;
  const used = new Set<Role>(exclude);
  const cur: Role[] = [];
  const rec = (i: number, score: number) => {
    if (i === n) { if (score > bestScore) { bestScore = score; best = [...cur]; } return; }
    const locked = picks[i].role;
    for (const r of ROLES) {
      if (used.has(r)) continue;
      if (locked && r !== locked) continue;
      used.add(r); cur.push(r);
      rec(i + 1, score + Math.log(prior[i][r - 1]));
      cur.pop(); used.delete(r);
    }
  };
  rec(0, 0);
  if (!best) best = picks.map((p, i) => p.role ?? ROLES[i % 5]); // невозможная фиксация (две одинаковые роли) — отдаём как есть
  const assignment = best as Role[];
  // вероятность "этот герой на этой роли" — доля суммарного веса раскладок, где так и вышло
  const totals = picks.map(() => new Map<Role, number>());
  let grand = 0;
  const rec2 = (i: number, w: number) => {
    if (i === n) { grand += w; for (let k = 0; k < n; k++) totals[k].set(cur[k], (totals[k].get(cur[k]) ?? 0) + w); return; }
    const locked = picks[i].role;
    for (const r of ROLES) {
      if (used.has(r)) continue;
      if (locked && r !== locked) continue;
      used.add(r); cur.push(r);
      rec2(i + 1, w * prior[i][r - 1]);
      cur.pop(); used.delete(r);
    }
  };
  rec2(0, 1);
  return picks.map((p, i) => ({
    id: p.id,
    role: assignment[i],
    prob: p.role ? 1 : grand > 0 ? (totals[i].get(assignment[i]) ?? 0) / grand : 0,
    locked: !!p.role,
  }));
}

/** Вероятность, что герой стоит на одной из указанных ролей (с учётом раскладки). */
export function roleProbability(guesses: RoleGuess[], id: number, roles: Role[]): number {
  const g = guesses.find((x) => x.id === id);
  if (!g) return 0;
  const inSet = roles.includes(g.role);
  if (g.locked) return inSet ? 1 : 0;
  return inSet ? g.prob : Math.min(0.5, 1 - g.prob) * (roles.length / 5);
}
export const midProbability = (guesses: RoleGuess[], id: number) => roleProbability(guesses, id, [2]);
