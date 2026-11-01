"use client";

import { useEffect, useState } from "react";
import Crystals from "@/components/Crystals";

/** Что пикер отдаёт оверлею (см. DraftBoard: overlayPush). Считается в главном окне, здесь только показ. */
export type OverlayHero = { heroId: number; name: string; short: string; score: number; pool: "pool" | "familiar" | "outside"; me: string | null; why: string[] };
export type OverlayData = {
  active: boolean;             // идёт стадия пиков (или в зонах уже есть герои без связи с Дотой)
  gsi: boolean;
  role: number;
  stage: "early" | "mid" | "late";
  own: number | null;          // свой герой уже выбран
  lane: { name: string; short: string; prob: number } | null;
  pool: OverlayHero[];
  outside: OverlayHero[];
  enemies: number;
  allies: number;
  count?: number;              // сколько героев показывать (из настроек, добавляет главный процесс)
  at: number;
};

const ROLE = ["", "керри", "мид", "офлейн", "саппорт 4", "саппорт 5"];
const STAGE = { early: "ранний пик", mid: "середина драфта", late: "поздний пик" };
const icon = (short: string) => `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/icons/${short}.png`;
const drag = { WebkitAppRegion: "drag" } as React.CSSProperties;
const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

export default function OverlayView() {
  const [d, setD] = useState<OverlayData | null>(null);
  useEffect(() => {
    const off = window.desktop?.onOverlayData?.((x) => setD(x));
    return () => off?.();
  }, []);

  const count = d?.count === 5 ? 5 : 3;
  const pool = d?.pool.slice(0, count) ?? [];
  const outside = d?.outside.slice(0, 2) ?? [];
  const hide = () => window.desktop?.overlayHide?.();

  return (
    <div className="h-screen flex flex-col overflow-hidden select-none text-[13px]">
      <div style={drag} className="shrink-0 flex items-center gap-2 px-2.5 h-7 border-b border-border bg-panel cursor-move">
        <img src="/logo.png" alt="" className="h-4 w-4 rounded" />
        <span className="font-semibold text-xs">Outpick</span>
        {d && <span className="text-[11px] text-muted truncate">· {ROLE[d.role]}{d.active ? ` · ${STAGE[d.stage]}` : ""}</span>}
        <button style={noDrag} onClick={hide} title="Скрыть (Ctrl+Shift+O вернёт)" className="ml-auto h-5 w-5 rounded text-muted hover:text-foreground hover:bg-panel-2 leading-none">×</button>
      </div>
      <div className="flex-1 overflow-y-auto px-2.5 py-2 flex flex-col gap-2">
        {!d && <div className="text-xs text-muted leading-relaxed">Оверлей покажет лучшие пики, когда начнётся драфт. Главное окно программы должно быть открыто.</div>}
        {d && d.own && <div className="text-xs text-muted">Герой выбран, удачной игры.</div>}
        {d && !d.own && d.lane && (
          <div className="flex items-center gap-2 rounded-md bg-panel-2 px-2 py-1.5 text-xs">
            <img src={icon(d.lane.short)} alt="" className="h-5 w-5 rounded" />
            <span className="text-muted">против тебя</span><b className="truncate">{d.lane.name}</b><span className="text-muted ml-auto">{d.lane.prob}%</span>
          </div>
        )}
        {d && !d.own && pool.length === 0 && outside.length === 0 && (
          <div className="flex items-center gap-2 text-xs text-muted"><Crystals size={10} /> жду драфт</div>
        )}
        {d && !d.own && pool.map((h, i) => <Row key={h.heroId} h={h} n={i + 1} />)}
        {d && !d.own && outside.length > 0 && (
          <>
            <div className="text-[10px] uppercase tracking-wide text-muted mt-1">вне пула</div>
            {outside.map((h) => <Row key={h.heroId} h={h} dim />)}
          </>
        )}
        {d && !d.own && !d.gsi && d.enemies + d.allies === 0 && pool.length > 0 && (
          <div className="text-[11px] text-muted">Дота не на связи: герои по винрейту на роли, без учёта драфта.</div>
        )}
      </div>
    </div>
  );
}

function Row({ h, n, dim }: { h: OverlayHero; n?: number; dim?: boolean }) {
  return (
    <div className={`flex items-center gap-2 rounded-md px-1.5 py-1 ${dim ? "opacity-75" : "bg-panel"} ${n === 1 ? "ring-1 ring-accent/50" : ""}`}>
      {n != null && <span className="w-3 text-[11px] text-muted tabular-nums text-right">{n}</span>}
      <img src={icon(h.short)} alt="" className="h-7 w-7 rounded shrink-0" />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate font-medium">{h.name}{h.me && <span className="text-[11px] text-muted font-normal"> · ты {h.me}</span>}</div>
        {h.why.length > 0 && <div className="truncate text-[11px] text-muted">{h.why.join(", ")}</div>}
      </div>
      <b className={`tabular-nums text-base ${h.score >= 55 ? "text-good" : h.score <= 45 ? "text-bad" : "text-foreground"}`}>{h.score}%</b>
    </div>
  );
}
