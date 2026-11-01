import { loadData } from "@/lib/data";
import { readLog } from "@/lib/log";
import MatchReportView from "@/components/MatchReportView";

export const dynamic = "force-dynamic";

/** Разбор одного матча: /history/<номер матча>?me=<steam32>&hero=<id>. Сам отчёт грузится на странице, Stratz отвечает не сразу. */
export default async function MatchPage({ params, searchParams }: { params: Promise<{ match: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { match } = await params;
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const matchId = Number(match) || 0;
  const { heroes } = loadData(null);
  // запись пикера по этому матчу, если была: как пикер оценивал взятого героя
  const draft = readLog().find((x) => x.matchId === matchId) ?? null;
  const me = Number(one(q.me)) || draft?.accountId || null;
  const hero = Number(one(q.hero)) || draft?.chosenHeroId || null;
  return <MatchReportView matchId={matchId} me={me} hero={hero} heroes={heroes} draft={draft} />;
}
