"use client";

import { useEffect, useState } from "react";
import Onboarding from "@/components/Onboarding";
import Crystals from "@/components/Crystals";
import DraftBoard from "@/components/DraftBoard";
import type { Hero } from "@/lib/types";
import type { AliasMap } from "@/lib/aliases";
import { usePathname } from "next/navigation";

type UpdateEvent = { type: "checking" | "available" | "none" | "progress" | "downloaded" | "installing" | "error"; version?: string; current?: string; percent?: number; message?: string };
export type RecognizedSlot = { team: "radiant" | "dire"; idx: number; heroId: number | null; name: string | null; score: number | null; margin: number | null; empty: boolean; learned?: boolean };
export type RecognizeCtx = { matchId?: string | null; team?: "radiant" | "dire" | null; slot?: number | null; phase?: string | null };
export type LearnResult = { ok: boolean; error?: string; checked?: number; added?: number; total?: number; notes?: string[] };
export type LearnedInfo = { total: number; heroes: { heroId: number; n: number }[]; sessions: string[] };
// роли своей команды по иконкам под слотами (ранговый поиск по ролям); team null = сторона не определена
export type RecognizedRoles = { team: "radiant" | "dire" | null; slots: { idx: number; role: number | null; score: number; second: number }[] };
export type RecognizeResult = { ok: boolean; error?: string; idle?: boolean; source?: string; w?: number; h?: number; ms?: number; onPickScreen?: boolean; slots?: RecognizedSlot[] ; roles?: RecognizedRoles | null };
type Desktop = { version: () => Promise<string>; checkForUpdates: () => Promise<{ ok: boolean; reason?: string }>; downloadUpdate: () => Promise<unknown>; installUpdate: () => Promise<unknown>; onUpdate: (cb: (e: UpdateEvent) => void) => () => void; recognizeDraft?: (ctx?: RecognizeCtx) => Promise<RecognizeResult>; markMatch?: (matchId: string) => Promise<{ ok: boolean }>; learn?: () => Promise<LearnResult>; learnedInfo?: () => Promise<LearnedInfo>; captureSources?: () => Promise<{ id: string; name: string }[]>; debugCapture?: () => Promise<DebugCapture>; saveDiagnostics?: () => Promise<{ ok: boolean; file?: string; frames?: number; error?: string }>; devInfo?: () => Promise<{ canRebuild: boolean; source: string | null }>; rebuildFromSource?: () => Promise<{ ok: boolean; reason?: string }>; overlayPush?: (data: unknown) => void; overlayShow?: () => Promise<{ ok: boolean; visible?: boolean }>; overlayHide?: () => Promise<{ ok: boolean; visible?: boolean }>; overlayApply?: () => Promise<{ ok: boolean; visible?: boolean }>; onOverlayData?: (cb: (d: import("@/components/OverlayView").OverlayData) => void) => () => void; };
export type DebugCapture = { ok: boolean; error?: string; source?: string; w?: number; h?: number; stripH?: number; scale?: number; image?: string; slots?: (RecognizedSlot & { x: number; y: number; w: number; h: number })[]; sources?: string[]; dotaRunning?: boolean ; roles?: RecognizedRoles | null };
declare global { interface Window { desktop?: Desktop } }

const NAV = [
  { href: "/", label: "Пикер" },
  { href: "/history", label: "История" },
  { href: "/settings", label: "Настройки" },
];

