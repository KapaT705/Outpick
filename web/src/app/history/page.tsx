import { readLog } from "@/lib/log";
import { loadData } from "@/lib/data";
import HistoryView from "@/components/HistoryView";

export const dynamic = "force-dynamic";

export default function HistoryPage() {
  const { heroes } = loadData();
  const items = readLog().sort((a, b) => b.createdAt - a.createdAt);
  return <HistoryView items={items} heroes={heroes} />;
}
