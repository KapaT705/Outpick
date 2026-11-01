"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { DraftLog } from "@/lib/log";
import type { Hero } from "@/lib/types";
import type { LaneCell, LaneOutcome, MatchReport, NormCell, ReportDeath, ReportWindow } from "@/lib/report";
import { Button, Card, CardTitle, Chip, Hint } from "@/components/ui";
import Crystals from "@/components/Crystals";
import { heroName } from "@/lib/heroName";

// иконки с CDN Valve: у Stratz alchemist_icon.png оказался копией dragon_knight_icon.png
const icon = (short: string) => `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/icons/${short}.png`;
const portrait = (short: string) => `https://cdn.stratz.com/images/dota2/heroes/${short}_horz.png`;
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
const ROLE_NAME: Record<number, string> = { 1: "керри", 2: "мид", 3: "офлейн", 4: "саппорт 4", 5: "саппорт 5" };
const OUTCOME: Record<NonNullable<LaneOutcome>, { text: string; tone: "good" | "bad" | "muted" }> = {
  stomp: { text: "разгромная победа на линии", tone: "good" }, won: { text: "линия выиграна", tone: "good" }, even: { text: "линия вничью", tone: "muted" },
  lost: { text: "линия проиграна", tone: "bad" }, stomped: { text: "линия проиграна с разгромом", tone: "bad" },
};
const WINDOW_SHORT = (w: ReportWindow) => (w.to == null ? `${w.from}+ мин` : `${w.from}–${w.to} мин`);

export default function MatchReportView({ matchId, me, hero, heroes, draft }: { matchId: number; me: number | null; hero: number | null; heroes: Hero[]; draft: DraftLog | null }) {
  const byId = useMemo(() => new Map(heroes.map((h) => [h.id, h])), [heroes]);
  const [r, setR] = useState<MatchReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const load = useCallback(async (fresh = false) => {
    setBusy(true); setErr(null);
    const qs = new URLSearchParams({ match: String(matchId) });
    if (me) qs.set("me", String(me));
    if (hero) qs.set("hero", String(hero));
    if (fresh) qs.set("fresh", "1");
    const j = await fetch(`/api/report?${qs}`).then((x) => x.json()).catch(() => null);
    if (j?.ok) setR(j.report); else setErr(j?.error ?? "Не удалось получить матч из Stratz");
    setBusy(false);
  }, [matchId, me, hero]);
  useEffect(() => { load(); }, [load]);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-5 flex flex-col gap-5">
      <a href="/history" className="w-fit text-xs text-muted hover:text-foreground">← История</a>
      {busy && !r && <Card className="flex justify-center py-10"><Crystals label="Загружаю матч из Stratz…" /></Card>}
      {err && !busy && (
        <Card tone="bad" className="flex flex-wrap items-center gap-3 text-sm">
          <span className="flex-1">{err}</span>
          <Button size="sm" onClick={() => load(true)}>Попробовать снова</Button>
        </Card>
      )}
      {r && <>
        <Header r={r} byId={byId} draft={draft} />
        {r.parsed ? <>
          <div className="grid gap-5 lg:grid-cols-2 items-start">
            <Good r={r} />
            <Tips r={r} />
          </div>
          <Deaths r={r} />
          <LaneCard r={r} byId={byId} />
        </> : (() => { const recent = Date.now() / 1000 - (r.startDateTime + r.durationSeconds) < 12 * 3600; return (
          <Card className="flex flex-col gap-3">
            <CardTitle>{recent ? "Подробного разбора пока нет" : "Подробного разбора нет"}</CardTitle>
            <p className="text-sm text-muted">{recent
              ? "Stratz ещё не разобрал запись этого матча. Смерти, линия и ход игры появятся после разбора, обычно в течение часа после игры. Некоторые матчи Stratz не разбирает совсем, тогда остаются только итоговые цифры."
              : "Stratz не разобрал запись этого матча и, скорее всего, уже не разберёт: так бывает с частью матчей. Остались только итоговые цифры."}</p>
            <div className="flex flex-wrap gap-1.5">
              {[["Добито", r.lastHits], ["Денаи", r.denies], ["GPM", r.gpm], ["XPM", r.xpm], ["Золото", r.networth.toLocaleString("ru-RU")]].map(([l, v]) => (
                <span key={String(l)} className="rounded-md bg-panel-2 px-2 py-1 flex flex-col leading-tight min-w-14"><span className="text-[10px] text-muted">{l}</span><b className="text-xs tabular-nums">{v}</b></span>
              ))}
            </div>
            {recent && <Button size="sm" className="w-fit" onClick={() => load(true)} disabled={busy}>{busy ? "проверяю…" : "Проверить снова"}</Button>}
          </Card>
        ); })()}
      </>}
    </main>
  );
}

