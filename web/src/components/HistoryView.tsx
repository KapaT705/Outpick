"use client";

import { useMemo, useState } from "react";
import type { DraftLog } from "@/lib/log";
import type { MatchDetails } from "@/lib/matchDetails";
import type { Bench } from "@/lib/bench";
import type { Hero } from "@/lib/types";
import { Button, Card, CardTitle, Chip, Empty, Hint } from "@/components/ui";

// иконки с CDN Valve: у Stratz alchemist_icon.png оказался копией dragon_knight_icon.png
const icon = (short: string) => `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/icons/${short}.png`;
const portrait = (short: string) => `https://cdn.stratz.com/images/dota2/heroes/${short}_horz.png`;
const fmt = (t: number) => new Date(t * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function HistoryView({ items: initial, heroes, accounts = {}, defaultAccountId = null, currentAccountId = null }: { items: DraftLog[]; heroes: Hero[]; accounts?: Record<number, string>; defaultAccountId?: number | null; currentAccountId?: number | null }) {
  const [all, setItems] = useState(initial);
  // история по аккаунтам: открывается на текущем (под которым идёт игра или выбран по умолчанию), переключатель на любой или на все
  const accOf = (x: DraftLog) => x.accountId ?? defaultAccountId;
  const accountIds = [...new Set(all.map(accOf).filter((id): id is number => !!id))];
  const [acc, setAcc] = useState<number | "all">(currentAccountId && accountIds.includes(currentAccountId) ? currentAccountId : accountIds.length > 1 ? "all" : (accountIds[0] ?? "all"));
  const items = acc === "all" ? all : all.filter((x) => accOf(x) === acc);
  const multiAccount = acc === "all" && accountIds.length > 1;
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
  const wins = done.filter((x) => x.won).length;
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
  const byAdvice = stat(advised), offAdvice = stat((x) => !advised(x));
  // калибровка: предсказанный % против реального
  const buckets = [[0, 48], [48, 52], [52, 56], [56, 100]].map(([lo, hi]) => {
    const s = done.filter((x) => x.chosen && x.chosen.finalScore >= lo && x.chosen.finalScore < hi);
    return { label: hi === 100 ? `${lo}%+` : `${lo}–${hi}%`, n: s.length, wr: s.length ? Math.round((s.filter((x) => x.won).length / s.length) * 100) : null, avg: s.length ? Math.round(s.reduce((a, x) => a + x.chosen!.finalScore, 0) / s.length) : null };
  });
  const periodLabel = period ? `${period} дней` : "всё время";

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-5 flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="text-xl font-semibold">История</h1>
          <span className="text-xs text-muted">{items.length} {plural(items.length, "драфт", "драфта", "драфтов")} · с результатом {items.filter((x) => x.won !== undefined).length}</span>
          {accountIds.length > 1 && (
            <div className="flex rounded-lg border border-border overflow-hidden text-xs" title="Чья история. Открывается на аккаунте, под которым сейчас играешь.">
              {accountIds.map((id) => <button key={id} onClick={() => setAcc(id)} className={`px-3 py-1.5 ${acc === id ? "bg-accent/25 text-accent font-semibold" : "text-muted hover:text-foreground hover:bg-panel-2"}`}>{accounts[id] ?? id}</button>)}
              <button onClick={() => setAcc("all")} className={`px-3 py-1.5 ${acc === "all" ? "bg-accent/25 text-accent font-semibold" : "text-muted hover:text-foreground hover:bg-panel-2"}`}>все</button>
            </div>
          )}
        </div>
        <Button size="sm" onClick={sync} disabled={busy} title="Найти результаты записанных драфтов на Stratz (и OpenDota для закрытых профилей). Когда Дота на связи, это происходит само после матча.">{busy ? "ищу матчи…" : "Подтянуть результаты"}</Button>
      </header>

      {msg && <Card tone={msg.startsWith("Готово") ? "good" : "default"} className="py-2.5 text-sm">{msg}</Card>}

      {last && (() => { const h = byId.get(last.chosenHeroId); const adv = last.topPool[0]; const advAll = last.topAll[0]; return (
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
        </Card>
      ); })()}

      <section className="flex flex-wrap items-center gap-3 text-xs">
        <span className="text-muted">Сводка за</span>
        <div className="flex rounded-lg border border-border overflow-hidden">
          {[7, 30, 90, 0].map((d) => <button key={d} onClick={() => setPeriod(d)} className={`px-3 py-1.5 ${period === d ? "bg-accent/25 text-accent font-semibold" : "text-muted hover:text-foreground hover:bg-panel-2"}`}>{d ? `${d} дней` : "всё время"}</button>)}
        </div>
        {done.length > 0 ? (
          <span className="flex flex-wrap items-center gap-2">
            <Chip tone={wins / done.length >= 0.5 ? "good" : "bad"} title={`${wins} побед, ${done.length - wins} поражений`}>{done.length} {plural(done.length, "матч", "матча", "матчей")} · {Math.round((wins / done.length) * 100)}%</Chip>
            {byAdvice.wr !== null && <Chip tone="muted" title="Винрейт матчей, где взят герой из топ-3 совета пикера">по совету {byAdvice.wr}% ({byAdvice.n})</Chip>}
            {offAdvice.wr !== null && <Chip tone="muted" title="Винрейт матчей, где взят герой ниже топ-3 или не оценивался">не по совету {offAdvice.wr}% ({offAdvice.n})</Chip>}
          </span>
        ) : <span className="text-muted">за {periodLabel} матчей с результатом нет</span>}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat title="Взял первого по совету" hint="Матчи, где ты взял героя, которого пикер ставил первым" s={top1} />
        <Stat title="Взял из топ-3" hint="Матчи, где взятый герой был в первой тройке совета" s={top3} />
        <Stat title="Взял ниже топ-3" hint="Матчи, где взятый герой стоял ниже третьего места или не оценивался" s={below} />
        <Stat title="Взял лучшего из пула" hint="Матчи, где ты взял первого героя из списка «Из твоего пула»" hintAlign="right" s={poolTop} />
      </section>

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

      <Card>
        <CardTitle hint="Матчи сгруппированы по шансу, который пикер давал взятому герою. Если реальный винрейт в столбце близок к прогнозу, оценки честные. Нужны десятки игр в каждом столбце, раньше это шум.">Насколько точен пикер</CardTitle>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          {buckets.map((b) => (
            <div key={b.label} className="rounded-lg bg-panel-2 p-2.5">
              <div className="text-muted text-xs">прогноз {b.label}</div>
              <div className={`text-xl font-semibold tabular-nums ${b.wr === null ? "text-muted" : ""}`}>{b.wr === null ? "—" : `${b.wr}%`}</div>
              <div className="text-xs text-muted">{b.n} {plural(b.n, "игра", "игры", "игр")}{b.avg !== null ? ` · средний прогноз ${b.avg}%` : ""}</div>
            </div>
          ))}
        </div>
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Все драфты</h2>
        {items.length === 0 && <Empty>Пока пусто. Когда Дота на связи, драфт записывается сам после твоего пика. Без связи нажми «Беру» на взятом герое в пикере.</Empty>}
        {items.map((x) => {
          const h = byId.get(x.chosenHeroId);
          const open = openId === x.id;
          const res = x.won === undefined ? <Chip tone="muted">{x.noMatch ? "матч не найден" : "ждёт результата"}</Chip> : x.won ? <Chip tone="good">победа</Chip> : <Chip tone="bad">поражение</Chip>;
          return (
            <div key={x.id} className={`rounded-xl border bg-panel p-3 flex flex-wrap items-center gap-3 text-sm cursor-pointer transition ${open ? "border-accent/40" : "border-border hover:border-border/70"}`} onClick={() => setOpenId(open ? null : x.id)} title={open ? undefined : "Нажми, чтобы раскрыть советы и разбор матча"}>
              <span className="text-xs text-muted w-24 tabular-nums">{fmt(x.createdAt)}</span>
              {h && <img src={icon(h.short)} alt="" className="h-9 w-9 rounded-md" />}
              <div className="min-w-0 flex-1 flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <b>{h?.name ?? x.chosenHeroId}</b>{res}
                  {multiAccount && <Chip tone="muted" title="Аккаунт Steam, с которого играли">{accName(x)}</Chip>}
                  {x.durationSeconds ? <span className="text-xs text-muted">{Math.round(x.durationSeconds / 60)} мин</span> : null}
                  <span className="text-xs text-muted">{x.chosen ? `шанс ${Math.round(x.chosen.finalScore)}% · место ${x.chosen.rank}` : "герой не оценивался"}{x.topPool[0] && x.topPool[0].heroId !== x.chosenHeroId ? ` · совет был ${x.topPool[0].name}` : ""}</span>
                </div>
                <div className="text-xs text-muted flex flex-wrap items-center gap-1">
                  <span className="text-enemy mr-0.5">против</span>{x.enemies.map((e) => <img key={e.id} src={icon(byId.get(e.id)?.short ?? "")} alt="" className="h-5 w-5 rounded" title={byId.get(e.id)?.name} />)}
                  {x.allies.length > 0 && <><span className="text-ally ml-2 mr-0.5">с</span>{x.allies.map((e) => <img key={e.id} src={icon(byId.get(e.id)?.short ?? "")} alt="" className="h-5 w-5 rounded" title={byId.get(e.id)?.name} />)}</>}
                </div>
              </div>
              {x.matchId ? <a className="text-xs text-muted hover:text-foreground underline" href={`https://stratz.com/matches/${x.matchId}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Stratz</a> : null}
              <button onClick={(e) => { e.stopPropagation(); del(x.id); }} className="text-xs text-muted hover:text-bad" title="Удалить запись">удалить</button>
              {open && (
                <div className="basis-full border-t border-border pt-3 text-xs text-muted grid gap-3 sm:grid-cols-2" onClick={(e) => e.stopPropagation()}>
                  <div>
                    <div className="text-foreground font-medium mb-1">Совет из пула</div>
                    {x.topPool.length ? <ol className="grid gap-0.5">{x.topPool.map((r) => <li key={r.heroId} className={r.heroId === x.chosenHeroId ? "text-accent" : ""}>{r.rank}. {r.name} <span className="opacity-70">{Math.round(r.finalScore)}%</span>{r.heroId === x.chosenHeroId ? " · ты" : ""}</li>)}</ol> : <span>пул аккаунта не был загружен</span>}
                  </div>
                  <div>
                    <div className="text-foreground font-medium mb-1">Лучшие вообще</div>
                    <ol className="grid gap-0.5">{x.topAll.map((r) => <li key={r.heroId} className={r.heroId === x.chosenHeroId ? "text-accent" : ""}>{r.rank}. {r.name} <span className="opacity-70">{Math.round(r.finalScore)}%</span>{r.heroId === x.chosenHeroId ? " · ты" : ""}</li>)}</ol>
                  </div>
                  <div className="sm:col-span-2">
                    <div className="text-foreground font-medium mb-1">Разбор матча</div>
                    {x.details ? <MatchStats d={x.details} b={x.bench ?? null} byId={byId} /> : x.matchId ? <Button size="sm" onClick={() => loadDetails(x.id)} disabled={detailsBusy === x.id}>{detailsBusy === x.id ? "загружаю…" : "Загрузить разбор"}</Button> : <span>Появится, когда подтянется результат.</span>}
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
  const cells: { label: string; value: string; cls: string; norm?: string | null }[] = [
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
  if (oppName) cells.push({ label: `Линия против ${oppName}`, value: laneDiff != null ? `${laneDiff > 0 ? "+" : ""}${laneDiff}` : "—", cls: laneDiff == null ? "text-foreground" : laneDiff >= 300 ? "text-good" : laneDiff <= -300 ? "text-bad" : "text-foreground", norm: laneDiff != null ? "золота к 10 мин" : null });
  return (
    <div className="flex flex-wrap gap-1.5" title={b ? `Норма: средние Divine/Immortal на этом герое и позиции, ${b.matchCount} матчей, винрейт ${Math.round(b.winrate * 100)}%. Зелёное лучше нормы на 10% и больше, красное хуже.` : "Нормы нет: Stratz не ответил"}>
      {cells.map((c) => (
        <span key={c.label} className="rounded-md bg-panel-2 px-2 py-1 flex flex-col leading-tight min-w-14">
          <span className="text-[10px] text-muted">{c.label}</span>
          <span className={`text-xs tabular-nums ${c.cls}`}><b>{c.value}</b>{c.norm ? <span className="text-muted font-normal"> / {c.norm}</span> : null}</span>
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
      <div className="text-xs text-muted">{s.n ? `${s.w}–${s.n - s.w} · ${s.n} ${plural(s.n, "игра", "игры", "игр")}` : "игр нет"}</div>
    </Card>
  );
}
