"use client";
// Индикатор ожидания в духе значка Outpick: пять кристаллов на каменных гнёздах, загораются по очереди.
// progress от 0 до 1 зажигает кристаллы по доле (следующий мерцает), без progress идёт бегущая волна.

const N = 5;

export default function Crystals({ progress, size = 18, label, className = "" }: { progress?: number | null; size?: number; label?: string; className?: string }) {
  const lit = progress == null ? -1 : Math.min(N, Math.floor(progress * N + 1e-6));
  const charging = progress == null ? -1 : lit < N ? lit : -1;
  const w = size, h = size * 1.35, gap = size * 0.35;
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} role="progressbar" aria-valuenow={progress == null ? undefined : Math.round(progress * 100)} aria-busy="true">
      <svg width={N * w + (N - 1) * gap} height={h} viewBox={`0 0 ${N * w + (N - 1) * gap} ${h}`} className="shrink-0 overflow-visible">
        {Array.from({ length: N }, (_, i) => {
          const x = i * (w + gap);
          const cx = x + w / 2, top = h * 0.04, mid = h * 0.52, bottom = h * 0.74;
          const on = progress == null ? false : i < lit;
          const cls = progress == null ? "crystal-wave" : on ? "crystal-on" : i === charging ? "crystal-charging" : "crystal-off";
          return (
            <g key={i} className={cls} style={progress == null ? { animationDelay: `${i * 0.18}s` } : undefined}>
              {/* гнездо */}
              <path d={`M${x + w * 0.1} ${bottom} L${x + w * 0.9} ${bottom} L${x + w} ${h} L${x} ${h} Z`} className="fill-[#2a2f3a]" />
              <path d={`M${x + w * 0.22} ${bottom} L${cx} ${bottom - h * 0.1} L${x + w * 0.78} ${bottom}`} className="fill-[#1f232c]" />
              {/* кристалл */}
              <path d={`M${cx} ${top} L${x + w * 0.92} ${mid - h * 0.06} L${cx} ${bottom + h * 0.02} L${x + w * 0.08} ${mid - h * 0.06} Z`} className="crystal-body" />
              <path d={`M${cx} ${top} L${x + w * 0.92} ${mid - h * 0.06} L${cx} ${mid - h * 0.02} Z`} className="crystal-face" />
            </g>
          );
        })}
      </svg>
      {label && <span className="text-xs text-muted">{label}</span>}
    </span>
  );
}