function Header({ r, byId, draft }: { r: MatchReport; byId: Map<number, Hero>; draft: DraftLog | null }) {
  const h = byId.get(r.heroId);
  const date = new Date(r.startDateTime * 1000).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const adv = draft?.topPool[0];
  return (
    <Card tone={r.won ? "good" : "bad"} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        {h && <img src={portrait(h.short)} alt="" className="h-14 w-[100px] rounded-lg object-cover shrink-0" />}
        <div className="min-w-0 flex-1 flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-base">{h?.name ?? r.heroId}</b>
            {r.position ? <Chip>{ROLE_NAME[r.position]}</Chip> : null}
            <Chip tone={r.won ? "good" : "bad"}>{r.won ? "победа" : "поражение"}</Chip>
            <span className="text-xs text-muted tabular-nums">{date} · {Math.round(r.durationSeconds / 60)} мин · {r.kills}/{r.deaths}/{r.assists}</span>
          </div>
          <div className="text-xs text-muted flex flex-wrap items-center gap-1">
            <span className="text-enemy mr-0.5">против</span>{r.enemies.map((id) => <img key={id} src={icon(byId.get(id)?.short ?? "")} alt="" className="h-5 w-5 rounded" title={byId.get(id)?.name} />)}
            <span className="text-ally ml-2 mr-0.5">с</span>{r.allies.map((id) => <img key={id} src={icon(byId.get(id)?.short ?? "")} alt="" className="h-5 w-5 rounded" title={byId.get(id)?.name} />)}
          </div>
        </div>
        <a className="text-xs text-muted hover:text-foreground underline self-start" href={`https://stratz.com/matches/${r.matchId}`} target="_blank" rel="noreferrer">открыть на Stratz</a>
      </div>
      {r.summary.length > 0 && <div className="flex flex-col gap-1 text-sm leading-relaxed">{r.summary.map((s) => <p key={s}>{s}</p>)}</div>}
      {r.parsed && <div className="text-xs text-muted flex flex-wrap items-center gap-1.5">
        <span>План героя: {heroName(r.heroId, byId).name} {r.plan.text}.</span>
        <Hint align="right" text={r.plan.manual ? "По плану героя отчёт решает, какие смерти стоили дорого, а какие были ценой драки. План для этого героя на миде записан вручную." : "По плану героя отчёт решает, какие смерти стоили дорого, а какие были ценой драки. Для этого героя и позиции своей строки нет, план взят по позиции и типу героя."} />
      </div>}
      {draft && (
        <div className="text-xs text-muted">
          {draft.chosen ? `Пикер ставил его ${draft.chosen.rank}-м с шансом ${Math.round(draft.chosen.finalScore)}%` : "Пикер этого героя не оценивал"}
          {adv && adv.heroId !== draft.chosenHeroId ? ` · совет из пула был ${adv.name} ${Math.round(adv.finalScore)}%` : adv ? " · ты взял лучшего из пула" : ""}
        </div>
      )}
    </Card>
  );
}

