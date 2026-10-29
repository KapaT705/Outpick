"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseHeroText, type AliasMap } from "@/lib/aliases";
import type { Attr, Candidate, DraftStage, Hero, LaneOpponent, Pick, PoolOverride, PredictedPicks, Role, RoleGuess, TeamNeed } from "@/lib/types";
import type { RecognizeResult } from "@/components/AppShell";
import { newTrackState, trackFrame } from "@/lib/draftTrack";
import { Button, Card, CardTitle, Chip, Status } from "@/components/ui";

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
type AccountsState = { current: AccountInfo; accounts: { id: number; name?: string; known: boolean }[]; poolByRole: Record<number, number[]>; familiarByRole: Record<number, number[]> };

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
  const poolSet = useMemo(() => new Set([...poolIds, ...override.add].filter((id) => !override.remove.includes(id))), [poolIds, override]);
  const familiarSet = useMemo(() => new Set(familiarIds.filter((id) => !poolSet.has(id) && !override.remove.includes(id))), [familiarIds, poolSet, override]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return heroes.filter((h) => (q ? h.name.toLowerCase().includes(q) || h.short.includes(q) : h.attr === attr));
  }, [heroes, query, attr]);

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

  const inPool = result.filter((c) => c.poolStatus !== "outside");
  const outside = result.filter((c) => c.poolStatus === "outside").slice(0, showAll ? 40 : 8);
  // порядок в окне пула постоянный (по алфавиту): отмеченные герои не перепрыгивают наверх, иначе список скачет при каждом клике
  const poolList = useMemo(() => {
    const q = poolQuery.trim().toLowerCase();
    return heroes.filter((h) => !q || h.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  }, [heroes, poolQuery]);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-5 flex flex-col gap-5">
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
        </div>
        <div className="flex flex-wrap gap-3 text-sm items-center">
          {saved && <Chip tone="good">записал: {saved}</Chip>}
          <Status ok={!!gsi?.connected} label={gsi?.connected ? (gsi.phase === "DOTA_GAMERULES_STATE_HERO_SELECTION" ? "Дота: стадия пиков" : gsi.phase === "DOTA_GAMERULES_STATE_STRATEGY_TIME" ? "Дота: стратегия" : gsi.phase && gsi.phase !== "" ? "Дота: в игре" : "Дота: в меню") : "Дота не на связи"}
            title={gsi?.connected ? `${gsi.ownHeroId ? `Твой герой: ${byId.get(gsi.ownHeroId)?.name}. ` : ""}Когда ты выберешь героя, драфт запишется в историю сам.${captureOn && screen ? ` Экран: ${screen.status}, распознано слотов: ${screen.found}.` : ""}` : "Запусти Доту с установленным конфигом (Настройки → Связь с Дотой). Пока связи нет, врагов можно вводить вручную."} />
          {!gsi?.connected && captureOn && (
            <div className="flex rounded-md border border-border overflow-hidden text-[11px]" title="Дота не на связи, поэтому укажи, за какую сторону играешь: от этого зависит, кто в распознанном драфте враги">
              <button onClick={() => setSide("radiant")} className={`px-2 py-1 ${side === "radiant" ? "bg-good/20 text-good" : "text-muted"}`}>я за Свет</button>
              <button onClick={() => setSide("dire")} className={`px-2 py-1 ${side === "dire" ? "bg-bad/20 text-bad" : "text-muted"}`}>я за Тьму</button>
            </div>
          )}
          <Button size="sm" onClick={() => setPoolOpen(true)} title={acct?.current.id ? `Аккаунт ${acct.current.name ?? acct.current.id}${acct.current.source === "gsi" ? " (сообщила Дота)" : acct.current.source === "steam" ? " (под ним запущен Steam)" : " (по умолчанию из настроек)"}${acct.current.known ? "" : ": пул не загружен, общий режим"}. Нажми, чтобы править пул.` : "Аккаунт не известен: общий режим без пула"}>
            Мой пул · {poolSet.size}{acct?.current.id ? <span className="text-muted"> · {acct.current.name ?? acct.current.id}</span> : null}
          </Button>
          <Button size="sm" variant="link" onClick={reset} title="Очистить врагов и союзников">Сбросить драфт</Button>
        </div>
      </header>

      {acct?.current.id && !acct.current.known && (
        <Card tone="accent" className="py-3 text-sm flex flex-wrap items-center gap-3">
          <span><span className="font-semibold">Общий режим.</span> Аккаунт {acct.current.name ?? acct.current.id}{acct.current.source === "gsi" ? " (его сообщила Дота)" : acct.current.source === "steam" ? " (под ним запущен Steam)" : ""} ещё не знаком: советы по мете и контрпикам, но без твоего пула.</span>
          <Button size="sm" variant="primary" onClick={() => loadHistory(acct.current.id!)} disabled={!!loadMsg && !loadMsg.startsWith("ошибка")}>Загрузить историю аккаунта</Button>
          {loadMsg && <span className="text-xs text-muted">{loadMsg}</span>}
        </Card>
      )}

      {gsiRewritten && <section className="rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-sm">Конфиг GSI в Доте указывал на старый порт, я переписал его. Перезапусти Доту, чтобы точка «Дота» загорелась.</section>}

      <DraftBar byId={byId} allies={picks.allies} enemies={picks.enemies} ownHeroId={gsi?.ownHeroId ?? null} team={gsi?.connected ? (gsi.team ?? null) : side} role={role} />

      <section className="grid gap-3 md:grid-cols-2">
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
                <div onClick={(e) => e.stopPropagation()} title={`Твой герой, его сообщила Дота. Роль ${ROLE_NAME[role]}`} className="flex items-center gap-1 rounded-md bg-panel-2 text-xs overflow-hidden pr-2 ring-1 ring-accent">
                  <img src={icon(ownHero.short)} alt="" className="h-7 w-7" />{ownHero.name}<Chip tone="accent">ты · {ROLE_LABEL[role]}</Chip>
                </div>
              )}
              {picks[z.key].map((p) => {
                const h = byId.get(p.id)!;
                const guess = roles[z.key].find((g) => g.id === p.id);
                return (
                  <div key={p.id} onClick={(e) => e.stopPropagation()} className={`flex items-center rounded-md bg-panel-2 text-xs overflow-hidden ${p.auto ? "outline outline-1 outline-dashed outline-ban/70" : ""}`}>
                    <button onClick={() => remove(z.key, p.id)} title={p.auto ? "Пропал из слота: его выбрали обе команды, и он забанен. Нажми, чтобы убрать, если это не так" : "Убрать"} className="flex items-center gap-1 pr-2 hover:bg-border">
                      <img src={icon(h.short)} alt="" className="h-7 w-7" />{h.name}{p.auto && <span className="text-[10px] text-ban/80 ml-0.5">конфликт</span>}
                    </button>
                    {(
                      <select value={p.role ?? ""} onChange={(e) => setPickRole(z.key, p.id, e.target.value ? (Number(e.target.value) as Role) : null)}
                        title={p.role ? `Роль задана тобой: ${ROLE_NAME[p.role]}` : guess ? `Предполагаю: ${ROLE_NAME[guess.role]} (${Math.round(guess.prob * 100)}%)` : "Роль (1 керри, 2 мид, 3 офлейн, 4 и 5 саппорты)"}
                        className={`h-7 border-l border-border bg-panel px-1 outline-none cursor-pointer ${p.role ? "text-foreground" : "text-muted italic"}`}>
                        <option value="">{guess ? `${ROLE_LABEL[guess.role]}?` : "роль?"}</option>
                        {ROLES.filter((r) => !(z.key === "allies" && r === role)).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]} · {ROLE_NAME[r]}</option>)}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
            <input value={quick[z.key]} onChange={(e) => setQuick({ ...quick, [z.key]: e.target.value })} onClick={(e) => { e.stopPropagation(); setZone(z.key); }}
              onKeyDown={(e) => { if (e.key === "Enter") submitQuick(z.key); }} placeholder={`или напиши, например: ${z.hint}`}
              className="w-full rounded-md border border-border bg-panel-2 px-2 py-1 text-xs outline-none focus:border-accent placeholder:text-muted/60" />
            {unknown[z.key].length > 0 && <div className="mt-1 text-[11px] text-bad">не узнал: {unknown[z.key].join(", ")}</div>}
          </div>
        ))}
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
        <section className="rounded-xl border border-border bg-panel p-3 flex flex-col gap-3 min-w-0">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти героя и добавить в выбранную зону…"
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
          <p className="text-xs text-muted flex flex-wrap gap-x-3 gap-y-1"><span><span className="inline-block h-2.5 w-4 rounded-sm ring-2 ring-accent align-middle mr-1" />твой пул на этой роли</span><span><span className="inline-block h-2.5 w-4 rounded-sm ring-1 ring-accent/50 align-middle mr-1" />знакомые герои</span><span>роль «?» у героя — предположение, выбери сам, если знаешь</span></p>
        </section>

        <section className="flex flex-col gap-4 min-w-0">
          {(picks.enemies.length > 0 || picks.allies.length > 0) && (
            <Card className="py-3 text-xs text-muted flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2" title="По числу известных пиков врага. Рано: врагам ещё отвечать контрпиком, поэтому героев, которых легко законтрить, пикер придерживает. Поздно: контрпикуем мы.">
                <span className="text-foreground w-36">Очередь пика</span>
                <Chip tone={stage === "late" ? "good" : "muted"}>{stage === "early" ? "ранняя" : stage === "mid" ? "середина" : "поздняя"}</Chip>
                <span>{stage === "early" ? "враги ещё ответят контрпиком, ценю устойчивых героев" : stage === "mid" ? "риск контрпика учитываю наполовину" : "контрпикуем мы, выжимаю матчапы"}</span>
              </div>
              {picks.allies.length > 0 && (
                <div className="flex flex-wrap items-center gap-2" title="По тегам героев союзников (без тебя). Герои, закрывающие нехватку, получают небольшой плюс.">
                  <span className="text-foreground w-36">Команде не хватает</span>
                  {needs.length === 0 ? <Chip tone="good">всё на месте</Chip> : needs.map((n) => <Chip key={n.key} tone="bad">{n.label}</Chip>)}
                </div>
              )}
              {picks.enemies.length < 5 && predicted.length > 0 && (
                <div className="flex flex-wrap items-start gap-2" title="Самые вероятные герои на роли, которые у врагов ещё не заняты: по любимым героям игрока, если он известен, иначе по популярности на роли. Пока соперник по твоей линии не выбран, матчапы против вероятных считаются с небольшим весом.">
                  <span className="text-foreground w-36">Враги ещё возьмут</span>
                  <span className="flex flex-wrap gap-x-3 gap-y-1">{predicted.map((p) => <span key={p.role}><Chip tone="enemy">{ROLE_LABEL[p.role]}</Chip>{p.player ? <span className="text-foreground"> {p.player}:</span> : ""} {p.heroes.map((h) => `${h.name} ${Math.round(h.share * 100)}%`).join(", ")}</span>)}</span>
                </div>
              )}
            </Card>
          )}
          {laneOpp && <LaneCard lane={laneOpp} inPool={inPool} byId={byId} />}
          <ResultBlock title={`Из твоего пула · ${ROLE_FULL[role]}`} items={inPool} loading={loading} byId={byId} onTake={take} lane={laneOpp} />
          <ResultBlock title="Вне пула, но хороши в этот драфт" items={outside} loading={loading} byId={byId} onTake={take}
            footer={<button onClick={() => setShowAll(!showAll)} className="text-xs text-muted underline">{showAll ? "Показать меньше" : "Показать больше"}</button>} />
        </section>
      </div>

      {poolOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setPoolOpen(false)}>
          <div className="w-full max-w-2xl rounded-xl border border-border bg-panel p-4 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Мой пул · {ROLE_FULL[role]} · {poolSet.size} героев</h2>
              <button onClick={() => setPoolOpen(false)} className="text-muted hover:text-foreground">Закрыть</button>
            </div>
            <p className="text-xs text-muted">Пул отдельный для каждой роли. По умолчанию в нём герои с 10+ играми на этой роли за год. Отметь тех, на ком реально играешь: они попадут в список «Из твоего пула». Правки хранятся в этом браузере.</p>
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

