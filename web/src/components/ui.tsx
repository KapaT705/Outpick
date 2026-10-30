"use client";
// Базовые элементы интерфейса: один стиль карточек, кнопок, подписей и статусов на всех страницах.
import type { ReactNode } from "react";

export function Card({ children, className = "", tone = "default" }: { children: ReactNode; className?: string; tone?: "default" | "accent" | "good" | "bad" }) {
  const border = tone === "accent" ? "border-accent/40" : tone === "good" ? "border-good/40" : tone === "bad" ? "border-bad/40" : "border-border";
  return <section className={`rounded-2xl border ${border} bg-panel p-4 ${className}`}>{children}</section>;
}

export function CardTitle({ children, right, hint }: { children: ReactNode; right?: ReactNode; hint?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold flex items-center gap-2">{children}{hint && <Hint text={hint} />}</h2>
      {right}
    </div>
  );
}

/** Знак вопроса с подсказкой по наведению: длинные пояснения живут здесь, а не в тексте на экране.
 *  Подсказка своя, а не системный title: в Electron системная появляется с задержкой и рисуется в углу окна. */
export function Hint({ text, align = "left" }: { text: string; align?: "left" | "right" }) {
  return (
    <span className="group/hint relative inline-flex">
      <span tabIndex={0} aria-label={text} className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-[10px] text-muted cursor-help select-none outline-none group-hover/hint:border-accent group-hover/hint:text-accent focus-visible:border-accent focus-visible:text-accent">?</span>
      <span role="tooltip" className={`pointer-events-none absolute top-full z-50 mt-1.5 hidden w-72 rounded-lg border border-border bg-panel-2 px-3 py-2 text-xs font-normal leading-snug text-foreground shadow-lg group-hover/hint:block group-focus-within/hint:block ${align === "right" ? "right-0" : "left-0"}`}>{text}</span>
    </span>
  );
}

export function Button({ children, onClick, variant = "ghost", disabled, title, className = "", size = "md" }: { children: ReactNode; onClick?: () => void; variant?: "primary" | "ghost" | "danger" | "link"; disabled?: boolean; title?: string; className?: string; size?: "sm" | "md" }) {
  const base = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm";
  const v = variant === "primary" ? "bg-accent text-black font-semibold hover:brightness-110"
    : variant === "danger" ? "border border-bad/50 text-bad hover:bg-bad/10"
    : variant === "link" ? "text-muted hover:text-foreground hover:underline px-0 py-0"
    : "border border-border text-foreground hover:border-accent/60 hover:bg-panel-2";
  return <button onClick={onClick} disabled={disabled} title={title} className={`rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed ${variant === "link" ? "" : base} ${v} ${className}`}>{children}</button>;
}

export function Chip({ children, tone = "muted", title, className = "" }: { children: ReactNode; tone?: "muted" | "accent" | "good" | "bad" | "enemy" | "ally"; title?: string; className?: string }) {
  const t = { muted: "bg-panel-2 text-muted", accent: "bg-accent/15 text-accent", good: "bg-good/15 text-good", bad: "bg-bad/15 text-bad", enemy: "bg-enemy/15 text-enemy", ally: "bg-ally/15 text-ally" }[tone];
  return <span title={title} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs leading-4 whitespace-nowrap ${t} ${className}`}>{children}</span>;
}

/** Точка состояния с подписью: зелёная — работает, серая — нет, жёлтая — ждёт. */
export function Status({ ok, label, title, pending }: { ok: boolean; label: string; title?: string; pending?: boolean }) {
  return (
    <span title={title} className="inline-flex items-center gap-1.5 text-xs text-muted cursor-default">
      <span className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-good" : pending ? "bg-accent" : "bg-border"}`} />{label}
    </span>
  );
}

/** Погасший кристалл из знака Outpick: для пустых состояний. */
export function CrystalMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  const w = size, h = size * 1.35;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={`shrink-0 ${className}`} aria-hidden="true">
      <path d={`M${w * 0.1} ${h * 0.74} L${w * 0.9} ${h * 0.74} L${w} ${h} L0 ${h} Z`} fill="#2d2933" />
      <path d={`M${w * 0.22} ${h * 0.74} L${w / 2} ${h * 0.64} L${w * 0.78} ${h * 0.74}`} fill="#211e25" />
      <path d={`M${w / 2} ${h * 0.04} L${w * 0.92} ${h * 0.46} L${w / 2} ${h * 0.76} L${w * 0.08} ${h * 0.46} Z`} fill="#3a3540" />
      <path d={`M${w / 2} ${h * 0.04} L${w * 0.92} ${h * 0.46} L${w / 2} ${h * 0.5} Z`} fill="#4a4452" />
    </svg>
  );
}

export function Empty({ children, action, compact }: { children: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`rounded-xl border border-dashed border-border text-center text-sm text-muted flex flex-col items-center gap-2 ${compact ? "px-3 py-4" : "px-4 py-6"}`}>
      <CrystalMark size={compact ? 20 : 28} className="opacity-80" />
      <span>{children}</span>{action}
    </div>
  );
}
