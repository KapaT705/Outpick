"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseHeroText, type AliasMap } from "@/lib/aliases";
import type { Attr, Candidate, DraftStage, Hero, LaneOpponent, Pick, PoolOverride, PredictedPicks, Role, RoleGuess, TeamNeed } from "@/lib/types";
import type { RecognizeResult } from "@/components/AppShell";
import { newTrackState, trackFrame } from "@/lib/draftTrack";
import { Button, Card, CardTitle, Chip, Status } from "@/components/ui";
import Crystals from "@/components/Crystals";

// зона банов на экране не нужна: в ранговом All Pick баны заданы заранее списком и в драфте их не видно.
// Список picks.bans живёт только внутри: туда попадают герои-конфликты (выбраны обеими командами, пропали из слота),
// чтобы пикер их не советовал. Руками их не вводят.
type Zone = "bans" | "enemies" | "allies";
type UserZone = Exclude<Zone, "bans">;
const ZONES: { key: UserZone; label: string; color: string; max: number; hint: string }[] = [
  { key: "enemies", label: "Враги", color: "border-enemy text-enemy", max: 5, hint: "пудж ам сф лион шейкер" },
  { key: "allies", label: "Союзники", color: "border-ally text-ally", max: 5, hint: "акс см джага" }, // пятый союзник это ты: встаёт сам, когда Дота сообщит твой пик
];

// иконки с CDN Valve: у Stratz alchemist_icon.png оказался копией dragon_knight_icon.png
const icon = (short: string) => `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/icons/${short}.png`;
const portrait = (short: string) => `https://cdn.stratz.com/images/dota2/heroes/${short}_horz.png`;
// роли везде цифрами, как в игре: 1 керри, 2 мид, 3 офлейн, 4 и 5 саппорты (полные названия в подсказках)
const ROLE_LABEL: Record<Role, string> = { 1: "1", 2: "2", 3: "3", 4: "4", 5: "5" };
const ROLE_NAME: Record<Role, string> = { 1: "керри", 2: "мид", 3: "офлейн", 4: "саппорт 4", 5: "саппорт 5" };
const ROLES: Role[] = [1, 2, 3, 4, 5];
const ATTRS: { key: Attr; label: string; color: string }[] = [
  { key: "str", label: "Сила", color: "bg-[#ec3d06]" },
  { key: "agi", label: "Ловкость", color: "bg-[#26e030]" },
  { key: "int", label: "Интеллект", color: "bg-[#00d9ff]" },
  { key: "all", label: "Универсал", color: "bg-gradient-to-r from-[#ec3d06] via-[#26e030] to-[#00d9ff]" },
];
const POOL_KEY = "draft.poolOverride.v1";
const PICKS_KEY = "draft.picks.v1";
const PICKS_TTL = 2 * 3600 * 1000; // драфт восстанавливаем, если ему меньше 2 часов
const EMPTY: PoolOverride = { add: [], remove: [] };

function loadOverride(role: Role): PoolOverride {
  try {
    const raw2 = localStorage.getItem(POOL_KEY_V2);
    if (raw2) { const all = JSON.parse(raw2); const o = all?.[role]; if (o) return { add: Array.isArray(o.add) ? o.add.map(Number) : [], remove: Array.isArray(o.remove) ? o.remove.map(Number) : [] }; return EMPTY; }
    // старый формат (только мид)
    const raw = localStorage.getItem(POOL_KEY);
    if (raw && role === 2) { const o = JSON.parse(raw); return { add: Array.isArray(o.add) ? o.add.map(Number) : [], remove: Array.isArray(o.remove) ? o.remove.map(Number) : [] }; }
    return EMPTY;
  } catch { return EMPTY; }
}
function storeOverride(role: Role, o: PoolOverride) {
  try { const all = JSON.parse(localStorage.getItem(POOL_KEY_V2) ?? "{}"); all[role] = o; localStorage.setItem(POOL_KEY_V2, JSON.stringify(all)); } catch {}
}

const ROLE_FULL: Record<Role, string> = { 1: "1 · керри", 2: "2 · мид", 3: "3 · офлейн", 4: "4 · саппорт", 5: "5 · саппорт" };
const ROLE_KEY = "draft.role.v1";
const POOL_KEY_V2 = "draft.poolOverride.v2"; // { [role]: {add, remove} }

type AccountInfo = { id: number | null; source: "gsi" | "steam" | "manual" | "none"; known: boolean; name: string | null };
type AccountsState = { current: AccountInfo; accounts: { id: number; name?: string; known: boolean }[]; poolByRole: Record<number, number[]>; familiarByRole: Record<number, number[]>; recordByRole?: Record<number, Record<number, { games: number; wins: number }>> };