function ResultBlock({ title, items, loading, byId, footer, onTake, lane }: { title: string; items: Candidate[]; loading: boolean; byId: Map<number, Hero>; footer?: React.ReactNode; onTake: (id: number) => void; lane?: LaneOpponent | null }) {
  return (
    <Card className="p-3">
      <CardTitle right={loading ? <span className="text-xs text-muted">считаю…</span> : null}>{title}</CardTitle>
      <div className="flex flex-col gap-2">
        {items.map((c) => <Row key={c.heroId} c={c} byId={byId} onTake={onTake} lane={lane} />)}
        {items.length === 0 && !loading && <span className="text-sm text-muted">Пока нечего посоветовать: добавь врагов или загрузи историю аккаунта.</span>}
      </div>
      {footer && <div className="mt-2">{footer}</div>}
    </Card>
  );
}

function Row({ c, byId, onTake, lane }: { c: Candidate; byId: Map<number, Hero>; onTake: (id: number) => void; lane?: LaneOpponent | null }) {
  const [open, setOpen] = useState(false);
  const h = byId.get(c.heroId)!;
  const tone = c.finalScore >= 55 ? "text-good" : c.finalScore <= 45 ? "text-bad" : "text-foreground";
  const tag = c.poolStatus === "pool" ? <Chip tone="accent" title="Ты играешь на нём на этой роли">в пуле</Chip>
    : c.poolStatus === "familiar" ? <Chip tone="accent" title="3–9 игр на этой роли" className="opacity-80">знакомый</Chip>
    : <Chip title="Ты на нём не играл на этой роли">вне пула</Chip>;
  const top = c.reasons.slice(0, 3);
  return (
    <div className="rounded-lg bg-panel-2 p-2 cursor-pointer" onClick={() => setOpen(!open)}>
      <div className="flex items-center gap-3">
        <img src={portrait(h.short)} alt="" className="h-10 w-[72px] rounded-md object-cover shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{c.name}</span>{tag}
            {c.personalWinrate !== null && <span className="text-xs text-muted">ты: {c.midWins}–{c.midGames - c.midWins} ({c.personalWinrate}%)</span>}
            {c.top && <span className="rounded bg-panel px-1.5 py-0.5 text-[11px] text-muted" title={`У Immortal на этой роли за 4 недели: винрейт ${c.top.winrate}%, доля пиков ${c.top.rate}% (${c.top.games} игр)`}>Immortal {c.top.winrate}% · {c.top.rate}%</span>}
            {lane && c.vsLane && <span className={`rounded px-1.5 py-0.5 text-[11px] ${c.vsLane.value >= 1 ? "bg-good/15 text-good" : c.vsLane.value <= -1 ? "bg-bad/15 text-bad" : "bg-panel text-muted"}`} title={`Матчап против соперника по линии (${c.vsLane.games} игр в выборке)${c.vsLane.personal ? `, твой счёт против него ${c.vsLane.personal.wins}–${c.vsLane.personal.games - c.vsLane.personal.wins}` : ""}`}>vs {lane.name.split(" ")[0]} {c.vsLane.value > 0 ? "+" : ""}{c.vsLane.value}{c.vsLane.personal ? ` · ты ${c.vsLane.personal.wins}–${c.vsLane.personal.games - c.vsLane.personal.wins}` : ""}</span>}
          </div>
          <div className="mt-1 h-1 w-full overflow-hidden rounded bg-panel"><div className={`h-full ${c.finalScore >= 55 ? "bg-good" : c.finalScore <= 45 ? "bg-bad" : "bg-accent"}`} style={{ width: `${Math.max(4, Math.min(100, (c.finalScore - 30) * 2.5))}%` }} /></div>
          <div className="text-xs text-muted truncate">
            {top.length === 0 ? `базовый винрейт на роли ${c.base}%` : top.map((r) => `${r.value > 0 ? "+" : ""}${r.value} ${r.kind === "vs" ? "против" : "с"} ${r.name}${r.laneOpp ? " (мид)" : ""}`).join(" · ")}
          </div>
        </div>
        <div className="text-right">
          <div className={`text-xl font-semibold ${tone}`}>{Math.round(c.finalScore)}%</div>
          <div className="text-[11px] text-muted">драфт {Math.round(c.draftScore)}%</div>
        </div>
        <button onClick={(e) => { e.stopPropagation(); onTake(c.heroId); }} title="Записать в историю, что ты взял этого героя. Когда Дота на связи, это происходит само."
          className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent">Беру</button>
      </div>
      {open && (
        <div className="mt-2 border-t border-border pt-2 text-xs text-muted grid gap-1">
          <div>Базовый винрейт героя на этой роли: <b className="text-foreground">{c.base}%</b> · контрпики: <b className="text-foreground">{c.vsTotal > 0 ? "+" : ""}{c.vsTotal}</b> · синергии: <b className="text-foreground">{c.withTotal > 0 ? "+" : ""}{c.withTotal}</b> · поправка на твой опыт: <b className="text-foreground">{c.personalAdj > 0 ? "+" : ""}{c.personalAdj}</b></div>
          {c.reasons.map((r) => <div key={`${r.kind}-${r.heroId}`}>{r.value > 0 ? "+" : ""}{r.value} {r.kind === "vs" ? "против" : "вместе с"} {r.name}{r.laneOpp ? <span className="text-enemy"> · твой оппонент по лейну, вес выше</span> : null} <span className="opacity-60">({r.games} игр в выборке)</span></div>)}
          <div>Риск контрпика: <b className="text-foreground">{c.counterRisk}</b>{c.stageAdj !== 0 ? <> · поправка за очередь пика <b className="text-foreground">{c.stageAdj}</b></> : null}{c.needsAdj !== 0 ? <> · закрывает нехватку команды <b className="text-foreground">+{c.needsAdj}</b></> : null}</div>
          {c.predictedAdj !== 0 && <div>Вероятные пики врага на твою линию: <b className="text-foreground">{c.predictedAdj > 0 ? "+" : ""}{c.predictedAdj}</b> <span className="opacity-60">(с небольшим весом, пока соперник не выбран)</span></div>}
          {c.personalNotes.map((n) => <div key={`${n.ally}-${n.heroId}`} className="text-accent">Твоя история {n.ally ? "вместе с" : "против"} {n.name}: {n.wins}–{n.games - n.wins}</div>)}
          <div className="opacity-60">Доля игр героя на этой роли у Divine/Immortal: {Math.round(c.midRate * 100)}%</div>
        </div>
      )}
    </div>
  );
}