function windowTone(w: ReportWindow) {
  if (w.norm == null) return "text-foreground";
  if (w.mine - w.norm >= 1.5 && w.mine > w.norm * 1.5) return "text-bad";
  return w.mine <= w.norm ? "text-good" : "text-foreground";
}

function Deaths({ r }: { r: MatchReport }) {
  const [all, setAll] = useState(false);
  const list = all ? r.deathList : r.deathList.slice(0, 6);
  return (
    <Card>
      <CardTitle hint="Линия — шанс твоей команды на победу по оценке Stratz. Зелёные точки — полезные моменты, красные — смерти без размена, серые — смерти в драке, где враги тоже кого-то потеряли. Наведи на точку, чтобы прочитать, что было. Норма смертей — средние Divine/Immortal на этом герое и позиции.">Ход игры</CardTitle>
      <GameCurve r={r} />
      <div className="mt-5 mb-3 text-sm font-semibold">Смерти · {r.deathList.length}</div>
      {r.windows.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {r.windows.map((w) => (
            <span key={w.from} className="rounded-lg bg-panel-2 px-2.5 py-1.5 flex flex-col leading-tight min-w-24">
              <span className="text-[11px] text-muted">{WINDOW_SHORT(w)}</span>
              <span className="text-sm tabular-nums"><b className={windowTone(w)}>{w.mine}</b>{w.norm != null ? <span className="text-muted"> · норма {w.norm}</span> : null}</span>
            </span>
          ))}
        </div>
      )}
      {r.deathList.length === 0 ? <p className="text-sm text-muted">Ни одной смерти за матч.</p> : (
        <div className="grid grid-cols-[40px_10px_minmax(0,1fr)] gap-x-2.5 gap-y-2.5 text-sm">
          {list.map((d) => <DeathRow key={d.t} d={d} />)}
        </div>
      )}
      {r.deathList.length > 6 && <Button size="sm" variant="link" className="mt-3" onClick={() => setAll(!all)}>{all ? "Свернуть" : `Показать все ${r.deathList.length}`}</Button>}
    </Card>
  );
}

