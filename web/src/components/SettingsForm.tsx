"use client";

import { useEffect, useRef, useState } from "react";
import type { DebugCapture, LearnedInfo } from "@/components/AppShell";
import { Button, Card, Chip, Hint } from "@/components/ui";
import type { OverlaySettings } from "@/lib/config";
import Crystals from "@/components/Crystals";

// доля выполнения обновления по сообщению шага (lib/refresh.ts): у шага свой отрезок, счётчик «50/127» двигает внутри него
const STEPS: [string, number, number][] = [["старт", 0, 0.05], ["герои", 0.05, 0.12], ["матчапы", 0.12, 0.55], ["мета мида", 0.55, 0.65], ["роли героев", 0.65, 0.76], ["имя аккаунта", 0.76, 0.8], ["матчи", 0.8, 0.98], ["готово", 1, 1]];
function stepProgress(m: string | undefined): number | null {
  if (!m) return null;
  const st = STEPS.find(([k]) => m.startsWith(k));
  if (!st) return null;
  const c = m.match(/(\d+)\/(\d+)/);
  const f = c && Number(c[2]) > 0 ? Number(c[1]) / Number(c[2]) : 0;
  return st[1] + (st[2] - st[1]) * f;
}

/** Состояние пункта настроек: зелёный чип, когда настроено. */
const Check = ({ ok, label }: { ok: boolean; label: string }) => <Chip tone={ok ? "good" : "muted"}>{ok ? "✓" : "○"} {label}</Chip>;
/** Заголовок карточки настроек с чипом состояния справа от названия. */
const Title = ({ children, hint }: { children: React.ReactNode; hint?: string }) => <div className="text-base font-semibold flex items-center gap-2 flex-wrap">{children}{hint && <Hint text={hint} />}</div>;
const INPUT = "rounded-lg border border-border bg-panel-2 px-3 py-2 outline-none focus:border-accent placeholder:text-muted/60";

