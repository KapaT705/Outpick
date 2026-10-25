import { loadData } from "@/lib/data";
import DraftBoard from "@/components/DraftBoard";

export const dynamic = "force-dynamic"; // данные читаются при каждом запросе, не при сборке

export default function Page() {
  const { heroes, pool, aliases } = loadData();
  const poolIds = [...pool.values()].filter((p) => p.midGames >= 10).map((p) => p.heroId);
  const familiarIds = [...pool.values()].filter((p) => p.midGames >= 3 && p.midGames < 10).map((p) => p.heroId);
  const sorted = [...heroes].sort((a, b) => a.name.localeCompare(b.name));
  return <DraftBoard heroes={sorted} poolIds={poolIds} familiarIds={familiarIds} aliases={aliases} />;
}