function DraftBar({ byId, allies, enemies, ownHeroId, team, role }: { byId: Map<number, Hero>; allies: Pick[]; enemies: Pick[]; ownHeroId: number | null; team: "radiant" | "dire" | null; role: Role }) {
  const oursLeft = team !== "dire"; // Свет слева, как в игре; если команда неизвестна, свои слева
  const ours: (Pick | { id: number; role: Role | null; own: true })[] = [...allies];
  if (ownHeroId && !ours.some((p) => p.id === ownHeroId)) ours.unshift({ id: ownHeroId, role, own: true });
  const Slot = ({ p, side }: { p?: Pick | { id: number; role: Role | null; own?: true }; side: "ours" | "theirs" }) => {
    const h = p ? byId.get(p.id) : undefined;
    const own = !!(p && "own" in p && p.own);
    return (
      <div className={`relative h-10 w-[72px] shrink-0 overflow-hidden rounded-md border ${own ? "border-accent" : side === "ours" ? "border-ally/40" : "border-enemy/40"} bg-panel-2`} title={h?.name ?? "пусто"}>
        {h ? <img src={portrait(h.short)} alt={h.name} className="h-full w-full object-cover" /> : <div className="h-full w-full bg-gradient-to-b from-panel-2 to-panel" />}
        {own && <div className="absolute bottom-0 inset-x-0 bg-accent/80 text-[9px] text-black text-center font-semibold">ты</div>}
      </div>
    );
  };
  const left = oursLeft ? ours : enemies, right = oursLeft ? enemies : ours;
  const leftSide = oursLeft ? "ours" : "theirs", rightSide = oursLeft ? "theirs" : "ours";
  const pad = (arr: unknown[]) => Array.from({ length: 5 }, (_, i) => arr[i]);
  return (
    <section className="rounded-xl border border-border bg-panel px-3 py-2 flex items-center justify-between gap-3 overflow-x-auto">
      <div className="flex items-center gap-1.5">
        <span className={`mr-1 text-[11px] font-semibold ${leftSide === "ours" ? "text-ally" : "text-enemy"}`}>{team ? "Свет" : "Союзники"}</span>
        {pad(left).map((p, i) => <Slot key={`l${i}`} p={p as Pick | undefined} side={leftSide} />)}
      </div>
      <div className="text-xs text-muted whitespace-nowrap">{team ? (team === "radiant" ? "ты за Свет" : "ты за Тьму") : "команда неизвестна"}</div>
      <div className="flex items-center gap-1.5">
        {pad(right).map((p, i) => <Slot key={`r${i}`} p={p as Pick | undefined} side={rightSide} />)}
        <span className={`ml-1 text-[11px] font-semibold ${rightSide === "ours" ? "text-ally" : "text-enemy"}`}>{team ? "Тьма" : "Враги"}</span>
      </div>
    </section>
  );
}
