"use client";
// Прогноз на игру после полного драфта: шанс команды 5 на 5 и твоя линия (1 на 1 на миде, 2 на 2 на краях).
// Появляется, когда известны все десять героев и твой пик. Считает /api/pregame (lib/pregame.ts).
import { useEffect, useState } from "react";
import type { Hero, Pick, Role } from "@/lib/types";
import type { Pregame } from "@/lib/pregame";
import { Card, CardTitle, Hint } from "@/components/ui";
import Crystals from "@/components/Crystals";

const icon = (short: string) => `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/icons/${short}.png`;
const ROLE_NAME: Record<number, string> = { 1: "керри", 2: "мид", 3: "офлейн", 4: "саппорт 4", 5: "саппорт 5" };
const tone = (pct: number, hi: number, lo: number) => (pct >= hi ? "text-good" : pct <= lo ? "text-bad" : "text-foreground");

export default function PreGame({ heroId, role, enemies, allies, team, byId }: { heroId: number; role: Role; enemies: Pick[]; allies: Pick[]; team: "radiant" | "dire" | null; byId: Map<number, Hero> }) {
  const [p, setP] = useState<Pregame | null>(null);
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify({ heroId, role, team, e: enemies.map((x) => [x.id, x.role]), a: allies.map((x) => [x.id, x.role]) });
  useEffect(() => {
    let alive = true;
    setBusy(true);
    fetch("/api/pregame", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chosenHeroId: heroId, role, team, enemies, allies }) })
      .then((r) => r.json()).catch(() => null)
      .then((j) => { if (!alive) return; setP(j?.ok ? j.pregame : null); setBusy(false); });
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const heroes = (xs: { id: number; role: Role }[]) => xs.map((x) => { const h = byId.get(x.id); return h ? <img key={x.id} src={icon(h.short)} alt="" title={`${h.name}, ${ROLE_NAME[x.role]}`} className="h-6 w-6 rounded" /> : null; });
  return (
    <Card tone="accent">
      <CardTitle hint="Прогноз по драфту, до первого крипа. Команда: та же оценка, что у пикера, для каждого из пяти союзников, усреднённая. Линия: настоящие исходы линий этих героев на этих позициях у Divine/Immortal. Драфт решает меньше, чем игра, поэтому цифры всегда рядом с серединой: смотри на слова, а не на проценты.">Прогноз на игру</CardTitle>
      {busy && !p ? <Crystals size={12} label="считаю…" /> : !p ? <p className="text-sm text-muted">Прогноз не посчитался: Stratz не ответил.</p> : (
        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          <div className="rounded-xl bg-panel-2 p-3 flex flex-col gap-1">
            <div className="text-xs text-muted">Команда 5 на 5</div>
            {p.team ? <>
              <div className={`text-lg font-semibold leading-tight ${tone(p.team.pct, 55, 45)}`}>{p.team.words}</div>
              <div className="text-xs text-muted">шанс по драфту {p.team.pct}%</div>
            </> : <div className="text-muted">Посчитается, когда будут видны все герои.</div>}
          </div>
          <div className="rounded-xl bg-panel-2 p-3 flex flex-col gap-1">
            <div className="text-xs text-muted flex items-center gap-1.5">Твоя линия{p.lane && <span>· {p.lane.kind === "1v1" ? "1 на 1" : "2 на 2"}</span>}</div>
            {p.lane ? <>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-ally" />{heroes(p.lane.me)}</span>
                <span className="text-xs text-muted">против</span>
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-enemy" />{heroes(p.lane.them)}</span>
              </div>
              <div className={`text-lg font-semibold leading-tight ${tone(p.lane.pct, 58, 42)}`}>{p.lane.words}</div>
              <div className="text-xs text-muted flex items-center gap-1.5">выигрывается в {p.lane.pct}% линий <Hint align="right" text={`По исходам линий у Divine/Immortal: ${p.lane.kind === "1v1" ? "твой герой на миде против их мидера" : "каждый из вашей пары против каждого из их пары, на этих позициях"}. Самая редкая пара: ${p.lane.lanes.toLocaleString("ru-RU")} линий.`} /></div>
            </> : <div className="text-muted">{p.laneNote ?? "Линия не посчиталась."}</div>}
          </div>
        </div>
      )}
    </Card>
  );
}
