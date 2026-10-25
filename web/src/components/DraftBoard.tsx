"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseHeroText, type AliasMap } from "@/lib/aliases";
import type { Attr, Candidate, Hero, Pick, PoolOverride, Role, RoleGuess } from "@/lib/types";

type Zone = "bans" | "enemies" | "allies";
const ZONES: { key: Zone; label: string; color: string; max: number; hint: string }[] = [
  { key: "enemies", label: "Враги", color: "border-enemy text-enemy", max: 5, hint: "пудж ам сф лион шейкер" },
  { key: "allies", label: "Союзники", color: "border-ally text-ally", max: 4, hint: "акс см джага" },
  { key: "bans", label: "Баны", color: "border-ban text-ban", max: 24, hint: "инвокер шторм" },
];

const icon = (short: string) => `https://cdn.stratz.com/images/dota2/heroes/${short}_icon.png`;
const portrait = (short: string) => `https://cdn.stratz.com/images/dota2/heroes/${short}_horz.png`;
const ROLE_LABEL: Record<Role, string> = { 1: "керри", 2: "мид", 3: "офлейн", 4: "4", 5: "5" };
const ROLES: Role[] = [1, 2, 3, 4, 5];
const ATTRS: { key: Attr; label: string; color: string }[] = [
  { key: "str", label: "Сила", color: "bg-[#ec3d06]" },
  { key: "agi", label: "Ловкость", color: "bg-[#26e030]" },
  { key: "int", label: "Интеллект", color: "bg-[#00d9ff]" },
  { key: "all", label: "Универсал", color: "bg-gradient-to-r from-[#ec3d06] via-[#26e030] to-[#00d9ff]" },
];
const POOL_KEY = "draft.poolOverride.v1";
const AUTO_KEY = "draft.auto.v1";
const PICKS_KEY = "draft.picks.v1";
const PICKS_TTL = 2 * 3600 * 1000; // драфт восстанавливаем, если ему меньше 2 часов
const EMPTY: PoolOverride = { add: [], remove: [] };

function loadOverride(): PoolOverride {
  try {
    const raw = localStorage.getItem(POOL_KEY);
    if (!raw) return EMPTY;
    const o = JSON.parse(raw);
    return { add: Array.isArray(o.add) ? o.add.map(Number) : [], remove: Array.isArray(o.remove) ? o.remove.map(Number) : [] };
  } catch { return EMPTY; }
}

