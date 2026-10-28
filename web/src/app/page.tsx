import { loadData } from "@/lib/data";
import DraftBoard from "@/components/DraftBoard";

export const dynamic = "force-dynamic"; // данные читаются при каждом запросе, не при сборке

export default function Page() {
  const { heroes, aliases } = loadData(null);
  const sorted = [...heroes].sort((a, b) => a.name.localeCompare(b.name));
  // пул аккаунта пикер берёт сам из /api/accounts: аккаунт меняется, когда Дота сообщает другой Steam ID
  return <DraftBoard heroes={sorted} aliases={aliases} />;
}
