import { loadData } from "@/lib/data";
import DraftBoard from "@/components/DraftBoard";

export const dynamic = "force-dynamic"; // данные читаются при каждом запросе, не при сборке

export default function Page() {
  const { heroes, pool, aliases } = loadData();
  const games = (p: { midGames: number; byRole?: Record<string, { games: number }> }, r: number) => p.byRole?.[String(r)]?.games ?? (r === 2 ? p.midGames : 0);
  const poolByRole: Record<number, number[]> = {};
  const familiarByRole: Record<number, number[]> = {};
  for (const r of [1, 2, 3, 4, 5]) {
    poolByRole[r] = [...pool.values()].filter((p) => games(p, r) >= 10).map((p) => p.heroId);
    familiarByRole[r] = [...pool.values()].filter((p) => games(p, r) >= 3 && games(p, r) < 10).map((p) => p.heroId);
  }
  const sorted = [...heroes].sort((a, b) => a.name.localeCompare(b.name));
  return <DraftBoard heroes={sorted} poolByRole={poolByRole} familiarByRole={familiarByRole} aliases={aliases} />;
}
