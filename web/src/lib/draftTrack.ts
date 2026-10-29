// Слежение за слотами экрана пиков между кадрами: стабилизация, пропавшие герои (конфликт пиков → бан).
//
// В ранговом All Pick пики раунда скрыты от врага до его конца. Если обе команды выбрали одного героя,
// он уходит в бан, а выбравшие его пикают заново: герой исчезает из слота, в котором только что стоял.
// Пик в All Pick не меняется после выбора, поэтому герой, стабильно стоявший в слоте и пропавший из него,
// считается забаненным (авто-бан), пока снова не появится в каком-нибудь слоте.
export type SlotLike = { team: "radiant" | "dire"; idx: number; heroId: number | null; empty?: boolean; score?: number | null; margin?: number | null };
type SlotState = number | "E" | "U"; // герой, пустой слот, не прочитан
export type TrackState = {
  seen: Map<string, { state: SlotState; n: number }>; // подряд одинаковых кадров по слоту
  held: Map<string, number>; // герой, стабильно показанный в слоте
};
export const STABLE_FRAMES = 2; // герой принимается после стольких кадров подряд…
// …или с первого кадра, если чтение уверенное: на 247 чтениях с сохранённых кадров при score ≥ 0.6 и отрыве ≥ 0.15
// уверенных 84% и ни одной ошибки (единственная ошибка за всё время была 0.52/0.12). Вместе с опросом раз в полсекунды
// на стадии пиков герой появляется в пикере меньше чем через секунду после пика.
export const CONFIDENT_SCORE = 0.6, CONFIDENT_MARGIN = 0.15;
const confident = (sl: SlotLike) => (sl.score ?? 0) >= CONFIDENT_SCORE && (sl.margin ?? 0) >= CONFIDENT_MARGIN;
// Герой пропал, если слот столько кадров подряд пуст или показывает другого героя. Нечитаемый слот (подсветка, оверлей)
// бывает и при стоящем в нём герое, поэтому для него ждём дольше.
export const GONE_FRAMES = 3, GONE_UNKNOWN_FRAMES = 6;

export const newTrackState = (): TrackState => ({ seen: new Map(), held: new Map() });

export type TrackResult = {
  stable: SlotLike[];
  enemiesSeen: number[];
  alliesSeen: number[];
  ownSeen: number | null;
  gone: number[]; // пропали из слота и нигде не видны: конфликт пиков, бан
  conflict: number[]; // видны сразу у обеих команд: конфликт пиков, бан
};

/**
 * picking=false на стадии стратегии и дальше: пики уже закрыты, пропасть герой не может, а портреты там меняются
 * (арканы, персоны, значок уровня в своём слоте), поэтому авто-бан не считаем и память слотов не трогаем.
 * На реальных матчах без этого свой герой и союзник уходили в баны через 6 кадров стратегии.
 */
export function trackFrame(st: TrackState, slots: SlotLike[], mine: "radiant" | "dire", mySlot: number | null, picking = true): TrackResult {
  const stable: SlotLike[] = [];
  const replaced: number[] = []; // прежние герои слотов, в которых стабильно встал другой герой
  for (const sl of slots) {
    const key = `${sl.team}${sl.idx}`;
    const state: SlotState = sl.heroId ?? (sl.empty ? "E" : "U");
    const prev = st.seen.get(key);
    const n = prev && prev.state === state ? prev.n + 1 : 1;
    st.seen.set(key, { state, n });
    if (sl.heroId && (n >= STABLE_FRAMES || confident(sl))) {
      stable.push(sl);
      if (picking) {
        const was = st.held.get(key);
        if (was !== undefined && was !== sl.heroId) replaced.push(was);
        st.held.set(key, sl.heroId);
      }
    }
  }
  const visible = new Set(stable.map((s) => s.heroId as number));
  const gone = new Set<number>();
  for (const hero of replaced) if (!visible.has(hero)) gone.add(hero);
  if (picking) for (const [key, hero] of st.held) {
    const cur = st.seen.get(key);
    if (!cur || cur.state === hero || cur.n < (cur.state === "U" ? GONE_UNKNOWN_FRAMES : GONE_FRAMES)) continue;
    st.held.delete(key);
    if (!visible.has(hero)) gone.add(hero);
  }
  const enemySet = new Set(stable.filter((x) => x.team !== mine).map((x) => x.heroId as number));
  const allySet = new Set(stable.filter((x) => x.team === mine).map((x) => x.heroId as number));
  const conflict = picking ? [...enemySet].filter((id) => allySet.has(id)) : [];
  for (const id of conflict) { enemySet.delete(id); allySet.delete(id); }
  const ownSlot = mySlot === null ? null : stable.find((x) => x.team === mine && x.idx === mySlot);
  const ownSeen = ownSlot && allySet.has(ownSlot.heroId as number) ? (ownSlot.heroId as number) : null;
  return { stable, enemiesSeen: [...enemySet], alliesSeen: [...allySet].filter((id) => id !== ownSeen), ownSeen, gone: [...gone], conflict };
}
