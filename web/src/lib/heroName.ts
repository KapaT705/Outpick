// Имена героев для текстов отчёта: как в клиенте Доты без русификации (Queen of Pain, Necrophos), с родом для
// глаголов: «Necrophos убил», «Lina убила». Имена стоят только в именительном падеже, склонять их не нужно.
import type { Hero } from "./types";

/** Героини: для них глагол в женском роде. */
const FEMALE = new Set([5, 6, 9, 20, 21, 25, 39, 43, 44, 46, 48, 58, 61, 67, 89, 94, 104, 112, 119, 123, 128, 135, 136, 138]);

/** Имя героя и род: f - женский. */
export function heroName(id: number | null | undefined, heroes?: Map<number, Hero>): { name: string; f: boolean } {
  return { name: (id ? heroes?.get(id)?.name : null) ?? "враг", f: !!id && FEMALE.has(id) };
}

/** Глагол прошедшего времени в нужном роде: v(hero, "убил", "убила"). */
export const v = (h: { f: boolean }, m: string, f: string) => (h.f ? f : m);
