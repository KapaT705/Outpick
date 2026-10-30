"use client";

import { useEffect, useState } from "react";
import Onboarding from "@/components/Onboarding";
import Crystals from "@/components/Crystals";
import { usePathname } from "next/navigation";

type UpdateEvent = { type: "checking" | "available" | "none" | "progress" | "downloaded" | "installing" | "error"; version?: string; current?: string; percent?: number; message?: string };
export type RecognizedSlot = { team: "radiant" | "dire"; idx: number; heroId: number | null; name: string | null; score: number | null; margin: number | null; empty: boolean; learned?: boolean };
export type RecognizeCtx = { matchId?: string | null; team?: "radiant" | "dire" | null; slot?: number | null; phase?: string | null };
export type LearnResult = { ok: boolean; error?: string; checked?: number; added?: number; total?: number; notes?: string[] };
export type LearnedInfo = { total: number; heroes: { heroId: number; n: number }[]; sessions: string[] };
export type RecognizeResult = { ok: boolean; error?: string; idle?: boolean; source?: string; w?: number; h?: number; ms?: number; onPickScreen?: boolean; slots?: RecognizedSlot[] };
type Desktop = { version: () => Promise<string>; checkForUpdates: () => Promise<{ ok: boolean; reason?: string }>; downloadUpdate: () => Promise<unknown>; installUpdate: () => Promise<unknown>; onUpdate: (cb: (e: UpdateEvent) => void) => () => void; recognizeDraft?: (ctx?: RecognizeCtx) => Promise<RecognizeResult>; markMatch?: (matchId: string) => Promise<{ ok: boolean }>; learn?: () => Promise<LearnResult>; learnedInfo?: () => Promise<LearnedInfo>; captureSources?: () => Promise<{ id: string; name: string }[]>; debugCapture?: () => Promise<DebugCapture>; saveDiagnostics?: () => Promise<{ ok: boolean; file?: string; frames?: number; error?: string }>; devInfo?: () => Promise<{ canRebuild: boolean; source: string | null }>; rebuildFromSource?: () => Promise<{ ok: boolean; reason?: string }> };
export type DebugCapture = { ok: boolean; error?: string; source?: string; w?: number; h?: number; stripH?: number; scale?: number; image?: string; slots?: (RecognizedSlot & { x: number; y: number; w: number; h: number })[]; sources?: string[]; dotaRunning?: boolean };
declare global { interface Window { desktop?: Desktop } }

const NAV = [
  { href: "/", label: "Пикер" },
  { href: "/history", label: "История" },
  { href: "/settings", label: "Настройки" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
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

  return (
    <div className="min-h-full flex flex-col">
      <nav className="sticky top-0 z-30 border-b border-border bg-panel/95 backdrop-blur">
        <div className="mx-auto w-full max-w-7xl px-4 h-12 flex items-center gap-4">
          <a href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <img src="/logo.png" alt="" className="h-6 w-6 rounded-md" />
            <span>Outpick</span>
          </a>
          <div className="flex items-center gap-1 ml-2">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className={`rounded-md px-3 py-1.5 text-sm ${path === n.href ? "bg-panel-2 text-foreground" : "text-muted hover:text-foreground"}`}>{n.label}</a>
            ))}
          </div>
          <div className="ml-auto text-xs text-muted">{version ? `v${version}` : null}</div>
        </div>
      </nav>

      {banner && (
        <div className={`border-b ${banner.type === "error" ? "border-bad/40 bg-bad/10" : "border-accent/40 bg-accent/10"}`}>
          <div className="mx-auto w-full max-w-7xl px-4 py-2 flex flex-wrap items-center gap-3 text-sm">
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
            {banner.type === "error" && <span className="text-bad">Не удалось проверить обновления: {banner.message}</span>}
            <button onClick={() => setDismissed(true)} className="ml-auto text-xs text-muted hover:text-foreground">Скрыть</button>
          </div>
        </div>
      )}

      <Onboarding />
      <div className="flex-1">{children}</div>
      <Tooltips />
    </div>
  );
}

/** Свои подсказки вместо системных title: в Electron на маке системные появляются с задержкой и рисуются в углу окна.
 *  При наведении title переносится в data-tip (системная больше не всплывает), текст показывается под элементом. */
function Tooltips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; above: boolean } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cur: Element | null = null;
    const hide = () => { clearTimeout(timer); cur = null; setTip(null); };
    const show = (el: Element) => {
      const text = el.getAttribute("data-tip");
      if (!text) return;
      const r = el.getBoundingClientRect();
      const above = r.bottom + 120 > window.innerHeight && r.top > 140;
      setTip({ text, x: Math.min(Math.max(r.left + r.width / 2, 170), window.innerWidth - 170), y: above ? r.top - 6 : r.bottom + 6, above });
    };
    const over = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[title],[data-tip]");
      if (!el) { if (cur) hide(); return; }
      const t = el.getAttribute("title");
      if (t !== null) { el.removeAttribute("title"); if (t.trim()) el.setAttribute("data-tip", t); }
      if (!el.getAttribute("data-tip")) { if (cur) hide(); return; }
      if (el === cur) return;
      clearTimeout(timer); cur = el; setTip(null);
      timer = setTimeout(() => show(el), 350);
    };
    const out = (e: MouseEvent) => {
      const to = e.relatedTarget as Element | null;
      if (cur && !(to && cur.contains(to))) hide();
    };
    document.addEventListener("mouseover", over);
    document.addEventListener("mouseout", out);
    document.addEventListener("mousedown", hide, true);
    document.addEventListener("scroll", hide, true);
    return () => { document.removeEventListener("mouseover", over); document.removeEventListener("mouseout", out); document.removeEventListener("mousedown", hide, true); document.removeEventListener("scroll", hide, true); clearTimeout(timer); };
  }, []);
  if (!tip) return null;
  return (
    <div role="tooltip" className="pointer-events-none fixed z-[100] w-max max-w-[340px] -translate-x-1/2 rounded-lg border border-border bg-panel-2 px-3 py-2 text-xs leading-snug text-foreground shadow-lg"
      style={{ left: tip.x, top: tip.above ? undefined : tip.y, bottom: tip.above ? window.innerHeight - tip.y : undefined }}>{tip.text}</div>
  );
}
