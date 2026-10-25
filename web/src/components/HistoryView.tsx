"use client";

import { useMemo, useState } from "react";
import type { DraftLog } from "@/lib/log";
import type { Hero } from "@/lib/types";

const icon = (short: string) => `https://cdn.stratz.com/images/dota2/heroes/${short}_icon.png`;
const fmt = (t: number) => new Date(t * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function HistoryView({ items: initial, heroes }: { items: DraftLog[]; heroes: Hero[] }) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const byId = useMemo(() => new Map(heroes.map((h) => [h.id, h])), [heroes]);

  const sync = async () => {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/log/sync", { method: "POST" }).then((x) => x.json()).catch(() => null);
    if (r?.ok) {
      setMsg(r.updated > 0 ? `Готово: результат найден у ${r.updated} ${r.updated === 1 ? "записи" : "записей"}${r.pending ? `, ещё ${r.pending} без результата` : ""}` : r.pending > 0 ? `Пока без результата: ${r.pending}. Stratz получает матч через 5–15 минут после игры, попробуй позже.` : "Нечего обновлять: все записи уже с результатом или история пуста.");
      const fresh = await fetch("/api/log").then((x) => x.json()).catch(() => null);
      if (fresh?.items) setItems(fresh.items);
    } else setMsg(r?.error ?? "ошибка синхронизации");
    setBusy(false);
  };
  const del = async (id: string) => {
    await fetch("/api/log", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setItems(items.filter((x) => x.id !== id));
  };

  const done = items.filter((x) => x.won !== undefined);
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
        <div className="flex items-center gap-3 text-sm">
          <button onClick={sync} disabled={busy} className="rounded-md border border-border px-3 py-1 hover:border-accent disabled:opacity-50">{busy ? "ищу матчи…" : "Подтянуть результаты из Stratz"}</button>
          <a href="/" className="text-muted underline hover:text-foreground">К пикеру</a>
        </div>
      </header>

      {msg && <div className={`rounded-lg border px-3 py-2 text-sm ${msg.startsWith("Готово") ? "border-good/40 bg-good/10 text-good" : "border-border bg-panel text-foreground"}`}>{msg}</div>}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat title="Взял лучшего по совету" s={top1} />
        <Stat title="Взял из топ-3" s={top3} />
        <Stat title="Взял ниже топ-3" s={below} />
        <Stat title="Взял лучшего из пула" s={poolTop} />
      </section>

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
            <div key={x.id} className="rounded-lg border border-border bg-panel p-3 flex flex-wrap items-center gap-3 text-sm">
              <span className="text-xs text-muted w-24">{fmt(x.createdAt)}</span>
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
              <button onClick={() => del(x.id)} className="text-xs text-muted hover:text-bad">удалить</button>
            </div>
          );
        })}
      </section>
    </main>
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
