"use client";

import { useEffect, useMemo, useState } from "react";
import type { DraftLog } from "@/lib/log";
import type { MatchDetails } from "@/lib/matchDetails";
import type { Bench } from "@/lib/bench";
import type { AccMatch, MatchNorm } from "@/lib/accountMatches";
import type { Hero } from "@/lib/types";
import { Button, Card, CardTitle, Chip, Empty, Hint } from "@/components/ui";
import Crystals from "@/components/Crystals";
import { phaseLabel } from "@/lib/phases";

// иконки с CDN Valve: у Stratz alchemist_icon.png оказался копией dragon_knight_icon.png
const icon = (short: string) => `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/icons/${short}.png`;
const portrait = (short: string) => `https://cdn.stratz.com/images/dota2/heroes/${short}_horz.png`;
const fmt = (t: number) => new Date(t * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const ROLE_NAME: Record<number, string> = { 1: "керри", 2: "мид", 3: "офлейн", 4: "саппорт 4", 5: "саппорт 5" };
const reportHref = (matchId: number, acc: number | null, heroId?: number) => `/history/${matchId}?${new URLSearchParams({ ...(acc ? { me: String(acc) } : {}), ...(heroId ? { hero: String(heroId) } : {}) })}`;

/** Рейтинговые матчи аккаунта из Stratz и нормы смертей для сводки (см. /api/matches). */
type Remote = { items: AccMatch[]; norms: Record<string, MatchNorm>; error: string | null };

export default function HistoryView({ items: initial, heroes, accounts = {}, stratzAccounts = [], defaultAccountId = null, currentAccountId = null }: { items: DraftLog[]; heroes: Hero[]; accounts?: Record<number, string>; stratzAccounts?: number[]; defaultAccountId?: number | null; currentAccountId?: number | null }) {
  const [all, setItems] = useState(initial);
  // история по аккаунтам: открывается на текущем (под которым идёт игра или выбран по умолчанию), переключатель на любой или на все
  const accOf = (x: DraftLog) => x.accountId ?? defaultAccountId;
  const accountIds = [...new Set([...all.map(accOf), ...stratzAccounts].filter((id): id is number => !!id))];
  const [acc, setAcc] = useState<number | "all">(currentAccountId && accountIds.includes(currentAccountId) ? currentAccountId : accountIds.length > 1 ? "all" : (accountIds[0] ?? "all"));
  const items = acc === "all" ? all : all.filter((x) => accOf(x) === acc);
  const multiAccount = acc === "all" && accountIds.length > 1;
  const accName = (x: DraftLog) => { const id = accOf(x); return id ? (accounts[id] ?? String(id)) : "?"; };
  // полный разбор только там, где Stratz видит матч: у закрытого профиля его там нет, остаются цифры из OpenDota
  const canReport = (x: DraftLog): x is DraftLog & { matchId: number } => !!x.matchId && stratzAccounts.includes(accOf(x) ?? 0);
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState<number>(30); // дней для сводки; 0 = всё время
  const [openId, setOpenId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const byId = useMemo(() => new Map(heroes.map((h) => [h.id, h])), [heroes]);

  // рейтинговые матчи из Stratz: и те, что пикер не записывал; для сводки смертей и списка матчей
  const [remote, setRemote] = useState<Record<number, Remote>>({});
  const [remoteBusy, setRemoteBusy] = useState(false);
  const wanted = (acc === "all" ? accountIds : [acc]).filter((id) => stratzAccounts.includes(id));
  const wantedKey = wanted.join(",");
  useEffect(() => {
    const need = wantedKey ? wantedKey.split(",").map(Number).filter((id) => !remote[id]) : [];
    if (!need.length) return;
    let alive = true;
    setRemoteBusy(true);
    Promise.all(need.map((id) => fetch(`/api/matches?acc=${id}`).then((x) => x.json()).catch(() => null).then((j) => [id, j] as const))).then((res) => {
      if (!alive) return;
      setRemote((cur) => { const next = { ...cur }; for (const [id, j] of res) next[id] = j?.ok ? { items: j.items, norms: j.norms, error: j.error } : { items: [], norms: {}, error: "Stratz не ответил" }; return next; });
      setRemoteBusy(false);
    });
    return () => { alive = false; };
  }, [wantedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const remoteRows = wanted.flatMap((id) => (remote[id]?.items ?? []).map((m) => ({ m, acc: id })));
  const norms = Object.assign({}, ...wanted.map((id) => remote[id]?.norms ?? {})) as Record<string, MatchNorm>;

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
    if (!confirm("Удалить эту запись из истории? Матч в Stratz останется.")) return;
    await fetch("/api/log", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setItems(all.filter((x) => x.id !== id));
  };

  const since = period ? Math.floor(Date.now() / 1000) - period * 86400 : 0;
  const done = items.filter((x) => x.won !== undefined && x.createdAt >= since);
  const wins = done.filter((x) => x.won).length;
  const last = items.find((x) => x.won !== undefined); // последний матч с результатом: короткий отчёт
  // лучшие и худшие герои за период
  const byHero = new Map<number, { n: number; w: number }>();
  for (const x of done) { const s = byHero.get(x.chosenHeroId) ?? { n: 0, w: 0 }; s.n++; if (x.won) s.w++; byHero.set(x.chosenHeroId, s); }
  const heroRows = [...byHero].map(([id, s]) => ({ id, ...s, wr: Math.round((s.w / s.n) * 100) })).sort((a, b) => b.n - a.n || b.wr - a.wr).slice(0, 8);
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
  const periodLabel = period ? `${period} дней` : "всё время";
  // проверка пикера имеет смысл от 15 матчей с результатом: раньше это шум, и новому игроку она только мешает
  const doneAll = all.filter((x) => x.won !== undefined).length;
  const PICKER_MIN = 15;

  // матчи из Stratz, которых нет среди драфтов (пикер в них не записывал)
  const draftMatchIds = new Set(all.map((x) => x.matchId).filter((id): id is number => !!id));
  const stratzOnly = remoteRows.filter(({ m }) => !draftMatchIds.has(m.id)).sort((a, b) => b.m.startDateTime - a.m.startDateTime);
  const lastRemote = stratzOnly[0] && (!last || stratzOnly[0].m.startDateTime > last.createdAt) ? stratzOnly[0] : null;
  const [listMode, setListMode] = useState<"all" | "drafts">("all");
  const [shown, setShown] = useState(40);
  type Row = { kind: "draft"; t: number; x: DraftLog } | { kind: "match"; t: number; m: AccMatch; acc: number };
  const rows: Row[] = [
    ...items.map((x): Row => ({ kind: "draft", t: x.createdAt, x })),
    ...(listMode === "all" ? stratzOnly.map(({ m, acc: a }): Row => ({ kind: "match", t: m.startDateTime, m, acc: a })) : []),
  ].sort((a, b) => b.t - a.t);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-5 flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="text-xl font-semibold">История</h1>
          {items.length > 0 && <span className="text-xs text-muted">{items.length} {plural(items.length, "драфт записан", "драфта записано", "драфтов записано")}</span>}
          {accountIds.length > 1 && (
            <div className="flex rounded-lg border border-border overflow-hidden text-xs" title="Чья история. Открывается на аккаунте, под которым сейчас играешь.">
              {accountIds.map((id) => <button key={id} onClick={() => setAcc(id)} className={`px-3 py-1.5 ${acc === id ? "bg-panel-2 text-foreground font-semibold" : "text-muted hover:text-foreground hover:bg-panel-2"}`}>{accounts[id] ?? id}</button>)}
              <button onClick={() => setAcc("all")} className={`px-3 py-1.5 ${acc === "all" ? "bg-panel-2 text-foreground font-semibold" : "text-muted hover:text-foreground hover:bg-panel-2"}`}>все</button>
            </div>
          )}
        </div>
        <Button size="sm" onClick={sync} disabled={busy} title="Найти результаты записанных драфтов на Stratz (и OpenDota для закрытых профилей). Когда Дота на связи, это происходит само после матча.">{busy ? "ищу матчи…" : "Подтянуть результаты"}</Button>
      </header>

      {msg && <Card tone={msg.startsWith("Готово") ? "good" : "default"} className="py-2.5 text-sm">{msg}</Card>}

      {all.length === 0 && remoteRows.length === 0 && !remoteBusy ? (
        <Empty>
          <span className="text-foreground">Здесь будут твои матчи и разбор каждого из них.</span>
          <span className="block mt-1 max-w-md">Когда Дота на связи, драфт записывается сам после твоего пика; без связи нажми «Беру» на взятом герое в пикере. Рейтинговые матчи из Stratz подтянутся сюда сами, когда в настройках добавлен аккаунт.</span>
        </Empty>
      ) : <>

      {lastRemote && (() => { const { m, acc: a } = lastRemote; const h = byId.get(m.heroId); return (
        <Card tone={m.won ? "good" : "bad"} className="flex flex-wrap items-center gap-4">
          {h && <img src={portrait(h.short)} alt="" className="h-14 w-[100px] rounded-lg object-cover shrink-0" />}
          <div className="min-w-0 flex-1 flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">Последний матч</span>
              <b className="text-base">{h?.name}</b>
              <Chip tone={m.won ? "good" : "bad"}>{m.won ? "победа" : "поражение"}</Chip>
              {m.position ? <Chip>{ROLE_NAME[m.position]}</Chip> : null}
              <span className="text-xs text-muted tabular-nums">{Math.round(m.durationSeconds / 60)} мин · {m.kills}/{m.deaths}/{m.assists}</span>
            </div>
            <div className="text-xs text-muted">Пикер в этом матче драфт не записывал.</div>
          </div>
          <a href={reportHref(m.id, a)} className="rounded-lg border border-border px-3.5 py-2 text-sm hover:border-accent/60 hover:bg-panel-2 transition">Разбор матча →</a>
        </Card>
      ); })()}

      {!lastRemote && last && (() => { const h = byId.get(last.chosenHeroId); const adv = last.topPool[0]; const advAll = last.topAll[0]; return (
        <Card tone={last.won ? "good" : "bad"} className="flex flex-wrap items-center gap-4">
          {h && <img src={portrait(h.short)} alt="" className="h-14 w-[100px] rounded-lg object-cover shrink-0" />}
          <div className="min-w-0 flex-1 flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">Последний матч</span>
              <b className="text-base">{h?.name}</b>
              <Chip tone={last.won ? "good" : "bad"}>{last.won ? "победа" : "поражение"}</Chip>
              {last.durationSeconds ? <span className="text-xs text-muted">{Math.round(last.durationSeconds / 60)} мин</span> : null}
              {last.matchId ? <a className="text-xs text-muted underline" href={`https://stratz.com/matches/${last.matchId}`} target="_blank" rel="noreferrer">открыть на Stratz</a> : null}
            </div>
            {last.details && <MatchStats d={last.details} b={last.bench ?? null} byId={byId} />}
            <div className="text-xs text-muted">
              {last.chosen ? `Пикер ставил его ${last.chosen.rank}-м с шансом ${Math.round(last.chosen.finalScore)}%` : "Пикер этого героя не оценивал"}
              {adv && adv.heroId !== last.chosenHeroId ? ` · совет из пула был ${adv.name} ${Math.round(adv.finalScore)}%` : adv ? " · ты взял лучшего из пула" : ""}
              {advAll && advAll.heroId !== last.chosenHeroId && advAll.heroId !== adv?.heroId ? ` · лучший вообще ${advAll.name} ${Math.round(advAll.finalScore)}%` : ""}
            </div>
          </div>
          {canReport(last) ? <a href={reportHref(last.matchId, accOf(last), last.chosenHeroId)} className="rounded-lg border border-border px-3.5 py-2 text-sm hover:border-accent/60 hover:bg-panel-2 transition">Разбор матча →</a> : null}
        </Card>
      ); })()}

      <section className="flex flex-wrap items-center gap-3 text-xs">
        <span className="text-muted">Сводка за</span>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {[7, 30, 90, 0].map((d) => <button key={d} onClick={() => setPeriod(d)} className={`px-3 py-1.5 ${period === d ? "bg-panel-2 text-foreground font-semibold" : "text-muted hover:text-foreground hover:bg-panel-2"}`}>{d ? `${d} дней` : "всё время"}</button>)}
        </div>
        {done.length > 0 ? (
          <Chip tone={wins / done.length >= 0.5 ? "good" : "bad"} title="Матчи с драфтом пикера и известным результатом за выбранный период">побед {wins} из {done.length}</Chip>
        ) : <span className="text-muted">за {periodLabel} матчей с драфтом и результатом нет</span>}
      </section>

      {wanted.length > 0 && <DeathTrend rows={remoteRows.map((r) => r.m)} norms={norms} period={period} busy={remoteBusy} error={wanted.map((id) => remote[id]?.error).find(Boolean) ?? null} />}
      {wanted.length > 0 && <PlayVsNorm rows={remoteRows.map((r) => r.m)} norms={norms} period={period} busy={remoteBusy} />}

      {heroRows.length > 0 && (
        <Card>
          <CardTitle hint={`Герои, на которых ты играл за ${periodLabel}: счёт и винрейт. Зелёные 55% и выше, красные 45% и ниже.`}>Твои герои</CardTitle>
          <div className="flex flex-wrap gap-2 text-xs">
            {heroRows.map((r) => { const h = byId.get(r.id); return (
              <span key={r.id} className={`flex items-center gap-1.5 rounded-md bg-panel-2 px-2 py-1 ${r.wr >= 55 ? "text-good" : r.wr <= 45 ? "text-bad" : "text-foreground"}`}>{h && <img src={icon(h.short)} alt="" className="h-5 w-5 rounded" />}{h?.name} <span className="text-muted">{r.w}–{r.n - r.w}</span> {r.wr}%</span>
            ); })}
          </div>
        </Card>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold">Матчи</h2>
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            <button onClick={() => setListMode("all")} className={`px-3 py-1.5 ${listMode === "all" ? "bg-panel-2 text-foreground font-semibold" : "text-muted hover:text-foreground hover:bg-panel-2"}`} title="Драфты пикера и рейтинговые матчи из Stratz, где пикер не записывал драфт">все</button>
            <button onClick={() => setListMode("drafts")} className={`px-3 py-1.5 ${listMode === "drafts" ? "bg-panel-2 text-foreground font-semibold" : "text-muted hover:text-foreground hover:bg-panel-2"}`} title="Только матчи, где пикер записал драфт">с драфтом</button>
          </div>
          {remoteBusy && <Crystals size={12} label="загружаю матчи из Stratz…" />}
        </div>
        {rows.length === 0 && !remoteBusy && <Empty>Пока пусто. Когда Дота на связи, драфт записывается сам после твоего пика. Без связи нажми «Беру» на взятом герое в пикере.</Empty>}
        {rows.slice(0, shown).map((row) => {
          // одна форма строки для всех матчей: дата, герой, итог, роль, длительность и KDA, справа «Разбор»
          if (row.kind === "match") {
            const { m } = row; const h = byId.get(m.heroId);
            return (
              <a key={`m${m.id}`} href={reportHref(m.id, row.acc)} className="rounded-xl border border-border bg-panel p-3 flex flex-wrap items-center gap-3 text-sm transition hover:border-accent/40">
                <span className="text-xs text-muted w-24 tabular-nums">{fmt(m.startDateTime)}</span>
                {h && <img src={icon(h.short)} alt="" className="h-9 w-9 rounded-md" />}
                <div className="min-w-0 flex-1 flex flex-wrap items-center gap-2">
                  <b>{h?.name ?? m.heroId}</b>{m.won ? <Chip tone="good">победа</Chip> : <Chip tone="bad">поражение</Chip>}
                  {m.position ? <Chip>{ROLE_NAME[m.position]}</Chip> : null}
                  {multiAccount && <Chip tone="muted" title="Аккаунт Steam, с которого играли">{accounts[row.acc] ?? row.acc}</Chip>}
                  <span className="text-xs text-muted tabular-nums">{Math.round(m.durationSeconds / 60)} мин · {m.kills}/{m.deaths}/{m.assists}</span>
                </div>
                <span className="text-xs text-accent" title={m.parsed ? undefined : "Stratz ещё не разобрал этот матч подробно: будут только итоговые цифры"}>{m.parsed ? "Разбор →" : "Итог →"}</span>
              </a>
            );
          }
          const x = row.x;
          const h = byId.get(x.chosenHeroId);
          const res = x.won === undefined ? <Chip tone="muted">{x.noMatch ? "матч не найден" : "ждёт результата"}</Chip> : x.won ? <Chip tone="good">победа</Chip> : <Chip tone="bad">поражение</Chip>;
          const kda = x.details ? `${x.details.kills}/${x.details.deaths}/${x.details.assists}` : "";
          const meta = x.durationSeconds ? `${Math.round(x.durationSeconds / 60)} мин${kda ? ` · ${kda}` : ""}` : "";
          const delBtn = <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); del(x.id); }} className="text-xs text-muted hover:text-bad" title="Удалить запись из истории">удалить</button>;
          const body = <>
            <span className="text-xs text-muted w-24 tabular-nums">{fmt(x.createdAt)}</span>
            {h && <img src={icon(h.short)} alt="" className="h-9 w-9 rounded-md" />}
            <div className="min-w-0 flex-1 flex flex-wrap items-center gap-2">
              <b>{h?.name ?? x.chosenHeroId}</b>{res}
              {x.role ? <Chip>{ROLE_NAME[x.role]}</Chip> : null}
              {multiAccount && <Chip tone="muted" title="Аккаунт Steam, с которого играли">{accName(x)}</Chip>}
              {meta && <span className="text-xs text-muted tabular-nums">{meta}</span>}
              {/* пока результата нет, драфт узнаётся по врагам; с результатом они есть в разборе */}
              {x.won === undefined && x.enemies.length > 0 && <span className="flex items-center gap-1 text-xs text-muted"><span className="text-enemy mr-0.5">против</span>{x.enemies.map((e) => <img key={e.id} src={icon(byId.get(e.id)?.short ?? "")} alt="" className="h-5 w-5 rounded" title={byId.get(e.id)?.name} />)}</span>}
            </div>
          </>;
          if (canReport(x)) return (
            <a key={x.id} href={reportHref(x.matchId, accOf(x), x.chosenHeroId)} className="rounded-xl border border-border bg-panel p-3 flex flex-wrap items-center gap-3 text-sm transition hover:border-accent/40">
              {body}
              <span className="text-xs text-accent">Разбор →</span>
              {delBtn}
            </a>
          );
          // у закрытого профиля разбора из Stratz нет: цифры матча из OpenDota раскрываются прямо в строке
          const open = openId === x.id;
          return (
            <div key={x.id} className={`rounded-xl border bg-panel p-3 flex flex-wrap items-center gap-3 text-sm transition ${x.matchId ? "cursor-pointer" : ""} ${open ? "border-accent/40" : "border-border hover:border-border/70"}`} onClick={() => x.matchId && setOpenId(open ? null : x.id)} title={open || !x.matchId ? undefined : "Нажми, чтобы увидеть цифры матча"}>
              {body}
              {x.matchId ? <span className="text-xs text-accent">{open ? "Свернуть" : "Цифры →"}</span> : null}
              {delBtn}
              {open && (
                <div className="basis-full border-t border-border pt-3 text-xs text-muted flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
                  {x.details ? <MatchStats d={x.details} b={x.bench ?? null} byId={byId} /> : <Button size="sm" className="w-fit" onClick={() => loadDetails(x.id)} disabled={detailsBusy === x.id}>{detailsBusy === x.id ? "загружаю…" : "Загрузить цифры матча"}</Button>}
                  {x.matchId ? <a className="w-fit text-muted hover:text-foreground underline" href={`https://stratz.com/matches/${x.matchId}`} target="_blank" rel="noreferrer">открыть на Stratz</a> : null}
                </div>
              )}
            </div>
          );
        })}
        {rows.length > shown && <Button size="sm" className="self-center" onClick={() => setShown(shown + 40)}>Показать ещё ({rows.length - shown})</Button>}
      </section>

      {/* проверка самого пикера: для тех, кому интересно, и только когда матчей уже достаточно */}
      {doneAll >= PICKER_MIN ? (
        <Card>
          <CardTitle hint="Здесь проверяется сам пикер, а не ты: как часто ты берёшь его советы и сбывается ли его прогноз. Считаются матчи с драфтом за выбранный период.">Как работает пикер</CardTitle>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat title="Взял первого по совету" hint="Матчи, где ты взял героя, которого пикер ставил первым" s={top1} />
            <Stat title="Взял из топ-3" hint="Матчи, где взятый герой был в первой тройке совета" s={top3} />
            <Stat title="Взял ниже топ-3" hint="Матчи, где взятый герой стоял ниже третьего места или не оценивался" s={below} />
            <Stat title="Взял лучшего из пула" hint="Матчи, где ты взял первого героя из списка «Из твоего пула»" hintAlign="right" s={poolTop} />
          </div>
          <div className="mt-4 mb-2 text-sm flex items-center gap-2">Прогноз против реального результата <Hint text="Матчи сгруппированы по шансу, который пикер давал взятому герою. Если реальный винрейт в столбце близок к прогнозу, оценки честные. Нужны десятки игр в каждом столбце, раньше это шум." /></div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            {buckets.map((b) => (
              <div key={b.label} className="rounded-lg bg-panel-2 p-2.5">
                <div className="text-muted text-xs">прогноз {b.label}</div>
                <div className={`text-xl font-semibold tabular-nums ${b.wr === null ? "text-muted" : ""}`}>{b.wr === null ? "—" : `${b.wr}% побед`}</div>
                <div className="text-xs text-muted">{b.n} {plural(b.n, "игра", "игры", "игр")}{b.avg !== null ? ` · средний прогноз ${b.avg}%` : ""}</div>
              </div>
            ))}
          </div>
        </Card>
      ) : all.length > 0 ? (
        <p className="text-xs text-muted">Статистика по советам пикера появится, когда наберётся {PICKER_MIN} матчей с драфтом и результатом: сейчас {doneAll}.</p>
      ) : null}
      </>}
    </main>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

/** Цифры матча ячейками рядом с нормой героя на позиции: зелёное лучше нормы на 10%+, красное хуже. */
function MatchStats({ d, b, byId }: { d: MatchDetails; b: Bench | null; byId: Map<number, Hero> }) {
  const tone = (v: number | null | undefined, norm: number | null | undefined, lowerBetter = false) => {
    if (v == null || !norm) return "text-foreground";
    const ratio = v / norm;
    const good = lowerBetter ? ratio <= 0.9 : ratio >= 1.1, bad = lowerBetter ? ratio >= 1.1 : ratio <= 0.9;
    return good ? "text-good" : bad ? "text-bad" : "text-foreground";
  };
  const fmtN = (n: number | null | undefined, digits = 0) => (n == null ? null : Math.round(n * 10 ** digits) / 10 ** digits);
  const dur = b?.avgDuration ? b.avgDuration : null;
  const oppName = d.laneOpp ? byId.get(d.laneOpp.heroId)?.name ?? "враг" : null;
  const laneDiff = d.laneOpp && d.nw10 != null && d.laneOpp.nw10 != null ? d.nw10 - d.laneOpp.nw10 : null;
  const cells: { label: string; value: string; cls: string; norm?: string | null; normLabel?: string }[] = [
    { label: "Убийств", value: String(d.kills), cls: tone(d.kills, b?.overall.kills), norm: b ? String(Math.round(b.overall.kills)) : null },
    { label: "Смертей", value: String(d.deaths), cls: tone(d.deaths, b?.overall.deaths, true), norm: b ? String(Math.round(b.overall.deaths)) : null },
    { label: "Помощи", value: String(d.assists), cls: tone(d.assists, b?.overall.assists), norm: b ? String(Math.round(b.overall.assists)) : null },
    { label: "GPM", value: String(d.gpm), cls: tone(d.gpm, dur ? b!.overall.networth / dur : null), norm: dur ? String(fmtN(b!.overall.networth / dur)) : null },
    { label: "XPM", value: String(d.xpm), cls: tone(d.xpm, dur ? b!.overall.xp / dur : null), norm: dur ? String(fmtN(b!.overall.xp / dur)) : null },
    { label: "Добито", value: String(d.lastHits), cls: tone(d.lastHits, b?.overall.cs), norm: b ? String(fmtN(b.overall.cs)) : null },
  ];
  if (d.lh10 != null) cells.push({ label: "Добито к 10 мин", value: String(d.lh10), cls: tone(d.lh10, b?.at10?.cs), norm: b?.at10 ? String(fmtN(b.at10.cs)) : null });
  if (d.nw10 != null) cells.push({ label: "Золото к 10 мин", value: String(d.nw10), cls: tone(d.nw10, b?.at10?.networth), norm: b?.at10 ? String(fmtN(b.at10.networth)) : null });
  if (d.deaths10 != null) cells.push({ label: "Смертей к 10 мин", value: String(d.deaths10), cls: tone(d.deaths10, b?.at10?.deaths, true), norm: b?.at10 ? String(fmtN(b.at10.deaths, 1)) : null });
  if (oppName) cells.push({ label: `Линия против ${oppName}`, value: laneDiff != null ? `${laneDiff > 0 ? "+" : ""}${laneDiff}` : "—", cls: laneDiff == null ? "text-foreground" : laneDiff >= 300 ? "text-good" : laneDiff <= -300 ? "text-bad" : "text-foreground", norm: laneDiff != null ? "к 10 мин" : null, normLabel: "золота" });
  return (
    <div className="flex flex-wrap gap-1.5" title={b ? `Норма: средние Divine/Immortal на этом герое и позиции за матч (${b.matchCount} матчей). Зелёное лучше нормы на 10% и больше, красное хуже.` : "Нормы нет: Stratz не ответил"}>
      {cells.map((c) => (
        <span key={c.label} className="rounded-md bg-panel-2 px-2 py-1 flex flex-col leading-tight min-w-14">
          <span className="text-[10px] text-muted">{c.label}</span>
          <span className={`text-sm tabular-nums ${c.cls}`}><b>{c.value}</b></span>
          {c.norm ? <span className="text-[10px] text-muted tabular-nums">{c.normLabel ?? "норма"} {c.norm}</span> : null}
        </span>
      ))}
      <span className="self-end text-[10px] text-muted/70 pb-1">{d.source === "stratz" ? "Stratz" : "OpenDota"}</span>
    </div>
  );
}

function Stat({ title, hint, hintAlign, s }: { title: string; hint?: string; hintAlign?: "left" | "right"; s: { n: number; w: number; wr: number | null } }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted flex items-center gap-1.5">{title}{hint && <Hint text={hint} align={hintAlign} />}</div>
      <div className={`text-2xl font-semibold tabular-nums ${s.wr === null ? "text-muted" : s.wr >= 55 ? "text-good" : s.wr <= 45 ? "text-bad" : ""}`}>{s.wr === null ? "—" : `${s.wr}%`}</div>
      <div className="text-xs text-muted">{s.n ? `побед ${s.w} из ${s.n}` : "игр нет"}</div>
    </Card>
  );
}

const WINDOWS: [number, number, string][] = [[0, 10, phaseLabel(0, 10)], [10, 20, phaseLabel(10, 20)], [20, Infinity, phaseLabel(20, null)]];

/** Смерти на 10 минут игры по отрезкам матча за период: твои и норма Divine/Immortal на тех же героях и позициях. */
function deathRates(ms: AccMatch[], norms: Record<string, MatchNorm>, from: number, to: number) {
  const acc = WINDOWS.map(() => ({ mine: 0, norm: 0, min: 0 }));
  let n = 0;
  for (const m of ms) {
    if (!m.parsed || !m.position || m.startDateTime < from || m.startDateTime >= to) continue;
    const nm = norms[`${m.heroId}-${m.position}`]?.deaths;
    if (!nm) continue;
    n++;
    const dur = m.durationSeconds / 60;
    const at = (t: number) => nm[Math.min(nm.length - 1, Math.floor(t))];
    WINDOWS.forEach(([a, b], i) => {
      if (dur <= a) return;
      const e = Math.min(dur, b);
      acc[i].min += e - a;
      acc[i].mine += m.deathTimes.filter((t) => t >= a * 60 && t < e * 60).length;
      acc[i].norm += at(e) - at(a);
    });
  }
  // меньше получаса игры на отрезке — это шум
  return { n, w: acc.map((x) => (x.min >= 30 ? { me: (x.mine / x.min) * 10, norm: (x.norm / x.min) * 10 } : null)) };
}

function DeathTrend({ rows, norms, period, busy, error }: { rows: AccMatch[]; norms: Record<string, MatchNorm>; period: number; busy: boolean; error: string | null }) {
  const now = Math.floor(Date.now() / 1000);
  const cur = deathRates(rows, norms, period ? now - period * 86400 : 0, now + 1);
  const f = (n: number) => n.toFixed(1);
  return (
    <Card>
      <CardTitle hint="Сколько раз ты умираешь за 10 минут игры на каждом отрезке матча. Норма — средние Divine/Immortal на тех же героях и позициях, что играл ты. Считаются рейтинговые матчи, которые Stratz разобрал подробно.">Смерти по отрезкам игры</CardTitle>
      <p className="-mt-1 mb-3 text-sm text-muted">Сколько раз ты умираешь за каждые 10 минут игры.</p>
      {busy && cur.n === 0 ? <Crystals size={14} label="Загружаю матчи из Stratz, в первый раз это до 20 секунд…" />
        : cur.n === 0 ? <p className="text-sm text-muted">{error ?? `За ${period ? `${period} дней` : "всё время"} нет рейтинговых матчей, разобранных Stratz.`}</p>
        : <>
          <div className="grid gap-3 sm:grid-cols-3">
            {WINDOWS.map(([, , label], i) => {
              const w = cur.w[i];
              if (!w) return <div key={label} className="rounded-xl bg-panel-2 p-3"><div className="text-xs text-muted">{label}</div><div className="text-2xl font-semibold text-muted">—</div><div className="text-xs text-muted">мало игры на этом отрезке</div></div>;
              const over = w.norm > 0 ? Math.round((w.me / w.norm - 1) * 100) : 0;
              const tone = over >= 25 ? "text-bad" : over <= 5 ? "text-good" : "";
              return (
                <div key={label} className="rounded-xl bg-panel-2 p-3 flex flex-col gap-0.5">
                  <div className="text-xs text-muted">{label}</div>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-2xl font-semibold tabular-nums ${tone}`}>{f(w.me)}</span>
                    <span className="text-xs text-muted tabular-nums">норма {f(w.norm)}{over > 5 ? ` · на ${over}% больше` : over < -5 ? ` · на ${-over}% меньше` : ""}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-xs text-muted">{cur.n} {plural(cur.n, "матч", "матча", "матчей")} за {period ? `${period} дней` : "всё время"}{error ? ` · ${error}` : ""}</div>
        </>}
    </Card>
  );
}

/** Показатели за период против нормы: сумма твоего за матчи к сумме нормы героя на позиции, пересчитанной на длину каждого матча. */
const METRICS: { key: string; label: string; hint: string; lowerBetter?: boolean; mine: (m: AccMatch) => number | null; norm: (n: MatchNorm, minutes: number) => number | null }[] = [
  { key: "dmg", label: "Дамаг по героям", hint: "Урон по героям за матч", mine: (m) => m.heroDamage, norm: (n, min) => (n.heroDamage / n.dur) * min },
  { key: "ka", label: "Участие в драках", hint: "Киллы и ассисты за матч", mine: (m) => m.kills + m.assists, norm: (n, min) => (n.ka / n.dur) * min },
  { key: "lane", label: "Фарм на линии", hint: "Добито к 10-й минуте", mine: (m) => m.lh10, norm: (n) => n.cs10 },
  { key: "nw", label: "Фарм за игру", hint: "Нетворс к концу матча", mine: (m) => m.networth, norm: (n, min) => (n.networth / n.dur) * min },
  { key: "push", label: "Пуш", hint: "Урон по строениям за матч", mine: (m) => m.towerDamage, norm: (n, min) => (n.towerDamage / n.dur) * min },
  { key: "deaths", label: "Смерти", hint: "Смерти за матч, здесь меньше — лучше", lowerBetter: true, mine: (m) => m.deaths, norm: (n, min) => (n.d / n.dur) * min },
];

/** Отличие от нормы словами: «на 20% выше», «на 35% больше» (для смертей), «как норма». */
const vsText = (r: { ratio: number; lowerBetter?: boolean }) => {
  const p = Math.round((r.ratio - 1) * 100);
  if (Math.abs(p) < 3) return "как норма";
  return `на ${Math.abs(p)}% ${r.lowerBetter ? (p > 0 ? "больше" : "меньше") : (p > 0 ? "выше" : "ниже")}`;
};

function vsNorm(ms: AccMatch[], norms: Record<string, MatchNorm>, from: number, to: number) {
  let n = 0;
  const sums = METRICS.map(() => ({ mine: 0, norm: 0, k: 0 }));
  for (const m of ms) {
    if (!m.parsed || !m.position || m.startDateTime < from || m.startDateTime >= to) continue;
    const nm = norms[`${m.heroId}-${m.position}`];
    if (!nm || !nm.dur) continue;
    n++;
    METRICS.forEach((x, i) => { const a = x.mine(m), b = x.norm(nm, m.durationSeconds / 60); if (a != null && b != null && b > 0) { sums[i].mine += a; sums[i].norm += b; sums[i].k++; } });
  }
  // отношение к норме; для смертей переворачиваем, чтобы «больше 100%» везде значило «лучше»
  return { n, rows: METRICS.map((x, i) => { const s = sums[i]; if (s.k < 3 || !s.norm) return null; const ratio = s.mine / s.norm; return { ...x, ratio, better: x.lowerBetter ? 2 - ratio : ratio, avg: s.mine / s.k, avgNorm: s.norm / s.k }; }) };
}

function PlayVsNorm({ rows, norms, period, busy }: { rows: AccMatch[]; norms: Record<string, MatchNorm>; period: number; busy: boolean }) {
  const now = Math.floor(Date.now() / 1000);
  const cur = vsNorm(rows, norms, period ? now - period * 86400 : 0, now + 1);
  const list = cur.rows.filter((r): r is NonNullable<typeof r> => !!r);
  if (busy && cur.n === 0) return null; // загрузку уже показывает карточка смертей
  if (cur.n === 0 || list.length === 0) return null;
  const sorted = [...list].sort((a, b) => b.better - a.better);
  const strong = sorted.filter((r) => r.better >= 1.05).slice(0, 2);
  const weak = [...sorted].reverse().filter((r) => r.better <= 0.95).slice(0, 1);
  const fmtN = (v: number) => (v >= 1000 ? `${(Math.round(v / 100) / 10).toLocaleString("ru-RU")}к` : String(Math.round(v * 10) / 10));
  const head = strong.length
    ? `Сильные стороны: ${strong.map((r) => r.label.toLowerCase()).join(" и ")}${weak.length ? `. Над чем работать: ${weak[0].label.toLowerCase()}` : ""}.`
    : `Ближе всего к норме: ${sorted[0].label.toLowerCase()}${weak.length ? `. Над чем работать: ${weak[0].label.toLowerCase()}` : ""}.`;
  return (
    <Card>
      <CardTitle hint="Твои средние за матчи периода против средних Divine/Immortal на тех же героях и позициях, с поправкой на длину каждого матча. Полоса вправо от середины — лучше нормы, влево — хуже. Считаются рейтинговые матчи, которые Stratz разобрал подробно.">Твоя игра против нормы</CardTitle>
      <p className="mb-4 text-sm">{head}</p>
      <div className="grid grid-cols-[150px_minmax(0,1fr)_120px] items-center gap-x-5 gap-y-3 text-sm">
        {/* шапка: ось полос */}
        <span />
        <div className="relative h-4 text-[11px] text-muted">
          <span className="absolute left-0">хуже нормы</span>
          <span className="absolute left-1/2 -translate-x-1/2">норма</span>
          <span className="absolute right-0">лучше нормы</span>
        </div>
        <span />
        {list.map((r) => {
          const d = r.better - 1, w = Math.min(Math.abs(d), 0.5) / 0.5 * 50;
          const good = d >= 0.05, bad = d <= -0.05;
          return [
            <span key={`${r.key}l`} className="text-muted">{r.label}</span>,
            <div key={`${r.key}b`} className="relative h-2.5 rounded-full bg-panel-2" title={`${r.hint}: у тебя в среднем ${fmtN(r.avg)}, норма ${fmtN(r.avgNorm)}`}>
              <span className="absolute left-1/2 top-[-3px] h-4 w-px -translate-x-1/2 bg-muted/50" />
              <span className={`absolute top-0 h-2.5 ${d >= 0 ? "left-1/2 rounded-r-full" : "right-1/2 rounded-l-full"} ${good ? "bg-good" : bad ? "bg-bad" : "bg-muted"}`} style={{ width: `${Math.max(w, 1)}%` }} />
            </div>,
            <span key={`${r.key}v`} className={`tabular-nums font-semibold ${good ? "text-good" : bad ? "text-bad" : ""}`}>{vsText(r)}</span>,
          ];
        })}
      </div>
      <div className="mt-4 text-xs text-muted">Твоё среднее за матч против среднего Divine/Immortal на тех же героях и позициях · {cur.n} {plural(cur.n, "матч", "матча", "матчей")} за {period ? `${period} дней` : "всё время"}. Наведи на полосу, чтобы увидеть цифры.</div>
    </Card>
  );
}
