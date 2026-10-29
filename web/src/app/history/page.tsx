import { readLog } from "@/lib/log";
import { loadData } from "@/lib/data";
import { readConfig } from "@/lib/config";
import { currentAccount } from "@/lib/accounts";
import HistoryView from "@/components/HistoryView";

export const dynamic = "force-dynamic";

export default function HistoryPage() {
  const { heroes } = loadData(null);
  const items = readLog().sort((a, b) => b.createdAt - a.createdAt);
  const cfg = readConfig();
  // имена аккаунтов для пометок в записях; старые записи без аккаунта относятся к аккаунту по умолчанию
  const accounts = Object.fromEntries(cfg.accounts.map((a) => [a.id, a.name ?? String(a.id)]));
  // история по умолчанию только текущего аккаунта (того, под которым идёт игра или выбран по умолчанию)
  return <HistoryView items={items} heroes={heroes} accounts={accounts} defaultAccountId={cfg.steamAccountId} currentAccountId={currentAccount().id} />;
}