export default function AppShell({ children, heroes, aliases }: { children: React.ReactNode; heroes?: Hero[]; aliases?: AliasMap }) {
  const path = usePathname();
  const [version, setVersion] = useState<string | null>(null);
  const [upd, setUpd] = useState<UpdateEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onFake = (ev: Event) => { setUpd((ev as CustomEvent).detail); setDismissed(false); };
    window.addEventListener("desktop-update", onFake);
    const d = window.desktop;
    let off: (() => void) | undefined;
    if (d) {
      d.version().then(setVersion).catch(() => {});
      off = d.onUpdate((e) => { setUpd(e); setDismissed(false); });
    }
    return () => { off?.(); window.removeEventListener("desktop-update", onFake); };
  }, []);

  const banner = upd && !dismissed && (upd.type === "available" || upd.type === "progress" || upd.type === "downloaded" || upd.type === "installing" || upd.type === "error") ? upd : null;

  // окно оверлея: без шапки, плашек и экрана первого запуска
  if (path.startsWith("/overlay")) return <>{children}<Tooltips /></>;

  return (
    <div className="min-h-full flex flex-col">
      <nav className="sticky top-0 z-30 border-b border-border bg-panel/95 backdrop-blur">
        <div className="w-full px-5 h-12 flex items-center gap-4">
          <a href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <img src="/logo.png" alt="" className="h-6 w-6 rounded-md" />
            <span>Outpick</span>
          </a>
          <div className="flex items-center gap-1 ml-2">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className={`rounded-md px-3 py-1.5 text-sm ${(n.href === "/" ? path === "/" : path.startsWith(n.href)) ? "bg-panel-2 text-foreground" : "text-muted hover:text-foreground"}`}>{n.label}</a>
            ))}
          </div>
          <div className="ml-auto text-xs text-muted">{version ? `v${version}` : null}</div>
        </div>
      </nav>

      {banner && (
        <div className={`border-b ${banner.type === "error" ? "border-bad/40 bg-bad/10" : "border-accent/40 bg-accent/10"}`}>
          <div className="w-full px-5 py-2 flex flex-wrap items-center gap-3 text-sm">
            {banner.type === "available" && <>
              <span>Доступна версия <b>{banner.version}</b>{banner.current ? <span className="text-muted"> (сейчас {banner.current})</span> : null}</span>
              <button onClick={() => window.desktop?.downloadUpdate()} className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-black hover:brightness-110">Скачать</button>
            </>}
            {banner.type === "progress" && <>
              <span>Скачиваю обновление… {banner.percent ?? 0}%</span>
              <Crystals size={12} progress={(banner.percent ?? 0) / 100} />
            </>}
            {banner.type === "downloaded" && <>
              <span>Версия <b>{banner.version}</b> скачана. При перезапуске установится сама, без окон установщика, и программа откроется снова.</span>
              <button onClick={() => { window.desktop?.installUpdate(); setUpd({ type: "installing", version: banner.version }); }} className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-black hover:brightness-110">Перезапустить сейчас</button>
            </>}
            {banner.type === "installing" && <Crystals size={12} label={`Устанавливаю ${banner.version}… программа закроется и откроется сама через несколько секунд.`} />}
            {banner.type === "error" && <span className="text-bad">{banner.message}</span>}
            <button onClick={() => setDismissed(true)} className="ml-auto text-xs text-muted hover:text-foreground">Скрыть</button>
          </div>
        </div>
      )}

      <Onboarding />
      {path === "/" && <ReportReady />}
      {heroes && aliases && <div className={path === "/" ? "flex-1" : "hidden"}><DraftBoard heroes={heroes} aliases={aliases} /></div>}
      <div className={path === "/" ? "" : "flex-1"}>{children}</div>
      <Tooltips />
    </div>
  );
}

/** Плашка в пикере, когда у последнего матча подтянулся результат: один клик, и открыт его разбор.
 *  Показывается 6 часов после синхронизации, крестик прячет её до следующего матча. */