export default function DraftBoard({ heroes, aliases }: { heroes: Hero[]; aliases: AliasMap }) {
  const [role, setRoleState] = useState<Role>(2);
  // аккаунт и его пул: Дота сообщает Steam ID играющего, и профиль переключается сам (см. lib/accounts)
  const [acct, setAcct] = useState<AccountsState | null>(null);
  const [loadMsg, setLoadMsg] = useState<string | null>(null);
  const poolIds = acct?.poolByRole[role] ?? [];
  const familiarIds = acct?.familiarByRole[role] ?? [];
  const reloadAccounts = () => fetch("/api/accounts").then((r) => r.json()).then((a) => { if (a?.current) setAcct(a); }).catch(() => {});
  const loadHistory = async (id: number) => {
    setLoadMsg("запускаю…");
    const r = await fetch("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "load", id }) }).then((x) => x.json()).catch(() => null);
    if (!r?.ok) { setLoadMsg(r?.error ?? "ошибка"); return; }
    const poll = async () => {
      const st = await fetch("/api/refresh").then((x) => x.json()).catch(() => null);
      if (st?.running) { setLoadMsg(st.message); setTimeout(poll, 1500); return; }
      setLoadMsg(st?.error ? `ошибка: ${st.error}` : null);
      reloadAccounts();
    };
    setTimeout(poll, 1000);
  };
  const [zone, setZone] = useState<UserZone>("enemies");
  const [picks, setPicks] = useState<Record<Zone, Pick[]>>({ bans: [], enemies: [], allies: [] });
  const [roles, setRoles] = useState<{ enemies: RoleGuess[]; allies: RoleGuess[] }>({ enemies: [], allies: [] });
  const [laneOpp, setLaneOpp] = useState<LaneOpponent | null>(null); // соперник по линии из оценки драфта
  const [predicted, setPredicted] = useState<PredictedPicks[]>([]); // вероятные пики врага на незанятые роли
  const [stage, setStage] = useState<DraftStage>("early"); // очередь пика по числу известных врагов
  const [needs, setNeeds] = useState<TeamNeed[]>([]); // чего не хватает команде
  const [query, setQuery] = useState("");
  const [attr, setAttr] = useState<Attr>("str");
  const [quick, setQuick] = useState<Record<UserZone, string>>({ enemies: "", allies: "" });
  const [unknown, setUnknown] = useState<Record<UserZone, string[]>>({ enemies: [], allies: [] });
  const [result, setResult] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [override, setOverride] = useState<PoolOverride>(EMPTY);
  const [poolOpen, setPoolOpen] = useState(false);
  const [poolQuery, setPoolQuery] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const auto = true; // связь с Дотой работает всегда, когда программа открыта
  const [gsi, setGsi] = useState<{ connected: boolean; phase: string; ownHeroId: number | null; matchId: string | null; team: "radiant" | "dire" | null; accountId: number | null } | null>(null);
  const [screen, setScreen] = useState<{ status: string; found: number } | null>(null);
  const [captureOn, setCaptureOn] = useState(true);
  const [setup, setSetup] = useState<{ steam: boolean; token: boolean; gsi: boolean } | null>(null);
  const [setupHidden, setSetupHidden] = useState(false);
  const [side, setSideState] = useState<"radiant" | "dire">("radiant"); // своя сторона, если Дота не на связи
  const [gsiRewritten, setGsiRewritten] = useState(false);
  const setSide = (v: "radiant" | "dire") => { setSideState(v); try { localStorage.setItem("draft.side.v1", v); } catch {} };
  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((c) => { setCaptureOn(c.screenCapture !== false); setSetup((p) => ({ steam: !!c.steamAccountId, token: !!c.hasToken, gsi: p?.gsi ?? false })); }).catch(() => {});
    fetch("/api/gsi/install").then((r) => r.json()).then((g) => { setSetup((p) => ({ steam: p?.steam ?? false, token: p?.token ?? false, gsi: !!g.installed })); if (g.rewritten) setGsiRewritten(true); }).catch(() => {});
    try { setSetupHidden(sessionStorage.getItem("draft.setupHidden") === "1"); } catch {}
    try { const v = localStorage.getItem("draft.side.v1"); if (v === "radiant" || v === "dire") setSideState(v); } catch {}
    reloadAccounts();
  }, []);
  // Дота сообщила другой аккаунт: перечитываем его пул
  const acctId = gsi?.accountId ?? null;
  useEffect(() => { if (acct && acct.current.id !== acctId) reloadAccounts(); }, [acctId]); // eslint-disable-line react-hooks/exhaustive-deps
  const track = useRef(newTrackState()); // стабилизация слотов и пропавшие герои (конфликт пиков → бан), см. lib/draftTrack
  const loggedMatch = useRef<string | null>(null);
  const lastKey = useRef<string>("");

  const take = async (heroId: number) => {
    const body = { bans: picks.bans.map((p) => p.id), enemies: picks.enemies, allies: picks.allies, pool: override, role, chosenHeroId: heroId };
    const r = await fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => null);
    if (r?.ok) { setSaved(byId.get(heroId)?.name ?? ""); setTimeout(() => setSaved(null), 4000); }
  };

  useEffect(() => {
    let r: Role = 2;
    try { const v = Number(localStorage.getItem(ROLE_KEY)); if ([1, 2, 3, 4, 5].includes(v)) r = v as Role; } catch {}
    setRoleState(r);
    setOverride(loadOverride(r));
    try {
      const raw = localStorage.getItem(PICKS_KEY);
      if (raw) { const o = JSON.parse(raw); if (o && Date.now() - (o.at ?? 0) < PICKS_TTL && o.picks) setPicks(o.picks); }
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem(PICKS_KEY, JSON.stringify({ at: Date.now(), picks })); } catch {} }, [picks]);
  const saveOverride = (o: PoolOverride) => { setOverride(o); storeOverride(role, o); };
  const setRole = (r: Role) => { setRoleState(r); setOverride(loadOverride(r)); try { localStorage.setItem(ROLE_KEY, String(r)); } catch {} };

  const byId = useMemo(() => new Map(heroes.map((h) => [h.id, h])), [heroes]);
  // свой герой: его сообщает Дота после пика; в зоне союзников он пятый, с пометкой «ты»
  const ownHero = gsi?.ownHeroId ? byId.get(gsi.ownHeroId) ?? null : null;
  const taken = useMemo(() => new Set([...picks.bans, ...picks.enemies, ...picks.allies].map((p) => p.id).concat(ownHero ? [ownHero.id] : [])), [picks, ownHero]);
  // кем занят герой: подпись на погасшей плитке в сетке
  const takenBy = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of picks.enemies) m.set(p.id, "враг");
    for (const p of picks.allies) m.set(p.id, "союзник");
    for (const p of picks.bans) m.set(p.id, "забанен");
    if (ownHero) m.set(ownHero.id, "ты");
    return m;
  }, [picks, ownHero]);
  const poolSet = useMemo(() => new Set([...poolIds, ...override.add].filter((id) => !override.remove.includes(id))), [poolIds, override]);
  const familiarSet = useMemo(() => new Set(familiarIds.filter((id) => !poolSet.has(id) && !override.remove.includes(id))), [familiarIds, poolSet, override]);

  // в сетке первыми герои пула, потом знакомые, остальные по алфавиту: свои всегда под рукой
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rank = (h: Hero) => (poolSet.has(h.id) ? 0 : familiarSet.has(h.id) ? 1 : 2);
    return heroes.filter((h) => (q ? h.name.toLowerCase().includes(q) || h.short.includes(q) : h.attr === attr)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [heroes, query, attr, poolSet, familiarSet]);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    const body = { bans: picks.bans.map((p) => p.id), enemies: picks.enemies, allies: picks.allies, pool: override, role, team: gsi?.connected ? (gsi.team ?? null) : side };
    fetch("/api/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => { setResult(d.candidates ?? []); setRoles({ enemies: d.enemyRoles ?? [], allies: d.allyRoles ?? [] }); setLaneOpp(d.laneOpponent ?? null); setPredicted(d.predicted ?? []); setStage(d.stage ?? "early"); setNeeds(d.needs ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [picks, override, role, acct?.current.id, gsi?.team, side]); // eslint-disable-line react-hooks/exhaustive-deps

  const addMany = (z: UserZone, ids: number[]) => {
    const max = ZONES.find((x) => x.key === z)!.max - (z === "allies" && ownHero ? 1 : 0); // место для себя
    const next = [...picks[z]];
    for (const id of ids) {
      if (taken.has(id) || next.some((p) => p.id === id)) continue;
      if (next.length >= max) break;
      next.push({ id, role: null });
    }
    setPicks({ ...picks, [z]: next });
  };
  const add = (id: number) => { addMany(zone, [id]); setQuery(""); };
  const remove = (z: UserZone, id: number) => setPicks({ ...picks, [z]: picks[z].filter((x) => x.id !== id) });
  const setPickRole = (z: UserZone, id: number, r: Role | null) => setPicks({ ...picks, [z]: picks[z].map((x) => (x.id === id ? { ...x, role: r } : x)) });
  const reset = () => { setPicks({ bans: [], enemies: [], allies: [] }); setUnknown({ enemies: [], allies: [] }); };

  const submitQuick = (z: UserZone) => {
    const { ids, unknown: unk } = parseHeroText(quick[z], heroes, aliases);
    addMany(z, ids);
    setUnknown({ ...unknown, [z]: unk });
    setQuick({ ...quick, [z]: "" });
  };

  const picksRef = useRef(picks);
  useEffect(() => { picksRef.current = picks; }, [picks]);
  const lastMatch = useRef<string | null>(null);

  useEffect(() => {
    if (!auto) return;
    let stop = false;
    const tick = async () => {
      const r = await fetch("/api/gsi/state").then((x) => x.json()).catch(() => null);
      if (stop) return;
      if (r) {
        const d = r.draft;
        setGsi({ connected: r.connected, phase: d?.phase ?? "", ownHeroId: d?.ownHeroId ?? null, matchId: d?.matchId ?? null, team: d?.team ?? null, accountId: r.account?.id ?? null });
        // Экран читаем только на стадии пиков и планирования, о которых сообщает Дота; в меню и в игре захвата нет.
        // Без связи с Дотой (GSI не приходит) читаем всегда, но реже.
        const CAPTURE_PHASES = ["DOTA_GAMERULES_STATE_HERO_SELECTION", "DOTA_GAMERULES_STATE_STRATEGY_TIME"];
        const inSelection = !r.connected || CAPTURE_PHASES.includes(d?.phase ?? "");
        if (captureOn && r.connected && !inSelection) setScreen({ status: "жду стадию пиков", found: 0 });
        if (captureOn && inSelection && window.desktop?.recognizeDraft) {
          const ctxTeam: "radiant" | "dire" = (r.connected && d?.team) ? d.team : side;
          // таймаут: если захват экрана завис, цикл не должен остановиться навсегда
          const ctx = { matchId: r.connected ? (d?.matchId ?? null) : null, team: ctxTeam, slot: r.connected && d?.team ? (d.teamSlot ?? null) : null, phase: r.connected ? (d?.phase ?? null) : null };
          const res = await Promise.race([
            window.desktop.recognizeDraft(ctx).catch(() => null),
            new Promise<RecognizeResult | null>((resolve) => setTimeout(() => resolve({ ok: false, error: "захват экрана не отвечает, пробую снова" }), 15000)),
          ]);
          if (!stop && res) {
            if (!res.ok) setScreen({ status: res.idle ? "Дота не запущена, экран не читаю" : (res.error ?? "ошибка захвата"), found: 0 });
            else if (!res.onPickScreen) setScreen({ status: "экран пиков не виден", found: 0 });
            else {
              const slots = res.slots ?? [];
              const mine: "radiant" | "dire" = (r.connected && d?.team) ? d.team : side;
              const mySlot: number | null = r.connected && d?.team ? (d.teamSlot ?? null) : null;
              // авто-бан (конфликт пиков) только на стадии пиков или без связи с Дотой; на стратегии пики закрыты
              const picking = !r.connected || d?.phase === "DOTA_GAMERULES_STATE_HERO_SELECTION";
              const t = trackFrame(track.current, slots, mine, mySlot, picking);
              const { enemiesSeen, alliesSeen, ownSeen } = t;
              setScreen({ status: `экран: ${res.source ?? ""} ${res.w}×${res.h}, ${res.ms} мс`, found: t.stable.length });
              setPicks((prev) => {
                // авто-бан: герой пропал из слота или виден сразу у обеих команд (конфликт пиков);
                // снимается сам, если герой снова стабильно виден в слоте
                const autoBan = new Set([...t.gone, ...t.conflict]);
                const seenNow = new Set([...enemiesSeen, ...alliesSeen, ...(ownSeen ? [ownSeen] : [])]);
                const bans = prev.bans.filter((p) => !(p.auto && seenNow.has(p.id)));
                for (const id of autoBan) if (!bans.some((p) => p.id === id)) bans.push({ id, role: null, auto: true });
                const banned = new Set(bans.map((p) => p.id));
                const slotOf = new Map(t.stable.map((s) => [s.heroId as number, s.idx]));
                const merge = (cur: Pick[], seen: number[]) => {
                  const out = cur.filter((p) => !banned.has(p.id) && (seen.includes(p.id) || !slots.some((sl) => sl.heroId === p.id))).map((p) => (p.slot === undefined && slotOf.has(p.id) ? { ...p, slot: slotOf.get(p.id) } : p));
                  for (const id of seen) if (!banned.has(id) && !out.some((p) => p.id === id)) out.push({ id, role: null, slot: slotOf.get(id) });
                  return out.slice(0, 5);
                };
                const enemies = merge(prev.enemies, enemiesSeen);
                const allies = merge(prev.allies, alliesSeen).filter((p) => p.id !== ownSeen);
                const same = (a: Pick[], b: Pick[]) => JSON.stringify(a) === JSON.stringify(b);
                if (same(enemies, prev.enemies) && same(allies, prev.allies) && same(bans, prev.bans)) return prev;
                return { bans, enemies, allies };
              });
            }
          }
        }
        if (r.connected && d) {
          // новый матч начал стадию пиков: очищаем прошлый драфт
          if (d.phase === "DOTA_GAMERULES_STATE_HERO_SELECTION" && d.matchId && lastMatch.current !== d.matchId) {
            lastMatch.current = d.matchId;
            lastKey.current = "";
            track.current = newTrackState();
            setPicks({ bans: [], enemies: [], allies: [] });
          }
          // Дота отдаёт состав драфта только зрителям; если вдруг он есть, подхватываем
          if (d.phase === "DOTA_GAMERULES_STATE_HERO_SELECTION" && d.enemies.length > 0) {
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
          // герой выбран (strategy time и дальше): записываем драфт с врагами, которых ты ввёл, один раз на матч
          const cur = picksRef.current;
          if (d.ownHeroId && d.matchId && d.phase !== "DOTA_GAMERULES_STATE_HERO_SELECTION" && loggedMatch.current !== d.matchId && cur.enemies.length > 0) {
            loggedMatch.current = d.matchId;
            window.desktop?.markMatch?.(String(d.matchId)).catch(() => {});
            const body = { bans: cur.bans.map((p) => p.id), enemies: cur.enemies, allies: cur.allies, pool: override, role, chosenHeroId: d.ownHeroId, gsiMatchId: d.matchId };
            fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).then((j) => { if (j?.ok) { setSaved(`${byId.get(d.ownHeroId)?.name ?? ""} (матч ${d.matchId})`); setTimeout(() => setSaved(null), 8000); } }).catch(() => {});
          }
        }
      }
      // на стадии пиков опрашиваем экран раз в полсекунды: решение нужно за 30 секунд
      const picking = r?.connected && r.draft?.phase === "DOTA_GAMERULES_STATE_HERO_SELECTION";
      if (!stop) setTimeout(tick, picking ? 500 : r?.connected ? 1500 : 3000);
    };
    tick();
    return () => { stop = true; };
  }, [auto, override, byId, role, captureOn, side]);

  const togglePool = (id: number) => {
    const inPool = poolSet.has(id);
    const base = poolIds.includes(id);
    const add = override.add.filter((x) => x !== id);
    const rem = override.remove.filter((x) => x !== id);
    if (inPool) { if (base) rem.push(id); } else { if (!base) add.push(id); }
    saveOverride({ add, remove: rem });
  };

  // «из пула» только пул; «знакомые» (3–9 игр) идут во второй список с пометкой, их счёт на оценку не влияет
  const inPool = result.filter((c) => c.poolStatus === "pool");
  const outside = result.filter((c) => c.poolStatus !== "pool").slice(0, showAll ? 40 : 8);
  // порядок в окне пула: сначала по числу игр на роли за год, потом по алфавиту. От галочек порядок не зависит,
  // поэтому список не скачет при клике, а свои герои всегда наверху
  const poolList = useMemo(() => {
    const q = poolQuery.trim().toLowerCase();
    const rec = acct?.recordByRole?.[role] ?? {};
    const g = (h: Hero) => rec[h.id]?.games ?? 0;
    return heroes.filter((h) => !q || h.name.toLowerCase().includes(q)).sort((a, b) => g(b) - g(a) || a.name.localeCompare(b.name));
  }, [heroes, poolQuery, acct, role]);

  return (
    <main className="mx-auto w-full max-w-[1480px] px-4 py-5 flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="text-xl font-semibold">Пикер</h1>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">Моя роль</span>
            <div className="flex rounded-lg border border-border overflow-hidden text-xs" title="От роли зависят пул, базовые винрейты и вес матчапов по линии">
              {ROLES.map((r) => (
                <button key={r} onClick={() => setRole(r)} title={ROLE_NAME[r]} className={`px-3 py-1.5 ${role === r ? "bg-accent/25 text-accent font-semibold" : "text-muted hover:text-foreground hover:bg-panel-2"}`}>{ROLE_FULL[r]}</button>
              ))}
            </div>
          </div>
          <Button size="sm" onClick={() => setPoolOpen(true)} title={acct?.current.id ? `Аккаунт ${acct.current.name ?? acct.current.id}${acct.current.source === "gsi" ? " (сообщила Дота)" : acct.current.source === "steam" ? " (под ним запущен Steam)" : " (по умолчанию из настроек)"}${acct.current.known ? "" : ": пул не загружен, общий режим"}. Нажми, чтобы править пул.` : "Аккаунт не известен: общий режим без пула"}>
            Мой пул · {poolSet.size}{acct?.current.id ? <span className="text-muted"> · {acct.current.name ?? acct.current.id}</span> : null}
          </Button>
          <Button size="sm" variant="link" onClick={reset} title="Очистить врагов и союзников">Сбросить драфт</Button>
        </div>
        <div className="flex flex-wrap gap-3 text-sm items-center">
          {saved && <Chip tone="good">записал: {saved}</Chip>}
          <Status ok={!!gsi?.connected} label={gsi?.connected ? (gsi.phase === "DOTA_GAMERULES_STATE_HERO_SELECTION" ? "Дота: стадия пиков" : gsi.phase === "DOTA_GAMERULES_STATE_STRATEGY_TIME" ? "Дота: стратегия" : gsi.phase && gsi.phase !== "" ? "Дота: в игре" : "Дота: в меню") : "Дота не на связи"}
            title={gsi?.connected ? `${gsi.ownHeroId ? `Твой герой: ${byId.get(gsi.ownHeroId)?.name}. ` : ""}Когда ты выберешь героя, драфт запишется в историю сам.${captureOn && screen ? ` Экран: ${screen.status}, распознано слотов: ${screen.found}.` : ""}` : "Запусти Доту с установленным конфигом (Настройки → Связь с Дотой). Пока связи нет, врагов можно вводить вручную."} />
          {!gsi?.connected && captureOn && (
            <div className="flex rounded-lg border border-border overflow-hidden text-xs" title="Дота не на связи, поэтому укажи, за какую сторону играешь: от этого зависит, кто в распознанном драфте враги">
              <button onClick={() => setSide("radiant")} className={`px-2.5 py-1.5 ${side === "radiant" ? "bg-good/20 text-good" : "text-muted hover:text-foreground"}`}>я за Свет</button>
              <button onClick={() => setSide("dire")} className={`px-2.5 py-1.5 ${side === "dire" ? "bg-bad/20 text-bad" : "text-muted hover:text-foreground"}`}>я за Тьму</button>
            </div>
          )}
        </div>
      </header>

      {acct?.current.id && !acct.current.known && (
        <Card tone="accent" className="py-3 text-sm flex flex-wrap items-center gap-3">
          <span><span className="font-semibold">Общий режим.</span> Аккаунт {acct.current.name ?? acct.current.id}{acct.current.source === "gsi" ? " (его сообщила Дота)" : acct.current.source === "steam" ? " (под ним запущен Steam)" : ""} ещё не знаком: советы по мете и контрпикам, но без твоего пула.</span>
          <Button size="sm" variant="primary" onClick={() => loadHistory(acct.current.id!)} disabled={!!loadMsg && !loadMsg.startsWith("ошибка")}>Загрузить историю аккаунта</Button>
          {loadMsg && (loadMsg.startsWith("ошибка") || loadMsg === "готово" ? <span className="text-xs text-muted">{loadMsg}</span> : <Crystals size={12} label={loadMsg} />)}
        </Card>
      )}

      {gsiRewritten && <section className="rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-sm">Конфиг GSI в Доте указывал на старый порт, я переписал его. Перезапусти Доту, чтобы точка «Дота» загорелась.</section>}

      <DraftBar byId={byId} allies={picks.allies} enemies={picks.enemies} ownHeroId={gsi?.ownHeroId ?? null} team={gsi?.connected ? (gsi.team ?? null) : side} role={role} guesses={roles} />

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-[1fr_1.1fr]">
        {ZONES.map((z) => (
          <div key={z.key} onClick={() => setZone(z.key)}
            className={`rounded-2xl border-2 bg-panel p-3 cursor-pointer transition ${zone === z.key ? z.color : "border-border hover:border-border/80"}`}
            title={zone === z.key ? "Сюда попадают герои из сетки и текстового ввода" : "Нажми, чтобы добавлять героев сюда"}>
            <div className="flex items-center justify-between mb-2">
              <span className={`text-sm font-semibold ${z.color.split(" ")[1]}`}>{z.label} <span className="text-muted font-normal">{picks[z.key].length + (z.key === "allies" && ownHero ? 1 : 0)}/{z.max}</span></span>
              {zone === z.key && <Chip tone="accent">добавляю сюда</Chip>}
            </div>
            <div className="flex flex-wrap gap-2 min-h-10 mb-2">
              {z.key === "allies" && ownHero && (
                <div onClick={(e) => e.stopPropagation()} title={`Твой герой, его сообщила Дота. Роль ${ROLE_NAME[role]}`} className="flex h-8 items-center gap-1.5 rounded-lg bg-panel-2 text-xs pl-1 pr-2 ring-1 ring-accent">
                  <img src={icon(ownHero.short)} alt="" className="h-6 w-6 rounded" />{ownHero.name}<Chip tone="accent">ты · {ROLE_LABEL[role]}</Chip>
                </div>
              )}
              {picks[z.key].map((p) => {
                const h = byId.get(p.id)!;
                const guess = roles[z.key].find((g) => g.id === p.id);
                return (
                  <div key={p.id} onClick={(e) => e.stopPropagation()} className={`flex h-8 items-center rounded-lg bg-panel-2 text-xs ${p.auto ? "outline outline-1 outline-dashed outline-ban/70" : ""}`}>
                    <button onClick={() => remove(z.key, p.id)} title={p.auto ? "Пропал из слота: его выбрали обе команды, и он забанен. Нажми, чтобы убрать, если это не так" : "Убрать"} className="flex h-8 items-center gap-1.5 rounded-l-lg pl-1 pr-2 hover:bg-border">
                      <img src={icon(h.short)} alt="" className="h-6 w-6 rounded" />{h.name}{p.auto && <span className="text-[10px] text-ban/80 ml-0.5">конфликт</span>}
                    </button>
                    {(
                      <span className="relative h-8 border-l border-border rounded-r-lg bg-panel flex items-center" title={p.role ? `Роль задана тобой: ${ROLE_NAME[p.role]}` : guess ? `Предполагаю: ${ROLE_NAME[guess.role]} (${Math.round(guess.prob * 100)}%). Нажми, чтобы задать` : "Роль не известна: 1 керри, 2 мид, 3 офлейн, 4 и 5 саппорты. Нажми, чтобы задать"}>
                        <select value={p.role ?? ""} onChange={(e) => setPickRole(z.key, p.id, e.target.value ? (Number(e.target.value) as Role) : null)}
                          className={`appearance-none h-8 w-11 bg-transparent pl-2 pr-4 outline-none cursor-pointer font-semibold ${p.role ? "text-foreground" : "text-muted"}`}>
                          <option value="">{guess ? `${ROLE_LABEL[guess.role]}?` : "?"}</option>
                          {ROLES.filter((r) => !(z.key === "allies" && r === role)).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                        <svg className="pointer-events-none absolute right-1.5 h-3 w-3 text-muted" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 4.5l3 3 3-3" /></svg>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <input value={quick[z.key]} onChange={(e) => setQuick({ ...quick, [z.key]: e.target.value })} onClick={(e) => { e.stopPropagation(); setZone(z.key); }}
              onKeyDown={(e) => { if (e.key === "Enter") submitQuick(z.key); }} placeholder={`или напиши, например: ${z.hint}`}
              className="w-full rounded-md border border-border bg-panel-2 px-2 py-1 text-xs outline-none focus:border-accent placeholder:text-muted/60" />
            {unknown[z.key].length > 0 && <div className="mt-1 text-xs text-bad">не узнал: {unknown[z.key].join(", ")}</div>}
          </div>
        ))}
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <Card className="p-3 flex flex-col gap-3 min-w-0">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Найти героя… Enter добавит в зону «${ZONES.find((z) => z.key === zone)!.label}»`}
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
          {/* auto-rows-max обязателен: у плитки overflow-hidden, её минимальная высота 0, и Chromium при max-h ужимал все ряды
              поровну под высоту сетки вместо прокрутки (в окне 785px плитки были 47px вместо 74) */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] auto-rows-max gap-2 max-h-[62vh] overflow-y-auto pr-1">
            {filtered.map((h) => {
              const by = takenBy.get(h.id);
              const inPool = poolSet.has(h.id);
              const ring = inPool ? "ring-2 ring-accent" : familiarSet.has(h.id) ? "ring-1 ring-accent/50" : "";
              return (
                <div key={h.id} role="button" tabIndex={by ? -1 : 0} aria-disabled={!!by} onClick={() => { if (!by) add(h.id); }} onKeyDown={(e) => { if (!by && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); add(h.id); } }}
                  title={by ? `${h.name}: ${by}` : `${h.name}: добавить в зону «${ZONES.find((z) => z.key === zone)!.label}»`}
                  className={`group relative w-full overflow-hidden rounded-lg ${ring} ${by ? "cursor-not-allowed" : "cursor-pointer hover:-translate-y-0.5 transition"}`}>
                  {/* плитка не <button>: Chromium раскладывает содержимое кнопок по-своему. Высоту задаёт отступ 56.25% (16:9), а не aspect-ratio:
                      сетка ограничена по высоте с прокруткой, и картинку с aspect-ratio Chromium в окне приложения ужимал, чтобы вместить ряды */}
                  <span className="block w-full pt-[56.25%]" />
                  <img src={portrait(h.short)} alt={h.name} loading="lazy" className={`absolute inset-0 h-full w-full object-cover ${by ? "opacity-25 grayscale" : ""}`} />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-1.5 pb-1 pt-4 text-left text-xs leading-tight text-white/90 truncate">{h.name}</span>
                  {by && <span className={`absolute inset-0 flex items-center justify-center text-xs font-semibold ${by === "враг" ? "text-enemy" : by === "забанен" ? "text-ban" : "text-ally"}`}>{by}</span>}
                  {inPool && !by && <span className="absolute left-1.5 top-1.5 h-2 w-2 rounded-full bg-accent shadow" title="В твоём пуле" />}
                </div>
              );
            })}
            {filtered.length === 0 && <span className="text-sm text-muted col-span-full">Никого не нашёл</span>}
          </div>
          <p className="text-xs text-muted flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded-sm ring-2 ring-accent" />твой пул на этой роли, они первые</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded-sm ring-1 ring-accent/50" />знакомые герои</span>
            <span>клик кладёт героя в выбранную зону, погасшие уже в драфте</span>
          </p>
        </Card>

        {/* на узком окне (второй монитор) советы выше сетки героев: до них не нужно крутить */}
        <section className="flex flex-col gap-4 min-w-0 order-first lg:order-none">
          {(picks.enemies.length > 0 || picks.allies.length > 0) && (
            <Card className="py-2.5 text-xs flex flex-wrap items-center gap-x-5 gap-y-2">
              <span className="inline-flex items-center gap-1.5" title={`Очередь пика по числу известных пиков врага. ${stage === "early" ? "Рано: враги ещё ответят контрпиком, пикер придерживает героев, которых легко законтрить." : stage === "mid" ? "Середина: риск контрпика учитывается наполовину." : "Поздно: контрпикуем мы, матчапы в полный вес."}`}>
                <span className="text-muted">Очередь</span>
                <Chip tone={stage === "late" ? "good" : stage === "mid" ? "accent" : "muted"}>{stage === "early" ? "ранняя" : stage === "mid" ? "середина" : "поздняя"}</Chip>
              </span>
              {picks.allies.length > 0 && (
                <span className="inline-flex items-center gap-1.5 flex-wrap" title="По тегам героев союзников без тебя. Герои, закрывающие нехватку, получают небольшой плюс к оценке.">
                  <span className="text-muted">Команде не хватает</span>
                  {needs.length === 0 ? <Chip tone="good">всё на месте</Chip> : needs.map((n) => <Chip key={n.key} tone="bad">{n.label}</Chip>)}
                </span>
              )}
              {picks.enemies.length < 5 && predicted.length > 0 && (
                <span className="inline-flex items-center gap-1.5 flex-wrap" title="Самые вероятные герои врага на ещё не занятые роли: по любимым героям игрока, если он известен, иначе по популярности роли. Пока соперник по твоей линии не выбран, матчапы против вероятных считаются с небольшим весом.">
                  <span className="text-muted">Враги ещё возьмут</span>
                  {predicted.map((p) => <Chip key={p.role} tone="enemy" title={`Роль ${ROLE_NAME[p.role]}${p.player ? `, игрок ${p.player}` : ""}: ${p.heroes.map((h) => `${h.name} ${Math.round(h.share * 100)}%`).join(", ")}`}>{ROLE_LABEL[p.role]} · {p.heroes.slice(0, 2).map((h) => h.name).join(", ")}</Chip>)}
                </span>
              )}
            </Card>
          )}
          {laneOpp && <LaneCard lane={laneOpp} inPool={inPool} byId={byId} />}
          <ResultBlock title={`Из твоего пула · ${ROLE_FULL[role]}`} hint="Герои, на которых ты играешь на этой роли (пул правится кнопкой «Мой пул»). Отсортированы по шансу победы в этом драфте." items={inPool} loading={loading} byId={byId} onTake={take} lane={laneOpp} featured canTake={!gsi?.connected} />
          <ResultBlock title="Вне пула, но хороши в этот драфт" hint="Герои не из твоего пула на этой роли: оценка только по мете и драфту, твой счёт на них показывается, но не учитывается. «Знакомый» значит 3–9 игр за год." items={outside} loading={loading} byId={byId} onTake={take} canTake={!gsi?.connected}
            footer={<button onClick={() => setShowAll(!showAll)} className="text-xs text-muted underline">{showAll ? "Показать меньше" : "Показать больше"}</button>} />
        </section>
      </div>

      {poolOpen && (() => {
        const rec = acct?.recordByRole?.[role] ?? {};
        return (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setPoolOpen(false)}>
          <Card className="w-full max-w-3xl flex flex-col gap-3" tone="default">
            <div onClick={(e) => e.stopPropagation()} className="flex flex-col gap-3">
              <CardTitle right={<Button size="sm" onClick={() => setPoolOpen(false)}>Закрыть</Button>} hint="Пул отдельный для каждой роли. Сам по себе в нём герои с 10 и больше играми на этой роли за год; «знакомые» с 3–9 играми идут отдельно. Отметь тех, на ком реально играешь: они попадут в список «Из твоего пула», их наигранность и винрейт учитываются в оценке. Правки хранятся в этом браузере.">
                Мой пул · {ROLE_FULL[role]} · {poolSet.size} {poolSet.size % 10 === 1 && poolSet.size % 100 !== 11 ? "герой" : poolSet.size % 10 >= 2 && poolSet.size % 10 <= 4 && (poolSet.size % 100 < 10 || poolSet.size % 100 >= 20) ? "героя" : "героев"}
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <input value={poolQuery} onChange={(e) => setPoolQuery(e.target.value)} placeholder="Найти героя…" autoFocus className="flex-1 min-w-48 rounded-lg border border-border bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent placeholder:text-muted/60" />
                <span className="text-xs text-muted flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded-sm ring-2 ring-accent" />в пуле</span>
                  <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded-sm ring-1 ring-accent/50" />знакомый</span>
                  <span>клик добавляет или убирает</span>
                </span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] auto-rows-max gap-2 max-h-[62vh] overflow-y-auto pr-1">
                {poolList.map((h) => {
                  const on = poolSet.has(h.id);
                  const fam = !on && familiarSet.has(h.id);
                  const r = rec[h.id];
                  const wr = r && r.games > 0 ? Math.round((r.wins / r.games) * 100) : null;
                  return (
                    <div key={h.id} role="checkbox" aria-checked={on} tabIndex={0} onClick={() => togglePool(h.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); togglePool(h.id); } }}
                      className={`relative overflow-hidden rounded-lg cursor-pointer transition hover:-translate-y-0.5 ${on ? "ring-2 ring-accent" : fam ? "ring-1 ring-accent/50" : "ring-1 ring-border/60"}`}>
                      <span className="block w-full pt-[56.25%]" />
                      <img src={portrait(h.short)} alt={h.name} loading="lazy" className={`absolute inset-0 h-full w-full object-cover ${on || fam ? "" : "opacity-60 grayscale-[.4]"}`} />
                      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-1.5 pb-1 pt-5 text-left leading-tight">
                        <span className="block truncate text-xs text-white/90">{h.name}</span>
                        <span className={`block text-[11px] ${r ? (wr !== null && wr >= 50 ? "text-good" : "text-bad") : "text-white/50"}`}>{r ? `${r.wins}–${r.games - r.wins} · ${wr}% · ${r.games} ${r.games % 10 === 1 && r.games % 100 !== 11 ? "игра" : r.games % 10 >= 2 && r.games % 10 <= 4 && (r.games % 100 < 10 || r.games % 100 >= 20) ? "игры" : "игр"}` : "игр на роли нет"}</span>
                      </span>
                      {on && <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-black">✓</span>}
                    </div>
                  );
                })}
                {poolList.length === 0 && <span className="text-sm text-muted col-span-full">Никого не нашёл</span>}
              </div>
              {(override.add.length > 0 || override.remove.length > 0) && (
                <Button size="sm" variant="link" onClick={() => saveOverride(EMPTY)} className="self-start">Сбросить правки к автоматическому пулу</Button>
              )}
            </div>
          </Card>
        </div>
        );
      })()}
    </main>
  );
}

/** Карточка соперника по линии: кто против тебя и кто из твоего пула лучше всего против него. */
function LaneCard({ lane, inPool, byId }: { lane: LaneOpponent; inPool: Candidate[]; byId: Map<number, Hero> }) {
  const h = byId.get(lane.heroId);
  const best = [...inPool].filter((c) => c.vsLane).sort((a, b) => (b.vsLane!.value) - (a.vsLane!.value)).slice(0, 4);
  return (
    <div className="rounded-xl border border-enemy/40 bg-panel p-3 flex flex-wrap items-center gap-3">
      {h && <img src={portrait(h.short)} alt="" className="h-12 w-[86px] rounded-md object-cover shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="text-sm"><span className="text-muted">Соперник по линии:</span> <b>{lane.name}</b> <span className="text-xs text-muted">· {ROLE_NAME[lane.role]}{lane.prob < 0.9 ? ` ${Math.round(lane.prob * 100)}%` : ""}</span>
          {lane.player && <span className="text-xs text-muted"> · {lane.player.name ?? "игрок"}{lane.player.games > 0 ? <>: на нём <b className="text-foreground">{lane.player.wins}–{lane.player.games - lane.player.wins}</b> за месяц</> : lane.player.rolesKnown ? ": на нём за месяц не играл" : ": профиль закрыт"}</span>}
        </div>
        <div className="text-xs text-muted mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
          {best.length === 0 && <span>в пуле пока нет оценённых против него героев</span>}
          {best.map((c) => <span key={c.heroId}><span className="text-foreground">{c.name}</span> <span className={c.vsLane!.value > 0 ? "text-good" : c.vsLane!.value < 0 ? "text-bad" : ""}>{c.vsLane!.value > 0 ? "+" : ""}{c.vsLane!.value}</span>{c.vsLane!.personal ? <span className="text-accent"> · ты {c.vsLane!.personal.wins}–{c.vsLane!.personal.games - c.vsLane!.personal.wins}</span> : null}</span>)}
        </div>
      </div>
    </div>
  );
}

function ResultBlock({ title, hint, items, loading, byId, footer, onTake, lane, featured, canTake }: { title: string; hint?: string; items: Candidate[]; loading: boolean; byId: Map<number, Hero>; footer?: React.ReactNode; onTake: (id: number) => void; lane?: LaneOpponent | null; featured?: boolean; canTake: boolean }) {
  return (
    <Card className="p-3">
      <CardTitle hint={hint} right={loading ? <Crystals size={11} label="считаю" /> : <span className="text-xs text-muted" title="Оценка шанса победы с героем в этом драфте: винрейт на роли, контрпики, синергии, наигранность и твой винрейт. Нажми на строку, чтобы увидеть, из чего она сложилась.">шанс победы</span>}>{title}</CardTitle>
      <div className="flex flex-col gap-2">
        {items.map((c, i) => <Row key={c.heroId} c={c} byId={byId} onTake={canTake ? onTake : undefined} lane={lane} featured={featured && i === 0} />)}
        {items.length === 0 && !loading && <span className="text-sm text-muted">Пока нечего посоветовать: добавь врагов или загрузи историю аккаунта.</span>}
      </div>
      {footer && <div className="mt-2">{footer}</div>}
    </Card>
  );
}

const signed = (v: number, digits = 0) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}`;
const signTone = (v: number) => (v >= 0.5 ? "text-good" : v <= -0.5 ? "text-bad" : "text-muted");

/** Строка «из чего сложилась оценка» в раскрытой карточке героя. */
function Part({ label, value, note, digits = 1 }: { label: string; value: number; note?: string; digits?: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span>{label}{note && <span className="opacity-60"> · {note}</span>}</span>
      <b className={`tabular-nums ${signTone(value)}`}>{signed(value, digits)}</b>
    </div>
  );
}

/** Одна фраза «почему» для крупной карточки. Чипы уже показывают матчап по линии и твой счёт, поэтому здесь остальное:
 *  другие матчапы, винрейт на роли, нехватка команды. */
function why(c: Candidate, lane?: LaneOpponent | null): string {
  const parts: string[] = [];
  const rest = c.reasons.filter((r) => !(lane && c.vsLane && r.kind === "vs" && r.heroId === lane.heroId)).slice(0, 2);
  if (rest.length) parts.push(rest.map((r) => `${signed(r.value)} ${r.kind === "vs" ? "против" : "с"} ${r.name}`).join(", "));
  parts.push(`${c.base}% винрейт на роли у Immortal`);
  if (c.needsAdj > 0) parts.push("закрывает нехватку команды");
  if (c.poolStatus === "pool" && c.midGames > 0) parts.push(`${c.midGames} игр за год`);
  return parts.join(" · ");
}

function Row({ c, byId, onTake, lane, featured }: { c: Candidate; byId: Map<number, Hero>; onTake?: (id: number) => void; lane?: LaneOpponent | null; featured?: boolean }) {
  const [open, setOpen] = useState(false);
  const h = byId.get(c.heroId)!;
  const score = Math.round(c.finalScore);
  const tone = score >= 55 ? "text-good" : score <= 45 ? "text-bad" : "text-foreground";
  const bar = score >= 55 ? "bg-good" : score <= 45 ? "bg-bad" : "bg-accent";
  const laneName = lane ? lane.name.split(" ")[0] : "";
  // в строке не больше двух чипов: статус пула и самое важное из (матчап по линии, твой счёт, популярность); остальное в раскрытии
  const chips: React.ReactNode[] = [];
  if (c.poolStatus === "familiar") chips.push(<Chip key="fam" tone="accent" className="opacity-80" title="3–9 игр на этой роли за год; на оценку твой счёт не влияет">знакомый</Chip>);
  if (lane && c.vsLane) chips.push(<Chip key="lane" tone={c.vsLane.value >= 1 ? "good" : c.vsLane.value <= -1 ? "bad" : "muted"} title={`Матчап против соперника по линии, ${lane.name} (${c.vsLane.games} игр в выборке)${c.vsLane.personal ? `. Твой счёт против него ${c.vsLane.personal.wins}–${c.vsLane.personal.games - c.vsLane.personal.wins}` : ""}`}>против {laneName} {signed(c.vsLane.value)}{c.vsLane.personal ? ` · ты ${c.vsLane.personal.wins}–${c.vsLane.personal.games - c.vsLane.personal.wins}` : ""}</Chip>);
  if (c.personalWinrate !== null) chips.push(<Chip key="me" tone={c.poolStatus !== "pool" ? "muted" : c.personalWinrate >= 50 ? "good" : "bad"} title={`Твой счёт на нём на этой роли за год: ${c.midWins} побед, ${c.midGames - c.midWins} поражений${c.poolStatus === "pool" ? ". Учтён в оценке" : ". На оценку не влияет: герой не в пуле"}`}>ты {c.midWins}–{c.midGames - c.midWins} · {c.personalWinrate}%</Chip>);
  if (c.top) chips.push(<Chip key="top" title={`Популярность у Immortal на этой роли за 4 недели: ${c.top.rate}% всех пиков роли (${c.top.games} игр), винрейт ${c.top.winrate}%`}>берут {c.top.rate}%</Chip>);
  const shown = chips.slice(0, 2);
  const top = c.reasons.slice(0, 3);
  return (
    <div className={`rounded-xl cursor-pointer transition animate-rise ${featured ? "bg-panel-2 p-3 ring-1 ring-accent/40" : "bg-panel-2 p-2.5"} ${open ? "ring-1 ring-border" : featured ? "" : "hover:bg-panel-2/70"}`} onClick={() => setOpen(!open)} title={open ? "" : "Нажми, чтобы увидеть, из чего сложилась оценка"}>
      {featured ? (
        <div className="flex items-center gap-4">
          <img src={portrait(h.short)} alt="" className="h-[76px] w-[136px] rounded-lg object-cover shrink-0" />
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-accent leading-none" title="Лучший вариант в этом драфте по оценке пикера">лучший выбор</div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg font-semibold leading-6">{c.name}</span>
              {shown}
            </div>
            <div className="text-sm text-muted">{why(c, lane)}</div>
            <div className="h-1.5 w-full overflow-hidden rounded bg-panel"><div className={`h-full ${bar}`} style={{ width: `${Math.max(4, Math.min(100, (c.finalScore - 30) * 2.5))}%` }} /></div>
          </div>
          <div className="text-right shrink-0">
            <div className={`text-4xl font-semibold tabular-nums leading-none ${tone}`} title="Шанс победы с этим героем в этом драфте">{score}%</div>
            {onTake && <Button size="sm" variant="primary" onClick={() => onTake(c.heroId)} title="Записать в историю, что ты взял этого героя. Когда Дота на связи, это происходит само." className="mt-2">Беру</Button>}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <img src={portrait(h.short)} alt="" className="h-12 w-[86px] rounded-lg object-cover shrink-0" />
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-medium leading-5">{c.name}</span>{shown}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap text-xs leading-4">
              {top.length === 0 && <span className="text-muted" title="Пока в драфте никого нет, герои идут по винрейту на этой роли у Immortal (5420+ MMR) за последние 4 недели с поправкой на наигранность и твой винрейт. Матчапы появятся, когда добавишь врагов или союзников.">{c.base}% винрейт на роли · врагов пока нет</span>}
              {top.map((r) => (
                <span key={`${r.kind}-${r.heroId}`} className={`${signTone(r.value)} whitespace-nowrap`} title={`${r.kind === "vs" ? "Против" : "Вместе с"} ${r.name}: ${signed(r.value, 1)} к винрейту (${r.games} игр в выборке)${r.laneOpp ? ". Твой соперник по линии, вес выше" : ""}`}>
                  {signed(r.value)} <span className="text-muted">{r.kind === "vs" ? "против" : "с"}</span> {r.name}
                </span>
              ))}
            </div>
            <div className="h-1 w-full overflow-hidden rounded bg-panel"><div className={`h-full ${bar}`} style={{ width: `${Math.max(4, Math.min(100, (c.finalScore - 30) * 2.5))}%` }} /></div>
          </div>
          <div className={`text-2xl font-semibold tabular-nums w-14 text-right ${tone}`} title="Шанс победы с этим героем в этом драфте">{score}%</div>
          {onTake && <Button size="sm" onClick={() => onTake(c.heroId)} title="Записать в историю, что ты взял этого героя. Когда Дота на связи, это происходит само." className="shrink-0">Беру</Button>}
        </div>
      )}
      {open && (
        <div className="mt-2 border-t border-border pt-2 text-xs text-muted grid gap-3 sm:grid-cols-2" onClick={(e) => e.stopPropagation()}>
          <div className="grid gap-1 content-start">
            <div className="text-foreground font-medium mb-0.5">Из чего сложилась оценка</div>
            <div className="flex items-baseline justify-between gap-3"><span>Винрейт героя на этой роли у Immortal <span className="opacity-60">· 5420+ MMR, 4 недели</span></span><b className="text-foreground tabular-nums">{c.base}%</b></div>
            <Part label="Контрпики" value={c.vsTotal} />
            <Part label="Синергии" value={c.withTotal} />
            {c.predictedAdj !== 0 && <Part label="Вероятные пики врага на твою линию" note="небольшой вес, пока соперник не выбран" value={c.predictedAdj} />}
            {c.stageAdj !== 0 && <Part label="Очередь пика" note={`риск контрпика ${c.counterRisk}`} value={c.stageAdj} />}
            {c.needsAdj !== 0 && <Part label="Закрывает нехватку команды" value={c.needsAdj} />}
            {c.poolStatus === "pool" ? (
              <>
                <Part label="Наигранность" note={`${c.midGames} игр на роли за год`} value={c.experienceAdj} />
                <Part label="Твой винрейт" note={c.midGames === 0 ? "игр на роли нет" : `${c.midWins}–${c.midGames - c.midWins}, ${c.personalWinrate}%${c.midGames < 3 ? ", меньше 3 игр, не учитывается" : c.personalAdj === 0 ? ", ровно 50%" : ""}`} value={c.personalAdj} />
              </>
            ) : (
              <div className="flex items-baseline justify-between gap-3"><span>Наигранность и твой винрейт<span className="opacity-60"> · {c.midGames > 0 ? `${c.midWins}–${c.midGames - c.midWins}, ` : ""}не в пуле, не учитываются</span></span><b className="text-muted">0</b></div>
            )}
            <div className="flex items-baseline justify-between gap-3 border-t border-border pt-1 mt-0.5 text-foreground"><span>Итого: шанс победы</span><b className={`tabular-nums ${tone}`}>{score}%</b></div>
            <div className="opacity-60 mt-1">Его берут на эту роль в {Math.round(c.midRate * 100)}% игр героя у Immortal{c.top ? `, это ${c.top.rate}% всех пиков роли` : ""}. Матчапы и синергии Stratz даёт только по Divine+Immortal вместе.</div>
          </div>
          <div className="grid gap-1 content-start">
            <div className="text-foreground font-medium mb-0.5">Матчапы в этом драфте</div>
            {c.reasons.length === 0 && <span>известных врагов и союзников пока нет</span>}
            {c.reasons.map((r) => (
              <div key={`${r.kind}-${r.heroId}`} className="flex items-baseline justify-between gap-3">
                <span>{r.kind === "vs" ? "против" : "вместе с"} <span className="text-foreground">{r.name}</span>{r.laneOpp ? <span className="text-enemy"> · по линии</span> : null} <span className="opacity-60">({r.games} игр)</span></span>
                <b className={`tabular-nums ${signTone(r.value)}`}>{signed(r.value, 1)}</b>
              </div>
            ))}
            {c.personalNotes.map((n) => <div key={`${n.ally}-${n.heroId}`} className="text-accent">Ты {n.ally ? "вместе с" : "против"} {n.name}: {n.wins}–{n.games - n.wins}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}


function DraftBar({ byId, allies, enemies, ownHeroId, team, role, guesses }: { byId: Map<number, Hero>; allies: Pick[]; enemies: Pick[]; ownHeroId: number | null; team: "radiant" | "dire" | null; role: Role; guesses: { enemies: RoleGuess[]; allies: RoleGuess[] } }) {
  const oursLeft = team !== "dire"; // Свет слева, как в игре; если команда неизвестна, свои слева
  const ours: (Pick | { id: number; role: Role | null; own: true })[] = [...allies];
  if (ownHeroId && !ours.some((p) => p.id === ownHeroId)) ours.unshift({ id: ownHeroId, role, own: true });
  // пустые слоты подписаны номерами ещё не занятых ролей: заданная вручную роль, иначе предположение пикера
  const freeRoles = (picksList: Pick[], g: RoleGuess[], extra: Role[]): Role[] => {
    const taken = new Set<Role>(extra);
    for (const p of picksList) { const r = p.role ?? g.find((x) => x.id === p.id)?.role; if (r) taken.add(r); }
    return ROLES.filter((r) => !taken.has(r));
  };
  const freeOurs = freeRoles(allies, guesses.allies, ownHeroId ? [role] : []);
  const freeTheirs = freeRoles(enemies, guesses.enemies, []);
  const Slot = ({ p, side, free }: { p?: Pick | { id: number; role: Role | null; own?: true }; side: "ours" | "theirs"; free?: Role }) => {
    const h = p ? byId.get(p.id) : undefined;
    const own = !!(p && "own" in p && p.own);
    const r = p ? (p.role ?? (side === "ours" ? guesses.allies : guesses.enemies).find((x) => x.id === p.id)?.role) : undefined;
    return (
      <div className={`relative h-[54px] w-24 2xl:h-[63px] 2xl:w-28 shrink-0 overflow-hidden rounded-lg border ${own ? "border-accent" : side === "ours" ? "border-ally/40" : "border-enemy/40"} bg-panel-2`}
        title={h ? `${h.name}${r ? ` · ${ROLE_NAME[r]}` : ""}` : free ? `Свободная роль: ${ROLE_NAME[free]}` : "пусто"}>
        {h ? <img src={portrait(h.short)} alt={h.name} className="h-full w-full object-cover" /> : <div className={`flex h-full w-full items-center justify-center text-xl font-semibold ${side === "ours" ? "text-ally/50" : "text-enemy/50"}`}>{free ?? ""}</div>}
        {h && r && !own && <div className={`absolute bottom-0 right-0 rounded-tl px-2 py-0.5 text-xs font-semibold ${side === "ours" ? "bg-ally/80 text-black" : "bg-enemy/80 text-black"}`}>{r}</div>}
        {own && <div className="absolute bottom-0 inset-x-0 bg-accent/80 text-xs text-black text-center font-semibold">ты · {role}</div>}
      </div>
    );
  };
  const left = oursLeft ? ours : enemies, right = oursLeft ? enemies : ours;
  const leftSide = oursLeft ? "ours" : "theirs", rightSide = oursLeft ? "theirs" : "ours";
  const leftFree = oursLeft ? freeOurs : freeTheirs, rightFree = oursLeft ? freeTheirs : freeOurs;
  const pad = (arr: unknown[]) => Array.from({ length: 5 }, (_, i) => arr[i]);
  return (
    <section className="rounded-xl border border-border bg-panel px-3 py-2.5 flex items-center justify-between gap-3 overflow-x-auto">
      <div className="flex items-center gap-1.5">
        <span className={`mr-1 text-sm font-semibold ${leftSide === "ours" ? "text-ally" : "text-enemy"}`}>{team ? "Свет" : "Союзники"}</span>
        {pad(left).map((p, i) => <Slot key={`l${i}`} p={p as Pick | undefined} side={leftSide} free={p ? undefined : leftFree[i - left.length]} />)}
      </div>
      <div className="text-xs text-muted whitespace-nowrap px-1">{team ? (team === "radiant" ? "ты за Свет" : "ты за Тьму") : "команда неизвестна"}</div>
      <div className="flex items-center gap-1.5">
        {pad(right).map((p, i) => <Slot key={`r${i}`} p={p as Pick | undefined} side={rightSide} free={p ? undefined : rightFree[i - right.length]} />)}
        <span className={`ml-1 text-sm font-semibold ${rightSide === "ours" ? "text-ally" : "text-enemy"}`}>{team ? "Тьма" : "Враги"}</span>
      </div>
    </section>
  );
}