function DeathRow({ d }: { d: ReportDeath }) {
  return <>
    <span className="text-xs text-muted tabular-nums pt-0.5">{mmss(d.t)}</span>
    <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${d.traded ? "bg-muted" : "bg-bad"}`} />
    <div className="min-w-0">
      <div>{d.text}</div>
      {d.note && <div className="mt-0.5 text-xs text-muted">{d.note}</div>}
    </div>
  </>;
}

/** Шанс на победу по минутам и смерти на одной оси времени: видно, какие смерти обрушили игру. */
function GameCurve({ r }: { r: MatchReport }) {
  const dur = r.durationSeconds;
  const x = (sec: number) => Math.min(100, Math.max(0, (sec / dur) * 100));
  const curve = r.winCurve;
  const pts = curve?.map((v, i) => `${(x(i * 60) * 10).toFixed(1)},${100 - v}`).join(" ");
  // подписи каждые 10 минут; у правого края место под длительность матча
  const ticks = Array.from({ length: Math.floor(dur / 600) + 1 }, (_, i) => i * 10).filter((m) => m * 60 <= dur * 0.92);
  return (
    <div className="pl-9 pr-1">
      {curve && (
        <div className="relative h-24">
          <span className="absolute -left-9 -top-1.5 text-[10px] text-muted">100%</span>
          <span className="absolute -left-9 top-1/2 -translate-y-1/2 text-[10px] text-muted">50%</span>
          <span className="absolute -left-9 -bottom-1.5 text-[10px] text-muted">0%</span>
          <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
            <line x1="0" x2="1000" y1="0" y2="0" stroke="var(--border)" vectorEffect="non-scaling-stroke" />
            <line x1="0" x2="1000" y1="100" y2="100" stroke="var(--border)" vectorEffect="non-scaling-stroke" />
            <line x1="0" x2="1000" y1="50" y2="50" stroke="var(--border)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
            {r.deathList.map((d) => <line key={d.t} x1={x(d.t) * 10} x2={x(d.t) * 10} y1="0" y2="100" stroke={d.traded ? "var(--muted)" : "var(--bad)"} strokeOpacity="0.25" vectorEffect="non-scaling-stroke" />)}
            <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
      )}
      {r.moments.length > 0 && <DotRow x={x} items={r.moments.map((m) => ({ t: m.t, text: m.text, cls: "bg-good" }))} />}
      <DotRow x={x} items={r.deathList.map((d) => ({ t: d.t, text: d.text, cls: d.traded ? "bg-muted" : "bg-bad" }))} />
      <div className="relative mt-1 h-3.5 text-[10px] text-muted tabular-nums">
        {ticks.map((m) => <span key={m} className="absolute -translate-x-1/2" style={{ left: `${x(m * 60)}%` }}>{m}</span>)}
        <span className="absolute right-0">{Math.round(dur / 60)} мин</span>
      </div>
    </div>
  );
}

/** Ряд точек на оси времени; точки, которые слиплись бы (ближе 1.2% ширины), уходят во второй ряд. */
function DotRow({ items, x }: { items: { t: number; text: string; cls: string }[]; x: (sec: number) => number }) {
  let lastRow0 = -Infinity;
  const dots = items.map((it) => { const px = x(it.t); const row = px - lastRow0 < 1.2 ? 1 : 0; if (row === 0) lastRow0 = px; return { ...it, px, row }; });
  return (
    <div className={`relative mt-1.5 ${dots.some((o) => o.row === 1) ? "h-[26px]" : "h-3"}`}>
      {dots.map((d) => <span key={d.t} title={`${mmss(d.t)} · ${d.text}`} className={`absolute h-3 w-3 -translate-x-1/2 rounded-full ring-2 ring-panel cursor-default ${d.row ? "top-3.5" : "top-0"} ${d.cls}`} style={{ left: `${d.px}%` }} />)}
    </div>
  );
}

/** Что получилось: сильные стороны против нормы и полезные моменты. Без этого разбор выглядит так, будто в матче всё было плохо. */
function Good({ r }: { r: MatchReport }) {
  return (
    <Card tone="good">
      <CardTitle hint="Сильные стороны против нормы героя и полезные моменты матча: выигранные драки, мультикиллы, соло-киллы, вышки, линия. На них стоит делать упор.">Что получилось</CardTitle>
      {r.strengths.length > 0 && (
        <ul className="flex flex-col gap-2 text-sm">
          {r.strengths.map((s) => <li key={s} className="flex items-start gap-2.5 leading-relaxed"><span className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-good" />{s}</li>)}
        </ul>
      )}
      {r.moments.length > 0 && (
        <div className={`grid grid-cols-[40px_minmax(0,1fr)] gap-x-2.5 gap-y-3 text-sm ${r.strengths.length ? "mt-4 border-t border-border pt-4" : ""}`}>
          {r.moments.map((m) => <Fragment key={m.t}><span className="text-xs text-muted tabular-nums pt-0.5">{mmss(m.t)}</span><p className="leading-relaxed">{m.text}</p></Fragment>)}
        </div>
      )}
      {!r.strengths.length && !r.moments.length && <p className="text-sm text-muted">Ярких плюсов в этом матче не нашлось: тяжёлая игра. Ниже видно, где её потеряли.</p>}
    </Card>
  );
}

function Tips({ r }: { r: MatchReport }) {
  return (
    <Card tone="accent">
      <CardTitle hint="Советы собраны по правилам из твоих смертей, линии и плана героя: на какой минуте что пошло не так и что сделать иначе.">Что сделать иначе</CardTitle>
      {r.tips.length ? (
        <div className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-2.5 gap-y-3 text-sm">
          {r.tips.map((t) => <Fragment key={t.t}><span className="text-xs text-muted tabular-nums pt-0.5">{mmss(t.t)}</span><p className="leading-relaxed">{t.text}</p></Fragment>)}
        </div>
      ) : <p className="text-sm text-muted">Явных ошибок по смертям не видно: лишних смертей на линии и без размена нет.</p>}
    </Card>
  );
}

function LaneCard({ r, byId }: { r: MatchReport; byId: Map<number, Hero> }) {
  const lane = r.lane;
  if (lane?.sup) return <SupLaneCard r={r} byId={byId} />;
  if (!lane || lane.rows.length === 0) return null;
  const opp = lane.oppHeroId ? byId.get(lane.oppHeroId) : null;
  const mine = byId.get(r.heroId);
  const oppName = opp ? heroName(opp.id, byId).name : null;
  const out = lane.outcome ? OUTCOME[lane.outcome] : null;
  return (
    <Card>
      <CardTitle right={out ? <Chip tone={out.tone} title="Итог линии по оценке Stratz">{out.text}</Chip> : undefined}>Линия</CardTitle>
      {opp && (
        <div className="mb-5 flex flex-wrap items-center gap-3 text-sm">
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-ally" />{mine && <img src={icon(mine.short)} alt="" className="h-5 w-5 rounded" />}Ты</span>
          <span className="text-muted">против</span>
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-enemy" /><img src={icon(opp.short)} alt="" className="h-5 w-5 rounded" />{oppName}</span>
        </div>
      )}
      <div className="grid gap-x-12 gap-y-6 md:grid-cols-2">
        {lane.rows.map((row) => (
          <div key={row.minute} className="flex flex-col gap-4">
            <div className="text-xs font-semibold text-muted">К {row.minute}-й минуте</div>
            <Duel label="Добито" c={row.lh} names={["Ты", oppName ?? "соперник"]} />
            <Duel label="Денаи" c={row.dn} names={["Ты", oppName ?? "соперник"]} />
            <Duel label="Золото" c={row.nw} names={["Ты", oppName ?? "соперник"]} gold />
          </div>
        ))}
      </div>
      <div className="mt-5 text-xs text-muted">Норма — средние Divine/Immortal на этом герое{r.position ? ` (${ROLE_NAME[r.position]})` : ""} к той же минуте.</div>
    </Card>
  );
}

/** Линия саппорта: ваша пара против их пары (золото, убийства) и твой вклад против нормы героя. */
function SupLaneCard({ r, byId }: { r: MatchReport; byId: Map<number, Hero> }) {
  const lane = r.lane!, sup = lane.sup!;
  if (sup.rows.length === 0) return null;
  const out = lane.outcome ? OUTCOME[lane.outcome] : null;
  const names = sup.enemies.map((id) => heroName(id, byId).name);
  const theirName = names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} и ${names[names.length - 1]}`;
  const icons = (ids: number[]) => ids.map((id) => byId.get(id)).filter((h): h is Hero => !!h).map((h) => <img key={h.id} src={icon(h.short)} alt="" className="h-5 w-5 rounded" />);
  const duel = sup.enemies.length > 0;
  return (
    <Card>
      <CardTitle right={out ? <Chip tone={out.tone} title="Итог линии по оценке Stratz">{out.text}</Chip> : undefined}>Линия</CardTitle>
      {duel && (
        <div className="mb-5 flex flex-wrap items-center gap-3 text-sm">
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-ally" /><span className="flex gap-1">{icons(sup.allies)}</span>{sup.allies.length > 1 ? "Вы" : "Ты"}</span>
          <span className="text-muted">против</span>
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-enemy" /><span className="flex gap-1">{icons(sup.enemies)}</span>{theirName}</span>
        </div>
      )}
      <div className="grid gap-x-12 gap-y-6 md:grid-cols-2">
        {sup.rows.map((row) => (
          <div key={row.minute} className="flex flex-col gap-4">
            <div className="text-xs font-semibold text-muted">К {row.minute}-й минуте</div>
            {row.gold && <Duel label={sup.allies.length > 1 ? "Золото пары" : "Золото"} c={{ ...row.gold, norm: null }} names={["Вы", theirName]} gold />}
            {row.kills && <Duel label="Убийства" c={{ ...row.kills, norm: null }} names={["Вы убили", `${theirName} ${sup.enemies.length > 1 ? "убили" : "убил"}`]} />}
            <div className={`flex flex-col gap-2 ${duel ? "mt-1" : ""}`}>
              <div className="text-xs">Твой вклад</div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_88px] items-baseline gap-x-3 gap-y-2 text-sm tabular-nums">
                <NormRow label="Урон по героям" c={row.dmg} judge={(a, n) => a / n >= 1.15 ? 1 : a / n <= 0.85 ? -1 : 0} big />
                <NormRow label="Уровень" c={row.level} judge={(a, n) => a - n >= 0.9 ? 1 : a - n <= -0.9 ? -1 : 0} />
                <NormRow label="Стаки" c={row.stacks} judge={(a, n) => a - n >= 0.8 ? 1 : a - n <= -0.5 ? -1 : 0} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 text-xs text-muted">{duel ? "Золото и убийства — всех героев на вашей линии. " : ""}Норма — средние Divine/Immortal на этом герое{r.position ? ` (${ROLE_NAME[r.position]})` : ""} к той же минуте.</div>
    </Card>
  );
}

/** Твой показатель против нормы: число, норма и словами, выше или ниже. */
function NormRow({ label, c, judge, big }: { label: string; c: NormCell; judge: (me: number, norm: number) => -1 | 0 | 1; big?: boolean }) {
  const f = (n: number) => (big ? Math.round(n).toLocaleString("ru-RU") : String(n));
  const j = c.norm != null ? judge(c.me, c.norm) : null;
  return (
    <>
      <span className="text-muted">{label}</span>
      <span className="text-right font-semibold">{f(c.me)}</span>
      <span className="text-xs text-muted">{c.norm != null ? `норма ${f(c.norm)}` : ""}</span>
      <span className={`text-xs ${j === 1 ? "text-good" : j === -1 ? "text-bad" : "text-muted"}`}>{j === 1 ? "выше нормы" : j === -1 ? "ниже нормы" : j === 0 ? "как норма" : ""}</span>
    </>
  );
}

/** Ты против соперника по одному показателю: полоса делится по долям, у кого больше — тот дальше «перетянул». */
function Duel({ label, c, names, gold }: { label: string; c: LaneCell; names: [string, string]; gold?: boolean }) {
  const f = (n: number) => (gold ? Math.round(n).toLocaleString("ru-RU") : String(Math.round(n)));
  const head = <div className="mb-1.5 flex items-baseline gap-2 text-xs"><span>{label}</span>{c.norm != null && <span className="text-muted">норма {f(c.norm)}</span>}</div>;
  if (c.opp == null) return <div>{head}<div className="text-sm font-semibold tabular-nums">{f(c.me)}</div></div>;
  const none = c.me + c.opp === 0;
  const share = none ? 0.5 : c.me / (c.me + c.opp);
  return (
    <div>
      {head}
      <div className="grid grid-cols-[52px_minmax(0,1fr)_52px] items-center gap-3 text-sm tabular-nums" title={`${names[0]} ${f(c.me)}, ${names[1]} ${f(c.opp)}${c.norm != null ? `, норма ${f(c.norm)}` : ""}`}>
        <span className={`text-right ${c.me >= c.opp && !none ? "font-semibold" : "text-muted"}`}>{f(c.me)}</span>
        {none ? <div className="h-2.5 rounded-full bg-panel-2" />
          : <div className="flex h-2.5 overflow-hidden rounded-full">
            <span className="h-full bg-ally" style={{ width: `${share * 100}%` }} />
            <span className="h-full w-0.5 shrink-0 bg-panel" />
            <span className="h-full flex-1 bg-enemy" />
          </div>}
        <span className={c.opp >= c.me && !none ? "font-semibold" : "text-muted"}>{f(c.opp)}</span>
      </div>
    </div>
  );
}
