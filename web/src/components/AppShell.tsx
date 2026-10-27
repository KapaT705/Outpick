"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type UpdateEvent = { type: "checking" | "available" | "none" | "progress" | "downloaded" | "error"; version?: string; current?: string; percent?: number; message?: string };
export type RecognizedSlot = { team: "radiant" | "dire"; idx: number; heroId: number | null; name: string | null; score: number | null; margin: number | null; empty: boolean; learned?: boolean };
export type RecognizeCtx = { matchId?: string | null; team?: "radiant" | "dire" | null; slot?: number | null };
export type LearnResult = { ok: boolean; error?: string; checked?: number; added?: number; total?: number; notes?: string[] };
export type LearnedInfo = { total: number; heroes: { heroId: number; n: number }[]; sessions: string[] };
export type RecognizeResult = { ok: boolean; error?: string; source?: string; w?: number; h?: number; ms?: number; onPickScreen?: boolean; slots?: RecognizedSlot[] };
type Desktop = { version: () => Promise<string>; checkForUpdates: () => Promise<{ ok: boolean; reason?: string }>; downloadUpdate: () => Promise<unknown>; installUpdate: () => Promise<unknown>; onUpdate: (cb: (e: UpdateEvent) => void) => () => void; recognizeDraft?: (ctx?: RecognizeCtx) => Promise<RecognizeResult>; markMatch?: (matchId: string) => Promise<{ ok: boolean }>; learn?: () => Promise<LearnResult>; learnedInfo?: () => Promise<LearnedInfo>; captureSources?: () => Promise<{ id: string; name: string }[]>; debugCapture?: () => Promise<DebugCapture>; saveDiagnostics?: () => Promise<{ ok: boolean; file?: string; frames?: number; error?: string }> };
export type DebugCapture = { ok: boolean; error?: string; source?: string; w?: number; h?: number; stripH?: number; scale?: number; image?: string; slots?: (RecognizedSlot & { x: number; y: number; w: number; h: number })[]; sources?: string[] };
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

  const banner = upd && !dismissed && (upd.type === "available" || upd.type === "progress" || upd.type === "downloaded" || upd.type === "error") ? upd : null;

  return (
    <div className="min-h-full flex flex-col">
      <nav className="sticky top-0 z-30 border-b border-border bg-panel/95 backdrop-blur">
        <div className="mx-auto w-full max-w-7xl px-4 h-12 flex items-center gap-4">
          <a href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-block h-5 w-5 rotate-45 rounded-sm bg-accent" />
            <span>Dota Mid Helper</span>
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
              <div className="h-1.5 w-48 overflow-hidden rounded bg-panel-2"><div className="h-full bg-accent transition-all" style={{ width: `${banner.percent ?? 0}%` }} /></div>
            </>}
            {banner.type === "downloaded" && <>
              <span>Версия <b>{banner.version}</b> скачана, установится при перезапуске.</span>
              <button onClick={() => window.desktop?.installUpdate()} className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-black hover:brightness-110">Перезапустить сейчас</button>
            </>}
            {banner.type === "error" && <span className="text-bad">Не удалось проверить обновления: {banner.message}</span>}
            <button onClick={() => setDismissed(true)} className="ml-auto text-xs text-muted hover:text-foreground">Скрыть</button>
          </div>
        </div>
      )}

      <div className="flex-1">{children}</div>
    </div>
  );
}