export default function DraftBoard({ heroes, poolIds, familiarIds, aliases }: { heroes: Hero[]; poolIds: number[]; familiarIds: number[]; aliases: AliasMap }) {
  const [zone, setZone] = useState<Zone>("enemies");
  const [picks, setPicks] = useState<Record<Zone, Pick[]>>({ bans: [], enemies: [], allies: [] });
  const [roles, setRoles] = useState<{ enemies: RoleGuess[]; allies: RoleGuess[] }>({ enemies: [], allies: [] });
  const [query, setQuery] = useState("");
  const [attr, setAttr] = useState<Attr>("str");
  const [quick, setQuick] = useState<Record<Zone, string>>({ bans: "", enemies: "", allies: "" });
  const [unknown, setUnknown] = useState<Record<Zone, string[]>>({ bans: [], enemies: [], allies: [] });
  const [result, setResult] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [override, setOverride] = useState<PoolOverride>(EMPTY);
  const [poolOpen, setPoolOpen] = useState(false);
  const [poolQuery, setPoolQuery] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [gsi, setGsi] = useState<{ connected: boolean; phase: string; ownHeroId: number | null; matchId: string | null } | null>(null);
  const loggedMatch = useRef<string | null>(null);
  const lastKey = useRef<string>("");

  const take = async (heroId: number) => {
    const body = { bans: picks.bans.map((p) => p.id), enemies: picks.enemies, allies: picks.allies, pool: override, chosenHeroId: heroId };
    const r = await fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => null);
    if (r?.ok) { setSaved(byId.get(heroId)?.name ?? ""); setTimeout(() => setSaved(null), 4000); }
  };

  useEffect(() => {
    setOverride(loadOverride());
    try { if (localStorage.getItem(AUTO_KEY) === "1") setAuto(true); } catch {}
    try {
      const raw = localStorage.getItem(PICKS_KEY);
      if (raw) { const o = JSON.parse(raw); if (o && Date.now() - (o.at ?? 0) < PICKS_TTL && o.picks) setPicks(o.picks); }
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem(AUTO_KEY, auto ? "1" : "0"); } catch {} }, [auto]);
  useEffect(() => { try { localStorage.setItem(PICKS_KEY, JSON.stringify({ at: Date.now(), picks })); } catch {} }, [picks]);
  const saveOverride = (o: PoolOverride) => { setOverride(o); try { localStorage.setItem(POOL_KEY, JSON.stringify(o)); } catch {} };

  const byId = useMemo(() => new Map(heroes.map((h) => [h.id, h])), [heroes]);
  const taken = useMemo(() => new Set([...picks.bans, ...picks.enemies, ...picks.allies].map((p) => p.id)), [picks]);
  const poolSet = useMemo(() => new Set([...poolIds, ...override.add].filter((id) => !override.remove.includes(id))), [poolIds, override]);
  const familiarSet = useMemo(() => new Set(familiarIds.filter((id) => !poolSet.has(id) && !override.remove.includes(id))), [familiarIds, poolSet, override]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return heroes.filter((h) => (q ? h.name.toLowerCase().includes(q) || h.short.includes(q) : h.attr === attr));
  }, [heroes, query, attr]);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    const body = { bans: picks.bans.map((p) => p.id), enemies: picks.enemies, allies: picks.allies, pool: override };
    fetch("/api/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => { setResult(d.candidates ?? []); setRoles({ enemies: d.enemyRoles ?? [], allies: d.allyRoles ?? [] }); })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [picks, override]);

  const addMany = (z: Zone, ids: number[]) => {
    const max = ZONES.find((x) => x.key === z)!.max;
    const next = [...picks[z]];
    for (const id of ids) {
      if (taken.has(id) || next.some((p) => p.id === id)) continue;
      if (next.length >= max) break;
      next.push({ id, role: null });
    }
    setPicks({ ...picks, [z]: next });
  };
  const add = (id: number) => { addMany(zone, [id]); setQuery(""); };
  const remove = (z: Zone, id: number) => setPicks({ ...picks, [z]: picks[z].filter((x) => x.id !== id) });
  const setRole = (z: Zone, id: number, role: Role | null) => setPicks({ ...picks, [z]: picks[z].map((x) => (x.id === id ? { ...x, role } : x)) });
  const reset = () => { setPicks({ bans: [], enemies: [], allies: [] }); setUnknown({ bans: [], enemies: [], allies: [] }); };

  const submitQuick = (z: Zone) => {
    const { ids, unknown: unk } = parseHeroText(quick[z], heroes, aliases);
    addMany(z, ids);
    setUnknown({ ...unknown, [z]: unk });
    setQuick({ ...quick, [z]: "" });
  };

  useEffect(() => {
    if (!auto) return;
    let stop = false;
    const tick = async () => {
      const r = await fetch("/api/gsi/state").then((x) => x.json()).catch(() => null);
      if (stop) return;
      if (r) {
        const d = r.draft;
        setGsi({ connected: r.connected, phase: d?.phase ?? "", ownHeroId: d?.ownHeroId ?? null, matchId: d?.matchId ?? null });
        if (r.connected && d && d.phase === "DOTA_GAMERULES_STATE_HERO_SELECTION") {
          const key = JSON.stringify([d.bans, d.enemies.map((p: Pick) => p.id), d.allies.map((p: Pick) => p.id)]);
          if (key !== lastKey.current) {
            lastKey.current = key;
            setPicks((prev) => ({
              bans: d.bans.map((id: number) => ({ id, role: null })),
              enemies: d.enemies.map((p: Pick) => ({ id: p.id, role: prev.enemies.find((x) => x.id === p.id)?.role ?? null })),
              allies: d.allies.map((p: Pick) => ({ id: p.id, role: prev.allies.find((x) => x.id === p.id)?.role ?? null })),
            }));
          }
        }
        // герой выбран и драфт закончился: записываем в историю один раз на матч
        if (r.connected && d && d.ownHeroId && d.matchId && d.phase !== "DOTA_GAMERULES_STATE_HERO_SELECTION" && loggedMatch.current !== d.matchId && d.enemies.length > 0) {
          loggedMatch.current = d.matchId;
          const body = { bans: d.bans, enemies: d.enemies, allies: d.allies, pool: override, chosenHeroId: d.ownHeroId };
          fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).then((j) => { if (j?.ok) { setSaved(byId.get(d.ownHeroId)?.name ?? ""); setTimeout(() => setSaved(null), 6000); } }).catch(() => {});
        }
      }
      if (!stop) setTimeout(tick, 1500);
    };
    tick();
    return () => { stop = true; };
  }, [auto, override, byId]);

  const togglePool = (id: number) => {
    const inPool = poolSet.has(id);
    const base = poolIds.includes(id);
    const add = override.add.filter((x) => x !== id);
    const rem = override.remove.filter((x) => x !== id);
    if (inPool) { if (base) rem.push(id); } else { if (!base) add.push(id); }
    saveOverride({ add, remove: rem });
  };

  const inPool = result.filter((c) => c.poolStatus !== "outside");
  const outside = result.filter((c) => c.poolStatus === "outside").slice(0, showAll ? 40 : 8);
  const poolList = useMemo(() => {
    const q = poolQuery.trim().toLowerCase();
    return heroes.filter((h) => !q || h.name.toLowerCase().includes(q)).sort((a, b) => Number(poolSet.has(b.id)) - Number(poolSet.has(a.id)) || a.name.localeCompare(b.name));
  }, [heroes, poolQuery, poolSet]);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-5 flex flex-col gap-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Драфт-помощник <span className="text-muted text-base font-normal">мид · Divine/Immortal</span></h1>
        <div className="flex gap-4 text-sm items-center">
          {saved && <span className="text-good text-xs">сохранил: {saved}</span>}
          <label className="flex items-center gap-1.5 cursor-pointer" title="Подхватывать драфт из Доты через GSI (настрой в Настройках)">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-[var(--accent)]" />
            <span>Авто</span>
            {auto && <span className={`inline-block h-2 w-2 rounded-full ${gsi?.connected ? "bg-good" : "bg-bad"}`} title={gsi?.connected ? `Дота на связи${gsi.phase ? ` · ${gsi.phase.replace("DOTA_GAMERULES_STATE_", "").toLowerCase()}` : ""}` : "Дота не шлёт данные: проверь конфиг GSI и перезапусти игру"} />}
          </label>
          <a href="/history" className="text-muted hover:text-foreground underline">История драфтов</a>
          <a href="/settings" className="text-muted hover:text-foreground underline">Настройки</a>
          <button onClick={() => setPoolOpen(true)} className="text-accent hover:underline">Мой пул · {poolSet.size}</button>
          <button onClick={reset} className="text-muted hover:text-foreground underline">Сбросить драфт</button>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-3">
        {ZONES.map((z) => (
          <div key={z.key} onClick={() => setZone(z.key)}
            className={`rounded-xl border-2 bg-panel p-3 cursor-pointer transition ${zone === z.key ? z.color : "border-border"}`}>
            <div className="flex items-center justify-between mb-2">
              <span className={`text-sm font-semibold ${z.color.split(" ")[1]}`}>{z.label}</span>
              <span className="text-xs text-muted">{picks[z.key].length}/{z.max}{zone === z.key ? " · добавляю сюда" : ""}</span>
            </div>
            <div className="flex flex-wrap gap-2 min-h-10 mb-2">
              {picks[z.key].map((p) => {
                const h = byId.get(p.id)!;
                const guess = z.key === "bans" ? undefined : roles[z.key].find((g) => g.id === p.id);
                return (
                  <div key={p.id} onClick={(e) => e.stopPropagation()} className="flex items-center rounded-md bg-panel-2 text-xs overflow-hidden">
                    <button onClick={() => remove(z.key, p.id)} title="Убрать" className="flex items-center gap-1 pr-2 hover:bg-border">
                      <img src={icon(h.short)} alt="" className="h-7 w-7" />{h.name}
                    </button>
                    {z.key !== "bans" && (
                      <select value={p.role ?? ""} onChange={(e) => setRole(z.key, p.id, e.target.value ? (Number(e.target.value) as Role) : null)}
                        title={p.role ? "Роль задана тобой" : guess ? `Предполагаю: ${ROLE_LABEL[guess.role]} (${Math.round(guess.prob * 100)}%)` : "Роль"}
                        className={`h-7 border-l border-border bg-panel px-1 outline-none cursor-pointer ${p.role ? "text-foreground" : "text-muted italic"}`}>
                        <option value="">{guess ? `${ROLE_LABEL[guess.role]}?` : "роль?"}</option>
                        {ROLES.filter((r) => !(z.key === "allies" && r === 2)).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
            <input value={quick[z.key]} onChange={(e) => setQuick({ ...quick, [z.key]: e.target.value })} onClick={(e) => { e.stopPropagation(); setZone(z.key); }}
              onKeyDown={(e) => { if (e.key === "Enter") submitQuick(z.key); }} placeholder={`текстом: ${z.hint}`}
              className="w-full rounded-md border border-border bg-panel-2 px-2 py-1 text-xs outline-none focus:border-accent placeholder:text-muted/60" />
            {unknown[z.key].length > 0 && <div className="mt-1 text-[11px] text-bad">не узнал: {unknown[z.key].join(", ")}</div>}
          </div>
        ))}
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
        <section className="rounded-xl border border-border bg-panel p-3 flex flex-col gap-3 min-w-0">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск героя (английское имя)…"
            onKeyDown={(e) => { if (e.key === "Enter" && filtered.length > 0) add(filtered.find((h) => !taken.has(h.id))?.id ?? filtered[0].id); }}
            className="w-full rounded-lg border border-border bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent" autoFocus />
          <div className="flex gap-1 border-b border-border overflow-x-auto">
            {ATTRS.map((a) => (
              <button key={a.key} onClick={() => { setAttr(a.key); setQuery(""); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm whitespace-nowrap border-b-2 -mb-px transition ${attr === a.key && !query ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"}`}>
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${a.color}`} />{a.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2 max-h-[62vh] overflow-y-auto pr-1">
            {filtered.map((h) => {
              const dis = taken.has(h.id);
              const ring = poolSet.has(h.id) ? "ring-2 ring-accent" : familiarSet.has(h.id) ? "ring-1 ring-accent/50" : "";
              return (
                <button key={h.id} onClick={() => add(h.id)} disabled={dis} title={h.name}
                  className={`group flex flex-col items-center gap-1 rounded-md ${dis ? "opacity-25 cursor-not-allowed grayscale" : "hover:-translate-y-0.5 transition"}`}>
                  <img src={portrait(h.short)} alt={h.name} loading="lazy" className={`w-full aspect-[16/9] object-cover rounded-md ${ring}`} />
                  <span className="text-[11px] leading-tight text-center text-muted group-hover:text-foreground">{h.name}</span>
                </button>
              );
            })}
            {filtered.length === 0 && <span className="text-sm text-muted col-span-full">Никого не нашёл</span>}
          </div>
          <p className="text-xs text-muted">Золотая рамка — твой пул, тонкая — знакомые герои (3–9 игр на миде за год). Пул можно править кнопкой «Мой пул». Роль со знаком «?» предсказана по статистике, выбери в списке, если знаешь точно.</p>
        </section>

        <section className="flex flex-col gap-4 min-w-0">
          <ResultBlock title="Из твоего пула" items={inPool} loading={loading} byId={byId} onTake={take} />
          <ResultBlock title="Вне пула, но хороши в этот драфт" items={outside} loading={loading} byId={byId} onTake={take}
            footer={<button onClick={() => setShowAll(!showAll)} className="text-xs text-muted underline">{showAll ? "Показать меньше" : "Показать больше"}</button>} />
        </section>
      </div>

      {poolOpen && (
        <div className="fixed inset-0 z-20 bg-black/60 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setPoolOpen(false)}>
          <div className="w-full max-w-2xl rounded-xl border border-border bg-panel p-4 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Мой пул · {poolSet.size} героев</h2>
              <button onClick={() => setPoolOpen(false)} className="text-muted hover:text-foreground">Закрыть</button>
            </div>
            <p className="text-xs text-muted">По умолчанию в пуле герои с 10+ играми на миде за год. Отметь тех, на ком реально играешь: они попадут в список «Из твоего пула». Правки хранятся в этом браузере.</p>
            <input value={poolQuery} onChange={(e) => setPoolQuery(e.target.value)} placeholder="Найти героя…" className="w-full rounded-lg border border-border bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent" />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 max-h-[60vh] overflow-y-auto pr-1">
              {poolList.map((h) => {
                const on = poolSet.has(h.id);
                return (
                  <label key={h.id} className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm cursor-pointer ${on ? "bg-accent/15" : "hover:bg-panel-2"}`}>
                    <input type="checkbox" checked={on} onChange={() => togglePool(h.id)} className="accent-[var(--accent)]" />
                    <img src={icon(h.short)} alt="" className="h-6 w-6 rounded" />
                    <span className="truncate">{h.name}</span>
                  </label>
                );
              })}
            </div>
            {(override.add.length > 0 || override.remove.length > 0) && (
              <button onClick={() => saveOverride(EMPTY)} className="self-start text-xs text-muted underline">Сбросить правки к автоматическому пулу</button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function ResultBlock({ title, items, loading, byId, footer, onTake }: { title: string; items: Candidate[]; loading: boolean; byId: Map<number, Hero>; footer?: React.ReactNode; onTake: (id: number) => void }) {
  return (
    <div className="rounded-xl border border-border bg-panel p-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold">{title}</h2>
        {loading && <span className="text-xs text-muted">считаю…</span>}
      </div>
      <div className="flex flex-col gap-2">
        {items.map((c) => <Row key={c.heroId} c={c} byId={byId} onTake={onTake} />)}
        {items.length === 0 && !loading && <span className="text-sm text-muted">Пусто</span>}
      </div>
      {footer && <div className="mt-2">{footer}</div>}
    </div>
  );
}

function Row({ c, byId, onTake }: { c: Candidate; byId: Map<number, Hero>; onTake: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const h = byId.get(c.heroId)!;
  const tone = c.finalScore >= 55 ? "text-good" : c.finalScore <= 45 ? "text-bad" : "text-foreground";
  const tag = c.poolStatus === "pool" ? <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[11px] text-accent">в пуле</span>
    : c.poolStatus === "familiar" ? <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent/80">знакомый</span>
    : <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[11px] text-muted">вне пула</span>;
  const top = c.reasons.slice(0, 3);
  return (
    <div className="rounded-lg bg-panel-2 p-2 cursor-pointer" onClick={() => setOpen(!open)}>
      <div className="flex items-center gap-3">
        <img src={icon(h.short)} alt="" className="h-10 w-10 rounded-md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{c.name}</span>{tag}
            {c.personalWinrate !== null && <span className="text-xs text-muted">ты: {c.midWins}–{c.midGames - c.midWins} ({c.personalWinrate}%)</span>}
          </div>
          <div className="text-xs text-muted truncate">
            {top.length === 0 ? `базовый винрейт на миде ${c.base}%` : top.map((r) => `${r.value > 0 ? "+" : ""}${r.value} ${r.kind === "vs" ? "против" : "с"} ${r.name}${r.laneOpp ? " (мид)" : ""}`).join(" · ")}
          </div>
        </div>
        <div className="text-right">
          <div className={`text-xl font-semibold ${tone}`}>{Math.round(c.finalScore)}%</div>
          <div className="text-[11px] text-muted">драфт {Math.round(c.draftScore)}%</div>
        </div>
        <button onClick={(e) => { e.stopPropagation(); onTake(c.heroId); }} title="Записать в историю, что ты взял этого героя"
          className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent">Беру</button>
      </div>
      {open && (
        <div className="mt-2 border-t border-border pt-2 text-xs text-muted grid gap-1">
          <div>Базовый винрейт героя на миде: <b className="text-foreground">{c.base}%</b> · контрпики: <b className="text-foreground">{c.vsTotal > 0 ? "+" : ""}{c.vsTotal}</b> · синергии: <b className="text-foreground">{c.withTotal > 0 ? "+" : ""}{c.withTotal}</b> · поправка на твой опыт: <b className="text-foreground">{c.personalAdj > 0 ? "+" : ""}{c.personalAdj}</b></div>
          {c.reasons.map((r) => <div key={`${r.kind}-${r.heroId}`}>{r.value > 0 ? "+" : ""}{r.value} {r.kind === "vs" ? "против" : "вместе с"} {r.name}{r.laneOpp ? <span className="text-enemy"> · их мидер, вес x1.75</span> : null} <span className="opacity-60">({r.games} игр в выборке)</span></div>)}
          {c.personalNotes.map((n) => <div key={`${n.ally}-${n.heroId}`} className="text-accent">Твоя история {n.ally ? "вместе с" : "против"} {n.name}: {n.wins}–{n.games - n.wins}</div>)}
          <div className="opacity-60">Доля мид-игр у героя на Divine/Immortal: {Math.round(c.midRate * 100)}%</div>
        </div>
      )}
    </div>
  );
}