export default function SettingsForm() {
  const [steamId, setSteamId] = useState("");
  const [token, setToken] = useState("");
  const [gsi, setGsi] = useState<{ cfg: string; dotaDirs: string[]; fileName: string; installed?: boolean; rewritten?: boolean; installedUri?: string | null } | null>(null);
  const [diag, setDiag] = useState<string | null>(null);
  const [gsiMsg, setGsiMsg] = useState<string | null>(null);
  const [dotaDir, setDotaDir] = useState("");
  const [raw, setRaw] = useState<string | null>(null);
  const [updMsg, setUpdMsg] = useState<string | null>(null);
  const [rawMsg, setRawMsg] = useState<string | null>(null);
  type Acc = { id: number; name?: string; known: boolean; updatedAt: number | null; isDefault: boolean; anonymous?: boolean };
  type Current = { id: number | null; source: "gsi" | "steam" | "manual" | "none"; known: boolean; name: string | null };
  const [info, setInfo] = useState<{ steamAccountId: number | null; accounts?: Acc[]; current?: Current; hasToken: boolean; tokenTail: string; hasGithubToken?: boolean; screenCapture?: boolean; overlay?: OverlaySettings } | null>(null);
  // оверлей поверх Доты: настройки живут в config.json, окно рисует главный процесс (overlayApply перечитывает их)
  const ov: OverlaySettings = info?.overlay ?? { enabled: true, auto: true, opacity: 0.95, count: 3 };
  const [ovMsg, setOvMsg] = useState<string | null>(null);
  const ovTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveOverlay = (p: Partial<OverlaySettings>, delay = 0) => {
    setInfo((i) => (i ? { ...i, overlay: { ...ov, ...p } } : i));
    if (ovTimer.current) clearTimeout(ovTimer.current);
    ovTimer.current = setTimeout(async () => {
      const r = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ overlay: p }) }).then((x) => x.json()).catch(() => null);
      if (r?.overlay) setInfo((i) => (i ? { ...i, overlay: r.overlay } : i));
      await window.desktop?.overlayApply?.();
    }, delay);
  };
  const overlayNow = async (show: boolean) => {
    const d = window.desktop;
    if (!d?.overlayShow || !d.overlayHide) { setOvMsg("работает только в приложении"); return; }
    const r = await (show ? d.overlayShow() : d.overlayHide());
    setOvMsg(!show ? "окно скрыто" : r?.visible ? "окно показано, двигай его за верхнюю полоску" : "окно выключено: включи оверлей выше");
  };
  const [accMsg, setAccMsg] = useState<string | null>(null);
  const [dev, setDev] = useState<{ canRebuild: boolean; source: string | null } | null>(null);
  const [devMsg, setDevMsg] = useState<string | null>(null);
  useEffect(() => { window.desktop?.devInfo?.().then(setDev).catch(() => {}); }, []);
  const reloadInfo = () => fetch("/api/settings").then((r) => r.json()).then(setInfo).catch(() => {});
  const accountAction = async (action: "add" | "load" | "default" | "remove", id: number | string) => {
    setAccMsg(action === "add" || action === "load" ? "загружаю историю…" : null);
    const r = await fetch("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id }) }).then((x) => x.json()).catch(() => null);
    if (!r?.ok) { setAccMsg(r?.error ?? "ошибка"); return; }
    if (action === "add" || action === "load") {
      setSteamId("");
      const poll = async () => { const st = await fetch("/api/refresh").then((x) => x.json()).catch(() => null); if (st?.running) { setAccMsg(st.message); setRef(st); setTimeout(poll, 1500); return; } if (st) setRef(st); setAccMsg(st?.error ? `ошибка: ${st.error}` : "готово"); reloadInfo(); };
      setTimeout(poll, 1000);
    } else { setAccMsg(null); reloadInfo(); }
  };
  const [dbg, setDbg] = useState<DebugCapture | null>(null);
  const [dbgBusy, setDbgBusy] = useState(false);
  const [learned, setLearned] = useState<LearnedInfo | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  type Tab = "accounts" | "screen" | "dota" | "data" | "diag";
  const [tab, setTabState] = useState<Tab>("accounts");
  const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem("settings.tab", t); } catch {} };
  useEffect(() => { try { const t = localStorage.getItem("settings.tab"); if (t && ["accounts", "screen", "dota", "data", "diag"].includes(t)) setTabState(t as Tab); } catch {} }, []);
  const [ref, setRef] = useState<{ running: boolean; message: string; error: string | null; updatedAt: number | null; autoEveryDays?: number; due?: boolean } | null>(null);

  useEffect(() => { reloadInfo(); fetch("/api/gsi/install").then((r) => r.json()).then(setGsi).catch(() => {}); window.desktop?.learnedInfo?.().then(setLearned).catch(() => {}); }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const r = await fetch("/api/refresh").then((x) => x.json()).catch(() => null);
      if (r) setRef(r);
      if (r?.running) timer = setTimeout(poll, 1500);
    };
    poll();
    return () => clearTimeout(timer);
  }, []);
  const startRefresh = async () => {
    const r = await fetch("/api/refresh", { method: "POST" }).then((x) => x.json()).catch(() => null);
    if (r?.ok) { setRef({ running: true, message: "старт", error: null, updatedAt: ref?.updatedAt ?? null }); const tick = async () => { const s = await fetch("/api/refresh").then((x) => x.json()).catch(() => null); if (s) setRef(s); if (s?.running) setTimeout(tick, 1500); }; setTimeout(tick, 1500); }
    else setRef({ running: false, message: "", error: r?.error ?? "ошибка", updatedAt: ref?.updatedAt ?? null });
  };

  const save = async () => {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stratzToken: token }) }).then((x) => x.json()).catch(() => null);
    if (r?.ok) { setMsg("Сохранено"); setToken(""); reloadInfo(); } else setMsg(r?.error ?? "Ошибка");
    setBusy(false);
  };

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-5 flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Настройки</h1>
      </header>
      {/* вкладки вместо длинной прокрутки: у каждой точка состояния (зелёная = настроено) */}
      <nav className="flex flex-wrap gap-0.5 rounded-xl border border-border bg-panel p-1 text-sm">
        {([
          ["accounts", "Аккаунты", !!info?.hasToken && !!info?.accounts?.length],
          ["screen", "Экран пиков", info?.screenCapture !== false],
          ["dota", "Связь с Дотой", !!gsi?.installed],
          ["data", "Данные", !!ref?.updatedAt && !ref?.due],
          ["diag", "Диагностика", true],
        ] as [Tab, string, boolean][]).map(([key, label, ok]) => (
          <button key={key} onClick={() => setTab(key)} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 ${tab === key ? "bg-panel-2 text-foreground font-semibold" : "text-muted hover:text-foreground hover:bg-panel-2"}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${ok ? "bg-good" : "bg-border"}`} />{label}
          </button>
        ))}
      </nav>
      {tab === "accounts" && (
      <Card className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-2">
          <Title hint="Программа видит, под каким аккаунтом запущен Steam, а в матче Дота сообщает это сама, и берёт его пул и историю. Незнакомый аккаунт работает в общем режиме (мета и контрпики без пула), пока не загрузишь его историю. Аккаунт по умолчанию используется, когда Дота не на связи.">Аккаунты Steam <Check ok={!!info?.accounts?.length} label={info?.accounts?.length ? `${info.accounts.length}` : "нет"} /></Title>
          <span className="text-xs text-muted">Чьи пул и история используются в пикере. Аккаунт из Доты подхватывается сам.</span>
          {info?.current?.id && <div className="text-xs text-muted">Сейчас: <span className="text-foreground">{info.current.name ?? info.current.id}</span>{info.current.source === "gsi" ? " (сообщила Дота)" : info.current.source === "steam" ? " (под ним запущен Steam)" : " (по умолчанию)"}{info.current.known ? "" : " · пул не загружен, общий режим"}</div>}
          {!!info?.accounts?.length && (
            <div className="flex flex-col gap-1">
              {info.accounts.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-panel-2 px-3 py-2 text-xs">
                  <span className={info?.current?.id === a.id ? "text-foreground font-semibold" : "text-foreground"}>{a.name ?? a.id}</span>
                  <span className="text-muted">{a.name ? a.id : ""}{a.isDefault ? " · по умолчанию" : ""}{info?.current?.id === a.id ? " · сейчас" : ""}</span>
                  <span className={a.known ? "text-good" : "text-muted"}>{a.known ? `пул загружен${a.updatedAt ? ` ${new Date(a.updatedAt * 1000).toLocaleDateString("ru-RU")}` : ""}` : "пул не загружен"}</span>
                  {a.anonymous && <span className="text-bad" title="В Доте выключено «Expose Public Match Data» (Настройки → Социальные). Stratz не видит матчи такого аккаунта: пул не собирается, результаты в историю подтягиваются по номеру матча через OpenDota.">профиль закрыт</span>}
                  <span className="ml-auto flex gap-2 shrink-0 whitespace-nowrap">
                    <button onClick={() => accountAction("load", a.id)} disabled={!!ref?.running} className="text-accent hover:underline disabled:opacity-50">{a.known ? "обновить" : "загрузить историю"}</button>
                    {!a.isDefault && <button onClick={() => accountAction("default", a.id)} className="text-muted hover:text-foreground hover:underline">по умолчанию</button>}
                    <button onClick={() => { if (confirm(`Убрать аккаунт ${a.name ?? a.id} вместе с его пулом?`)) accountAction("remove", a.id); }} className="text-muted hover:text-bad hover:underline">убрать</button>
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input value={steamId} onChange={(e) => setSteamId(e.target.value)} placeholder="Steam ID нового аккаунта, например 123456789"
              className={`flex-1 min-w-56 ${INPUT}`} />
            <button onClick={() => { if (steamId.trim()) accountAction("add", steamId.trim()); }} disabled={!steamId.trim() || !!ref?.running || !info?.hasToken} title={info?.hasToken ? "" : "Сначала сохрани токен Stratz"} className="rounded-lg border border-border px-3.5 py-2 text-sm hover:border-accent/60 hover:bg-panel-2 disabled:opacity-50 disabled:cursor-not-allowed transition">Добавить и загрузить историю</button>
          </div>
          <span className="text-xs text-muted flex items-center gap-1.5">Число из ссылки на профиль Dotabuff или Stratz. <Hint text="Например, stratz.com/players/123456789 → 123456789. Подойдёт и 64-битный id из Steam. Добавлять заранее не обязательно: когда зайдёшь в Доту с нового аккаунта, пикер сам предложит загрузить его историю." /></span>
          {accMsg && (ref?.running ? <Crystals size={12} progress={stepProgress(accMsg)} label={accMsg} /> : <span className="text-xs text-muted">{accMsg}</span>)}
        </div>
        <label className="flex flex-col gap-1">
          <Title hint="С токеном программа загружает твой пул, подтягивает результаты матчей, строит разбор и обновляет мету. Без него работает только пикер на данных из сборки. Токен хранится только на этом компьютере.">Токен Stratz API <Check ok={!!info?.hasToken} label={info?.hasToken ? `сохранён${info.tokenTail ? ` …${info.tokenTail}` : ""}` : "не задан"} /></Title>
          <input value={token} onChange={(e) => setToken(e.target.value)} type="password" placeholder="вставь токен со страницы stratz.com/api"
            className={INPUT} />
          <span className="text-xs text-muted">Открой <a href="https://stratz.com/api" target="_blank" rel="noreferrer" className="text-accent underline">stratz.com/api</a>, войди через Steam, нажми «Create token» и вставь строку сюда.</span>
        </label>
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={busy} className="rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition">{busy ? "проверяю…" : "Сохранить"}</button>
          {msg && <span className="text-xs text-muted">{msg}</span>}
        </div>
      </Card>
      )}

      {tab === "screen" && (
      <Card className="flex flex-col gap-3 text-sm">
        <Title hint="Пока Дота закрыта, программа экран не трогает и почти не нагружает компьютер. Когда Дота запущена, на стадии пиков программа снимает горизонтальный экран (вертикальные мониторы не читаются, при нескольких горизонтальных запоминает тот, где была стадия пиков) и распознаёт портреты в верхней панели. Кадры стадии пиков хранятся только на этом компьютере и никуда не отправляются. Когда результат матча подтягивается из Stratz, программа сверяет кадры с реальным составом и доучивает портреты, которых не знала (персоны, арканы).">Чтение экрана пиков <Check ok={info?.screenCapture !== false} label={info?.screenCapture !== false ? "включено" : "выключено"} /></Title>
        <p className="text-xs text-muted">На стадии пиков программа сама читает портреты героев с экрана: враги и союзники появляются в пикере без ввода руками.</p>
        {learned && <div className="text-xs text-muted">Выучено дополнительных портретов: <span className="text-foreground">{learned.total}</span>{learned.heroes.length ? ` (героев: ${learned.heroes.length})` : ""}</div>}
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={info?.screenCapture !== false} onChange={async (e) => { const v = e.target.checked; setInfo((i) => (i ? { ...i, screenCapture: v } : i)); await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ screenCapture: v }) }).catch(() => {}); }} className="accent-[var(--accent)]" />
          <span>Подхватывать драфт с экрана</span>
        </label>
        <div className="flex items-center gap-3">
          <button onClick={async () => { const d = (window as unknown as { desktop?: { debugCapture?: () => Promise<DebugCapture> } }).desktop; if (!d?.debugCapture) { setDbg({ ok: false, error: "Проверка работает только в приложении" }); return; } setDbgBusy(true); setDbg(await d.debugCapture().catch((e) => ({ ok: false, error: "не удалось снять экран, подробности в диагностике" }))); setDbgBusy(false); }}
            disabled={dbgBusy} className="shrink-0 whitespace-nowrap rounded-lg border border-border px-3.5 py-2 text-sm hover:border-accent/60 hover:bg-panel-2 disabled:opacity-50 disabled:cursor-not-allowed transition">{dbgBusy ? "снимаю…" : "Проверить экран"}</button>
          <span className="text-xs text-muted">Запусти Доту и зайди на стадию пиков (можно с ботами), затем нажми: покажу, что увидела программа.</span>
        </div>
        {dbg && !dbg.ok && <div className="text-xs text-bad">{dbg.error}</div>}
        {dbg && dbg.ok && dbg.image && (
          <div className="flex flex-col gap-2">
            <div className="text-xs text-muted">Источник: {dbg.source} · кадр {dbg.w}×{dbg.h}{dbg.dotaRunning === false ? " · Дота не запущена (автоматически экран не читается)" : ""}{dbg.sources?.length ? ` · окна: ${dbg.sources.join(", ")}` : ""}</div>
            <div className="relative w-full overflow-hidden rounded-lg border border-border bg-black">
              <img src={dbg.image} alt="верх экрана" className="block w-full" />
              {dbg.slots?.map((sl) => {
                const scaleX = 100 / (dbg.w ?? 1), scaleY = 100 / (dbg.stripH ?? 1);
                return (
                  <div key={`${sl.team}${sl.idx}`} className={`absolute border-2 ${sl.heroId ? "border-good" : sl.empty ? "border-border" : "border-bad"}`}
                    style={{ left: `${sl.x * scaleX}%`, top: `${sl.y * scaleY}%`, width: `${sl.w * scaleX}%`, height: `${sl.h * scaleY}%` }}
                    title={`${sl.team} ${sl.idx + 1}: ${sl.heroId ? `${sl.name} (${sl.score})` : sl.empty ? "пусто" : `не уверен (${sl.score ?? "?"})`}`} />
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-1 text-xs">
              {(["radiant", "dire"] as const).map((team) => (
                <div key={team} className="rounded-lg bg-panel-2 p-2">
                  <div className={`font-semibold mb-1 ${team === "radiant" ? "text-good" : "text-bad"}`}>{team === "radiant" ? "Свет (слева)" : "Тьма (справа)"}</div>
                  {dbg.slots?.filter((x) => x.team === team).map((sl) => <div key={sl.idx} className={sl.heroId ? "text-foreground" : "text-muted"}>{sl.idx + 1}. {sl.heroId ? `${sl.name} · ${sl.score}` : sl.empty ? "пусто" : `не уверен${sl.score != null ? ` · ${sl.score}` : ""}`}</div>)}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted">Зелёная рамка: герой распознан. Серая: слот пуст. Красная: что-то есть, но уверенности мало (например, твой слот со значком уровня). Если рамки не попадают на портреты, пришли этот снимок, и геометрию подстроят под твой экран.</p>
          </div>
        )}
      </Card>
      )}

      {tab === "screen" && (
      <Card className="flex flex-col gap-3 text-sm">
        <Title hint="Маленькое окно поверх Доты с лучшими пиками для тех, у кого один монитор. Появляется само на стадии пиков и прячется, когда игра началась. Окно двигается за верхнюю полоску и растягивается, положение запоминается.">Оверлей поверх Доты <Check ok={ov.enabled} label={ov.enabled ? "включён" : "выключен"} /></Title>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={ov.enabled} onChange={(e) => saveOverlay({ enabled: e.target.checked })} className="accent-accent" />
          <span>Показывать оверлей</span>
        </label>
        <label className={`flex items-center gap-2 cursor-pointer ${ov.enabled ? "" : "opacity-50"}`}>
          <input type="checkbox" checked={ov.auto} disabled={!ov.enabled} onChange={(e) => saveOverlay({ auto: e.target.checked })} className="accent-accent" />
          <span>Появляется сам на стадии пиков и прячется с началом игры</span>
        </label>
        <div className={`flex flex-wrap items-center gap-x-6 gap-y-2 ${ov.enabled ? "" : "opacity-50"}`}>
          <label className="flex items-center gap-2">
            <span className="text-muted">Прозрачность</span>
            <input type="range" min={40} max={100} value={Math.round(ov.opacity * 100)} disabled={!ov.enabled} onChange={(e) => saveOverlay({ opacity: Number(e.target.value) / 100 }, 300)} className="w-32 accent-accent" />
            <span className="w-10 tabular-nums text-xs text-muted">{Math.round(ov.opacity * 100)}%</span>
          </label>
          <div className="flex items-center gap-2">
            <span className="text-muted">Героев в списке</span>
            <div className="flex rounded-lg border border-border overflow-hidden">
              {([3, 5] as const).map((n) => <button key={n} disabled={!ov.enabled} onClick={() => saveOverlay({ count: n })} className={`px-3 py-1 text-xs ${ov.count === n ? "bg-panel-2 text-foreground" : "text-muted hover:text-foreground"}`}>{n}</button>)}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => overlayNow(true)} disabled={!ov.enabled}>Показать сейчас</Button>
          <Button onClick={() => overlayNow(false)} disabled={!ov.enabled}>Скрыть</Button>
          {ovMsg && <span className="text-xs text-muted">{ovMsg}</span>}
        </div>
        <p className="text-xs text-muted leading-relaxed">Горячая клавиша Ctrl+Shift+O (на маке Cmd+Shift+O) показывает и прячет окно. В полноэкранной Доте окно видно, если в Windows включена «оптимизация во весь экран» (обычно включена). Надёжнее всего режим «окно без рамки» в настройках Доты: по скорости он такой же.</p>
      </Card>
      )}

      {tab === "diag" && (
      <Card className="flex flex-col gap-2 text-sm">
        <Title hint="В zip попадают версия и система, логи, данные GSI, конфиг, журнал драфтов, снимок экрана с результатом распознавания и кадры со стадии пиков двух последних драфтов. Токены в файл не попадают.">Диагностика</Title>
        <p className="text-xs text-muted">Если что-то не работает, собери zip-файл в папку «Загрузки» и перешли его как есть.</p>
        <div className="flex items-center gap-3">
          <button onClick={async () => { const d = (window as unknown as { desktop?: { saveDiagnostics?: () => Promise<{ ok: boolean; file?: string; frames?: number; error?: string }> } }).desktop; if (!d?.saveDiagnostics) { setDiag("Работает только в приложении"); return; } setDiag("собираю…"); const r = await d.saveDiagnostics(); setDiag(r.ok ? `Сохранил: ${r.file} (кадров со стадии пиков: ${r.frames})` : `Ошибка: ${r.error}`); }}
            className="shrink-0 whitespace-nowrap rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition">Сохранить диагностику</button>
          {diag && <span className="text-xs text-muted break-all">{diag}</span>}
        </div>
      </Card>
      )}

      {tab === "data" && (
      <Card className="flex flex-col gap-2 text-sm">
        <Title>Обновления программы</Title>
        {dev?.canRebuild && (
          <div className="rounded-xl border border-accent/40 bg-accent/5 p-3 flex flex-wrap items-center gap-3">
            <button onClick={async () => { setDevMsg("собираю… окно закроется и откроется само через пару минут"); const r = await window.desktop!.rebuildFromSource!(); if (!r.ok) setDevMsg(`ошибка: ${r.reason}`); }} className="rounded-lg bg-accent px-3.5 py-2 text-sm font-semibold text-black hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition">Обновить из кода (мак)</button>
            <span className="text-xs text-muted">{devMsg ?? `Собирает текущий код из ${dev.source?.replace(/\/desktop\/scripts\/install-mac\.sh$/, "")} и подменяет программу. Только для теста на этом маке.`}</span>
          </div>
        )}
        <div className="flex items-center gap-3">
          <button onClick={async () => { const d = (window as unknown as { desktop?: { checkForUpdates: () => Promise<{ ok: boolean; reason?: string }> } }).desktop; if (!d) { setUpdMsg("Проверка работает только в приложении"); return; } setUpdMsg("проверяю…"); const r = await d.checkForUpdates(); setUpdMsg(r.ok ? "запросил GitHub, результат появится полосой сверху" : r.reason === "dev" ? "в режиме разработки не проверяется" : r.reason ?? "не удалось проверить"); }}
            className="rounded-lg border border-border px-3.5 py-2 text-sm hover:border-accent/60 hover:bg-panel-2 disabled:opacity-50 disabled:cursor-not-allowed transition">Проверить обновления</button>
          {updMsg && <span className="text-xs text-muted">{updMsg}</span>}
        </div>
      </Card>
      )}

      {tab === "dota" && (
      <Card className="flex flex-col gap-2 text-sm">
        <Title hint="Это официальная функция Valve (game state integration), в игру она не вмешивается: в папку игры кладётся один файл конфига. Обычному игроку Дота отдаёт только твоего выбранного героя и номер матча, состав драфта она показывает только зрителям, поэтому врагов читает экран пиков. После установки конфига перезапусти Доту.">Связь с Дотой <Check ok={!!gsi?.installed} label={gsi?.installed ? "конфиг установлен" : "конфиг не найден"} /></Title>
        <p className="text-xs text-muted">Дота сама сообщает программе, какого героя ты взял и какой идёт матч: драфт записывается в историю без нажатий.</p>
        {gsi && gsi.dotaDirs.length > 0 && <div className="text-xs text-muted">Нашёл Доту: {gsi.dotaDirs[0]}{gsi.installedUri ? ` · конфиг шлёт на ${gsi.installedUri}` : ""}</div>}
        {gsi?.rewritten && <div className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs">Конфиг GSI указывал на старый адрес, я переписал его на текущий. Перезапусти Доту, чтобы она начала слать данные сюда.</div>}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={async () => { setGsiMsg("ставлю…"); const r = await fetch("/api/gsi/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dotaDir: dotaDir || undefined }) }).then((x) => x.json()).catch(() => null); setGsiMsg(r?.ok ? `готово: ${r.file}` : r?.error ?? "ошибка"); fetch("/api/gsi/install").then((x) => x.json()).then(setGsi).catch(() => {}); }}
            className="rounded-lg border border-border px-3.5 py-2 text-sm hover:border-accent/60 hover:bg-panel-2 disabled:opacity-50 disabled:cursor-not-allowed transition">Установить конфиг в Доту</button>
          <input value={dotaDir} onChange={(e) => setDotaDir(e.target.value)} placeholder="если не нашёл: путь к …\dota 2 beta\game\dota" className={`flex-1 min-w-60 text-xs ${INPUT}`} />
        </div>
        {gsiMsg && <div className="text-xs text-muted">{gsiMsg}</div>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button onClick={async () => { const r = await fetch("/api/gsi/raw").then((x) => x.json()).catch(() => null); const txt = r ? JSON.stringify(r, null, 1) : "нет данных"; setRaw(txt); setRawMsg(r?.receivedAt ? `последнее сообщение от Доты: ${new Date(r.receivedAt).toLocaleTimeString("ru-RU")}, сохранённых образцов драфта: ${r.samples?.length ?? 0}` : "Дота ещё ничего не присылала"); }}
            className="rounded-lg border border-border px-3.5 py-2 text-sm hover:border-accent/60 hover:bg-panel-2 disabled:opacity-50 disabled:cursor-not-allowed transition">Диагностика GSI</button>
          {raw && <button onClick={async () => { try { await navigator.clipboard.writeText(raw); setRawMsg("скопировано, можно вставить в чат"); } catch { setRawMsg("не удалось скопировать, выдели текст ниже вручную"); } }} className="rounded-lg border border-border px-3.5 py-2 text-sm hover:border-accent/60 hover:bg-panel-2 disabled:opacity-50 disabled:cursor-not-allowed transition">Скопировать</button>}
          {rawMsg && <span className="text-xs text-muted">{rawMsg}</span>}
        </div>
        {raw && <textarea readOnly value={raw} className="h-48 w-full rounded-lg bg-panel-2 p-2 text-xs font-mono text-muted" />}
        {gsi && <details className="text-xs text-muted"><summary className="cursor-pointer">Или вручную: содержимое файла {gsi.fileName}</summary><pre className="mt-1 whitespace-pre-wrap rounded-lg bg-panel-2 p-2 text-xs">{gsi.cfg}</pre><div>Положи его в папку <code>dota 2 beta\game\dota\cfg\gamestate_integration\</code>.</div></details>}
      </Card>
      )}

      {tab === "data" && (
      <Card className="flex flex-col gap-2 text-sm">
        <Title hint={`Винрейты и популярность героев по ролям за последние 4 недели у Immortal (5420+ MMR), матчапы и синергии по Divine+Immortal (Stratz не делит их тоньше), плюс пул и личная история текущего аккаунта за год. Обновляется само раз в ${ref?.autoEveryDays ?? 7} дней, когда Дота не на стадии пиков. Занимает около минуты.`}>Данные меты <Check ok={!!ref?.updatedAt} label={ref?.updatedAt ? `обновлены ${new Date(ref.updatedAt * 1000).toLocaleDateString("ru-RU")}` : "из сборки"} /></Title>
        <p className="text-xs text-muted">Винрейты, контрпики и твой пул из Stratz. Обновляются сами раз в {ref?.autoEveryDays ?? 7} дней; после патча можно нажать вручную.</p>
        <div className="flex items-center gap-3">
          <button onClick={startRefresh} disabled={!!ref?.running} className="rounded-lg border border-border px-3.5 py-2 text-sm hover:border-accent/60 hover:bg-panel-2 disabled:opacity-50 disabled:cursor-not-allowed transition">{ref?.running ? "обновляю…" : "Обновить мету"}</button>
          {ref?.running ? <Crystals size={12} progress={stepProgress(ref.message)} label={ref.message} /> : <span className="text-xs text-muted">
            {ref?.error ? `ошибка: ${ref.error}` : ref?.updatedAt ? `обновлено ${new Date(ref.updatedAt * 1000).toLocaleString("ru-RU")}` : "пока используются данные из сборки"}
          </span>}
        </div>
      </Card>
      )}
    </main>
  );
}