function ReportReady() {
  type Last = { id: string; matchId: number; heroId: number; heroName: string | null; won: boolean; accountId: number | null; syncedAt: number; canReport: boolean };
  const [last, setLast] = useState<Last | null>(null);
  const [hidden, setHidden] = useState<string | null>(null);
  useEffect(() => {
    try { setHidden(localStorage.getItem("reportReady.hidden")); } catch {}
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (document.visibilityState === "visible") { const j = await fetch("/api/log/last").then((r) => r.json()).catch(() => null); if (j?.ok) setLast(j.item); }
      timer = setTimeout(poll, 60_000);
    };
    poll();
    return () => clearTimeout(timer);
  }, []);
  if (!last || !last.canReport || hidden === last.id || Date.now() / 1000 - last.syncedAt > 6 * 3600) return null;
  const href = `/history/${last.matchId}?${new URLSearchParams({ ...(last.accountId ? { me: String(last.accountId) } : {}), hero: String(last.heroId) })}`;
  return (
    <div className={`border-b ${last.won ? "border-good/40 bg-good/10" : "border-bad/40 bg-bad/10"}`}>
      <div className="w-full px-5 py-2 flex flex-wrap items-center gap-3 text-sm">
        <span>Разбор последнего матча готов{last.heroName ? <>: <b>{last.heroName}</b>, {last.won ? "победа" : "поражение"}</> : null}</span>
        <a href={href} className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-black hover:brightness-110">Открыть разбор →</a>
        <button onClick={() => { setHidden(last.id); try { localStorage.setItem("reportReady.hidden", last.id); } catch {} }} className="ml-auto text-xs text-muted hover:text-foreground">Скрыть</button>
      </div>
    </div>
  );
}

/** Свои подсказки вместо системных title: в Electron на маке системные появляются с задержкой и рисуются в углу окна.
 *  При наведении title переносится в data-tip (системная больше не всплывает), текст показывается под элементом. */
function Tooltips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; above: boolean } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cur: Element | null = null;   // элемент под курсором, у которого title снят на время наведения
    let curText = "";                 // его текст подсказки
    // title снимается только пока курсор на элементе (иначе всплывёт системная подсказка) и возвращается при уходе:
    // постоянной копии нет, поэтому когда React убирает title (строка раскрыта), подсказка тоже исчезает
    const restore = () => { if (cur && cur.isConnected && curText && !cur.hasAttribute("title")) cur.setAttribute("title", curText); };
    const hide = () => { clearTimeout(timer); setTip(null); };
    const leave = () => { hide(); restore(); cur = null; curText = ""; };
    const show = () => {
      if (!cur || !cur.isConnected || !curText) return;
      const r = cur.getBoundingClientRect();
      const above = r.bottom + 120 > window.innerHeight && r.top > 140;
      setTip({ text: curText, x: Math.min(Math.max(r.left + r.width / 2, 170), window.innerWidth - 170), y: above ? r.top - 6 : r.bottom + 6, above });
    };
    const over = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[title]");
      if (el === cur) return;
      if (cur) leave();
      if (!el) return;
      const t = el.getAttribute("title") ?? "";
      if (!t.trim()) return;
      cur = el; curText = t; el.removeAttribute("title");
      timer = setTimeout(show, 350);
    };
    const out = (e: MouseEvent) => {
      const to = e.relatedTarget as Element | null;
      if (cur && !(to && cur.contains(to))) leave();
    };
    document.addEventListener("mouseover", over);
    document.addEventListener("mouseout", out);
    document.addEventListener("mousedown", hide, true); // клик: подсказка прячется, title вернётся при уходе курсора
    document.addEventListener("scroll", hide, true);
    return () => { document.removeEventListener("mouseover", over); document.removeEventListener("mouseout", out); document.removeEventListener("mousedown", hide, true); document.removeEventListener("scroll", hide, true); clearTimeout(timer); };
  }, []);
  if (!tip) return null;
  return (
    <div role="tooltip" className="pointer-events-none fixed z-[100] w-max max-w-[340px] -translate-x-1/2 rounded-lg border border-border bg-panel-2 px-3 py-2 text-xs leading-snug text-foreground shadow-lg"
      style={{ left: tip.x, top: tip.above ? undefined : tip.y, bottom: tip.above ? window.innerHeight - tip.y : undefined }}>{tip.text}</div>
  );
}
