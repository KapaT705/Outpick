"use client";

import { useMemo, useState } from "react";
import type { DraftLog } from "@/lib/log";
import type { MatchDetails } from "@/lib/matchDetails";
import type { Bench } from "@/lib/bench";
import type { Hero } from "@/lib/types";

// иконки с CDN Valve: у Stratz alchemist_icon.png оказался копией dragon_knight_icon.png
const icon = (short: string) => `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/icons/${short}.png`;
const fmt = (t: number) => new Date(t * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function HistoryView({ items: initial, heroes, accounts = {}, defaultAccountId = null, currentAccountId = null }: { items: DraftLog[]; heroes: Hero[]; accounts?: Record<number, string>; defaultAccountId?: number | null; currentAccountId?: number | null }) {
  const [all, setItems] = useState(initial);
  // история только текущего аккаунта (под которым идёт игра или выбран по умолчанию в настройках); аккаунт меняется там же
  const accOf = (x: DraftLog) => x.accountId ?? defaultAccountId;
  const items = currentAccountId ? all.filter((x) => accOf(x) === currentAccountId) : all;
  const multiAccount = !currentAccountId && new Set(all.map(accOf)).size > 1;
  const accName = (x: DraftLog) => { const id = accOf(x); return id ? (accounts[id] ?? String(id)) : "?"; };
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState<number>(30); // дней для сводки; 0 = всё время
  const [openId, setOpenId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const byId = useMemo(() => new Map(heroes.map((h) => [h.id, h])), [heroes]);

  const sync = async () => {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/log/sync", { method: "POST" }).then((x) => x.json()).catch(() => null);
    if (r?.ok) {
      setMsg(r.updated > 0 ? `Готово: результат найден у ${r.updated} ${r.updated === 1 ? "записи" : "записей"}${r.pending ? `, ещё ${r.pending} без результата` : ""}` : r.pending > 0 ? `Пока без результата: ${r.pending}. Stratz получает матч через 5–15 минут после игры, попробуй позже.` : "Нечего обновлять: все записи уже с результатом или история пуста.");
      const fresh = await fetch("/api/log").then((x) => x.json()).catch(() => null);
      if (fresh?.items) setItems(fresh.items);
      // по подтянутым матчам программа доучивает портреты (персоны, арканы) с кадров стадии пиков
      if (r.updated > 0) window.desktop?.learn?.().then((l) => { if (l?.ok && l.added) setMsg((m) => `${m ?? ""} · выучено новых портретов: ${l.added}`); }).catch(() => {});
    } else setMsg(r?.error ?? "ошибка синхронизации");
    setBusy(false);
  };
  const [detailsBusy, setDetailsBusy] = useState<string | null>(null);
  const loadDetails = async (id: string) => {
    setDetailsBusy(id);
    const r = await fetch("/api/log/details", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).then((x) => x.json()).catch(() => null);
    if (r?.ok && r.item) setItems((cur) => cur.map((x) => (x.id === id ? r.item : x)));
    setDetailsBusy(null);
  };
  const del = async (id: string) => {
    await fetch("/api/log", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setItems(all.filter((x) => x.id !== id));
  };

  const since = period ? Math.floor(Date.now() / 1000) - period * 86400 : 0;
  const done = items.filter((x) => x.won !== undefined && x.createdAt >= since);
  const last = items.find((x) => x.won !== undefined); // последний матч с результатом: короткий отчёт
  // лучшие и худшие герои за период
  const byHero = new Map<number, { n: number; w: number }>();
  for (const x of done) { const s = byHero.get(x.chosenHeroId) ?? { n: 0, w: 0 }; s.n++; if (x.won) s.w++; byHero.set(x.chosenHeroId, s); }
  const heroRows = [...byHero].map(([id, s]) => ({ id, ...s, wr: Math.round((s.w / s.n) * 100) })).sort((a, b) => b.n - a.n || b.wr - a.wr).slice(0, 8);
  const advised = (x: DraftLog) => (x.chosen?.rank ?? 99) <= 3;
  const stat = (f: (x: DraftLog) => boolean) => { const s = done.filter(f); const w = s.filter((x) => x.won).length; return { n: s.length, w, wr: s.length ? Math.round((w / s.length) * 100) : null }; };
  const top1 = stat((x) => x.chosen?.rank === 1);
  const top3 = stat((x) => (x.chosen?.rank ?? 99) <= 3);
  const below = stat((x) => (x.chosen?.rank ?? 99) > 3);
  const poolTop = stat((x) => x.topPool.length > 0 && x.chosenHeroId === x.topPool[0].heroId);
  // калибровка: предсказанный % против реального
  const buckets = [[0, 48], [48, 52], [52, 56], [56, 100]].map(([lo, hi]) => {
    const s = done.filter((x) => x.chosen && x.chosen.finalScore >= lo && x.chosen.finalScore < hi);
    return { label: hi === 100 ? `${lo}%+` : `${lo}–${hi}%`, n: s.length, wr: s.length ? Math.round((s.filter((x) => x.won).length / s.length) * 100) : null, avg: s.length ? Math.round(s.reduce((a, x) => a + x.chosen!.finalScore, 0) / s.length) : null };
  });

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-5 flex flex-col gap-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">История драфтов <span className="text-muted text-base font-normal">{items.length} записей · с результатом {done.length}</span></h1>
        {currentAccountId && <span className="text-xs text-muted" title="Аккаунт меняется в настройках (вкладка «Аккаунты и Stratz») или сам, когда Дота на связи">аккаунт: {accounts[currentAccountId] ?? currentAccountId}</span>}
        <div className="flex items-center gap-3 text-sm">
          <button onClick={sync} disabled={busy} className="rounded-md border border-border px-3 py-1 hover:border-accent disabled:opacity-50">{busy ? "ищу матчи…" : "Подтянуть результаты из Stratz"}</button>
        </div>
      </header>

      {msg && <div className={`rounded-lg border px-3 py-2 text-sm ${msg.startsWith("Готово") ? "border-good/40 bg-good/10 text-good" : "border-border bg-panel text-foreground"}`}>{msg}</div>}

      {last && (() => { const h = byId.get(last.chosenHeroId); const adv = last.topPool[0]; const advAll = last.topAll[0]; return (
        <section className={`rounded-xl border p-3 text-sm flex flex-wrap items-center gap-3 ${last.won ? "border-good/40 bg-good/5" : "border-bad/40 bg-bad/5"}`}>
          {h && <img src={icon(h.short)} alt="" className="h-9 w-9 rounded" />}
          <div className="min-w-0 flex-1">
            <div><span className="text-muted">Последний матч:</span> <b>{h?.name}</b>, {last.won ? <span className="text-good font-semibold">победа</span> : <span className="text-bad font-semibold">поражение</span>}{last.durationSeconds ? <span className="text-muted"> за {Math.round(last.durationSeconds / 60)} мин</span> : null}</div>
            {last.details && <MatchStats d={last.details} b={last.bench ?? null} byId={byId} />}
            <div className="text-xs text-muted">
              {last.chosen ? `Пикер ставил его ${last.chosen.rank}-м с прогнозом ${Math.round(last.chosen.finalScore)}%` : "Пикер этого героя не оценивал"}
              {adv && adv.heroId !== last.chosenHeroId ? ` · совет из пула был ${adv.name} ${Math.round(adv.finalScore)}%` : adv ? " · ты взял лучшего из пула" : ""}
              {advAll && advAll.heroId !== last.chosenHeroId && advAll.heroId !== adv?.heroId ? ` · лучший вообще ${advAll.name} ${Math.round(advAll.finalScore)}%` : ""}
            </div>
          </div>
        </section>
      ); })()}

      <section className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted">Сводка за:</span>
        {[7, 30, 90, 0].map((d) => <button key={d} onClick={() => setPeriod(d)} className={`rounded-md border px-2 py-1 ${period === d ? "border-accent text-accent bg-accent/10" : "border-border text-muted hover:text-foreground"}`}>{d ? `${d} дней` : "всё время"}</button>)}
        <span className="text-muted ml-2">матчей с результатом: {done.length} · винрейт {done.length ? Math.round((done.filter((x) => x.won).length / done.length) * 100) : 0}% · по совету (топ-3) {stat(advised).wr ?? "—"}% против {stat((x) => !advised(x)).wr ?? "—"}% не по совету</span>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat title="Взял лучшего по совету" s={top1} />
        <Stat title="Взял из топ-3" s={top3} />
        <Stat title="Взял ниже топ-3" s={below} />
        <Stat title="Взял лучшего из пула" s={poolTop} />
      </section>

      {heroRows.length > 0 && (
        <section className="rounded-xl border border-border bg-panel p-3">
          <h2 className="font-semibold mb-2">Твои герои за период</h2>
          <div className="flex flex-wrap gap-2 text-xs">
            {heroRows.map((r) => { const h = byId.get(r.id); return (
              <span key={r.id} className={`flex items-center gap-1.5 rounded-md bg-panel-2 px-2 py-1 ${r.wr >= 55 ? "text-good" : r.wr <= 45 ? "text-bad" : "text-foreground"}`}>{h && <img src={icon(h.short)} alt="" className="h-5 w-5 rounded" />}{h?.name} <span className="text-muted">{r.w}–{r.n - r.w}</span> {r.wr}%</span>
            ); })}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-border bg-panel p-3">
        <h2 className="font-semibold mb-2">Калибровка: что предсказал пикер и что вышло</h2>
        <div className="grid grid-cols-4 gap-2 text-sm">
          {buckets.map((b) => (
            <div key={b.label} className="rounded-lg bg-panel-2 p-2">
              <div className="text-muted text-xs">прогноз {b.label}</div>
              <div className="text-lg font-semibold">{b.wr === null ? "—" : `${b.wr}%`}</div>
              <div className="text-xs text-muted">{b.n} игр{b.avg !== null ? ` · средний прогноз ${b.avg}%` : ""}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted mt-2">Если реальный винрейт в столбце близок к прогнозу, оценки честные. Нужны десятки игр в каждом столбце, раньше это шум.</p>
      </section>

      <section className="flex flex-col gap-2">
        {items.length === 0 && <div className="text-muted text-sm">Пока пусто. В пикере нажми «Беру» на герое, которого взял, и драфт запишется сюда.</div>}
        {items.map((x) => {
          const h = byId.get(x.chosenHeroId);
          const res = x.won === undefined ? (x.noMatch ? <span className="text-muted">матч не найден</span> : <span className="text-muted">ждёт результата</span>) : x.won ? <span className="text-good font-semibold">Победа</span> : <span className="text-bad font-semibold">Поражение</span>;
          return (
            <div key={x.id} className="rounded-lg border border-border bg-panel p-3 flex flex-wrap items-center gap-3 text-sm cursor-pointer" onClick={() => setOpenId(openId === x.id ? null : x.id)}>
              <span className="text-xs text-muted w-24">{fmt(x.createdAt)}</span>
              {multiAccount && <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[11px] text-muted" title="Аккаунт Steam, с которого играли">{accName(x)}</span>}
              {h && <img src={icon(h.short)} alt="" className="h-8 w-8 rounded" />}
              <div className="min-w-0 flex-1">
                <div><b>{h?.name ?? x.chosenHeroId}</b> · {res}{x.matchId ? <a className="text-muted underline ml-2" href={`https://stratz.com/matches/${x.matchId}`} target="_blank" rel="noreferrer">матч</a> : null}</div>
                <div className="text-xs text-muted">
                  прогноз {x.chosen ? `${Math.round(x.chosen.finalScore)}% · место ${x.chosen.rank}` : "герой не оценивался"}
                  {x.topPool[0] && x.topPool[0].heroId !== x.chosenHeroId ? ` · совет из пула: ${x.topPool[0].name} ${Math.round(x.topPool[0].finalScore)}%` : ""}
                </div>
                <div className="text-xs text-muted flex flex-wrap gap-1 mt-1">
                  <span className="text-enemy">vs</span>{x.enemies.map((e) => <img key={e.id} src={icon(byId.get(e.id)?.short ?? "")} alt="" className="h-5 w-5 rounded" title={byId.get(e.id)?.name} />)}
                  {x.allies.length > 0 && <><span className="text-ally ml-2">с</span>{x.allies.map((e) => <img key={e.id} src={icon(byId.get(e.id)?.short ?? "")} alt="" className="h-5 w-5 rounded" title={byId.get(e.id)?.name} />)}</>}
                  {x.bans.length > 0 && <span className="ml-2">баны: {x.bans.length}</span>}
                </div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); del(x.id); }} className="text-xs text-muted hover:text-bad">удалить</button>
              {openId === x.id && (
                <div className="basis-full border-t border-border pt-2 text-xs text-muted grid gap-1 sm:grid-cols-2">
                  <div><span className="text-foreground">Совет из пула:</span> {x.topPool.length ? x.topPool.map((r) => <span key={r.heroId} className={r.heroId === x.chosenHeroId ? "text-accent" : ""}>{r.rank}. {r.name} {Math.round(r.finalScore)}%; </span>) : "пул аккаунта не был загружен"}</div>
                  <div><span className="text-foreground">Лучшие вообще:</span> {x.topAll.map((r) => <span key={r.heroId} className={r.heroId === x.chosenHeroId ? "text-accent" : ""}>{r.rank}. {r.name} {Math.round(r.finalScore)}%; </span>)}</div>
                  <div className="sm:col-span-2">
                    {x.details ? <MatchStats d={x.details} b={x.bench ?? null} byId={byId} /> : x.matchId ? <button onClick={(e) => { e.stopPropagation(); loadDetails(x.id); }} disabled={detailsBusy === x.id} className="text-accent hover:underline disabled:opacity-50">{detailsBusy === x.id ? "загружаю разбор…" : "Загрузить разбор матча"}</button> : <span>Разбор появится, когда подтянется результат.</span>}
                  </div>
                  {x.enemyRoles?.length > 0 && <div className="sm:col-span-2">Роли врагов: {x.enemyRoles.map((g) => `${byId.get(g.id)?.name ?? g.id} ${g.role}`).join(", ")}{x.role ? ` · твоя роль ${x.role}` : ""}</div>}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </main>
  );
}

/** Цифры матча рядом с нормой героя на позиции: зелёное лучше нормы на 10%+, красное хуже. */
function MatchStats({ d, b, byId }: { d: MatchDetails; b: Bench | null; byId: Map<number, Hero> }) {
  // значение, подкрашенное относительно нормы; норма пишется рядом как «/ n», для KDA отдельно скобками (bare)
  const cmp = (v: number | null | undefined, norm: number | null | undefined, lowerBetter = false, digits = 0, bare = false) => {
    if (v == null) return null;
    const n = norm == null ? null : Math.round(norm * 10 ** digits) / 10 ** digits;
    const ratio = n ? v / n : null;
    const good = ratio != null && (lowerBetter ? ratio <= 0.9 : ratio >= 1.1), bad = ratio != null && (lowerBetter ? ratio >= 1.1 : ratio <= 0.9);
    return <><b className={good ? "text-good" : bad ? "text-bad" : "text-foreground"}>{v}</b>{n != null && !bare ? <span className="opacity-70"> / {n}</span> : null}</>;
  };
  const dur = b?.avgDuration ? b.avgDuration : null;
  const oppName = d.laneOpp ? byId.get(d.laneOpp.heroId)?.name ?? "враг" : null;
  const laneDiff = d.laneOpp && d.nw10 != null && d.laneOpp.nw10 != null ? d.nw10 - d.laneOpp.nw10 : null;
  return (
    <div className="text-xs text-muted flex flex-wrap gap-x-3 gap-y-0.5 mt-1" title={b ? `Норма: средние Divine/Immortal на этом герое и позиции, ${b.matchCount} матчей, винрейт ${Math.round(b.winrate * 100)}%` : "Нормы нет: Stratz не ответил"}>
      <span>KDA {cmp(d.kills, b?.overall.kills, false, 0, true)}/{cmp(d.deaths, b?.overall.deaths, true, 0, true)}/{cmp(d.assists, b?.overall.assists, false, 0, true)}{b ? <span className="opacity-60"> (норма {Math.round(b.overall.kills)}/{Math.round(b.overall.deaths)}/{Math.round(b.overall.assists)})</span> : null}</span>
      <span>GPM {cmp(d.gpm, dur ? b!.overall.networth / dur : null)}</span>
      <span>XPM {cmp(d.xpm, dur ? b!.overall.xp / dur : null)}</span>
      <span>LH {cmp(d.lastHits, b?.overall.cs)}</span>
      {d.lh10 != null && <span>к 10 мин: LH {cmp(d.lh10, b?.at10?.cs)}</span>}
      {d.nw10 != null && <span>нетворс {cmp(d.nw10, b?.at10?.networth)}</span>}
      {d.deaths10 != null && <span>смертей {cmp(d.deaths10, b?.at10?.deaths, true, 1)}</span>}
      {oppName && <span>линия vs {oppName}{laneDiff != null ? <>: <b className={laneDiff >= 300 ? "text-good" : laneDiff <= -300 ? "text-bad" : "text-foreground"}>{laneDiff > 0 ? "+" : ""}{laneDiff}</b> золота к 10 мин</> : ""}</span>}
      <span className="opacity-60">{d.source === "stratz" ? "Stratz" : "OpenDota"}</span>
    </div>
  );
}

function Stat({ title, s }: { title: string; s: { n: number; w: number; wr: number | null } }) {
  return (
    <div className="rounded-xl border border-border bg-panel p-3">
      <div className="text-xs text-muted">{title}</div>
      <div className="text-2xl font-semibold">{s.wr === null ? "—" : `${s.wr}%`}</div>
      <div className="text-xs text-muted">{s.w}–{s.n - s.w} · {s.n} игр</div>
    </div>
  );
}
