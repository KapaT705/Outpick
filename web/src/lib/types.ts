export type Attr = "str" | "agi" | "int" | "all";
export type HeroTag = "CARRY" | "ESCAPE" | "NUKER" | "INITIATOR" | "DURABLE" | "DISABLER" | "SUPPORT" | "PUSHER";
export type Hero = { id: number; name: string; short: string; attr: Attr; roles?: { r: HeroTag; l: number }[]; attackType?: string | null; complexity?: number | null };

export type PairStat = { h: number; n: number; w: number; s: number };
export type Matchup = { heroId: number; matchCountWith: number; matchCountVs: number; with: PairStat[]; vs: PairStat[] };

export type MidMeta = { heroId: number; name: string; midGames: number; midWins: number; allGames: number; midRate: number; midWinrate: number };

export type PoolEntry = { heroId: number; name: string; games: number; wins: number; midGames: number; midWins: number; lastPlayed: number; byRole?: Record<string, { games: number; wins: number }> };
export type RoleMetaEntry = { heroId: number; games: number; wins: number; winrate: number; rate: number };

export type PersonalPair = { role?: number; own: number; other: number; ally: boolean; games: number; wins: number };

export type Role = 1 | 2 | 3 | 4 | 5;
export type Pick = { id: number; role: Role | null; auto?: boolean; slot?: number }; // role null = не задана, будет предсказана; auto = бан поставлен сам (пропал из слота: конфликт пиков); slot = номер слота в верхней панели (0..4), если герой прочитан с экрана
export type PoolOverride = { add: number[]; remove: number[] }; // ручные правки пула (хранятся в браузере)
export type DraftInput = { bans: number[]; enemies: Pick[]; allies: Pick[]; pool?: PoolOverride; role?: Role; team?: "radiant" | "dire" | null };
export type HeroPositions = { heroId: number; name: string; games: number; p: Record<"1" | "2" | "3" | "4" | "5", number> };
export type RoleGuess = { id: number; role: Role; prob: number; locked: boolean };
/** Соперник по линии: враг, который с наибольшей вероятностью стоит против тебя. */
export type LaneOpponent = { heroId: number; name: string; short: string; role: Role; prob: number; player?: { name: string | null; games: number; wins: number; rolesKnown: boolean } | null };
/** Вероятные пики врага на ещё не занятую роль: самые популярные герои роли за 4 недели, не занятые в драфте. */
export type PredictedPicks = { role: Role; heroes: { heroId: number; name: string; short: string; share: number }[]; player?: string | null }; // player: имя игрока, если прогноз по его истории, иначе по мете
/** Кандидат у Immortal: винрейт и доля пиков на этой роли за 4 недели. */
export type TopStat = { winrate: number; rate: number; games: number };
/** Стадия драфта по числу известных пиков врага: рано — врагам ещё отвечать контрпиком, поздно — контрпикуем мы. */
export type DraftStage = "early" | "mid" | "late";
/** Чего не хватает команде по тегам героев (союзники без тебя). */
export type TeamNeed = { key: HeroTag; label: string; have: number };
/** Кандидат против соперника по линии: вклад матчапа и твой личный счёт против него. */
export type VsLane = { value: number; games: number; personal?: { games: number; wins: number } };

export type Reason = { kind: "vs" | "with" | "base"; heroId?: number; name: string; value: number; games?: number; laneOpp?: boolean };

export type PersonalNote = { heroId: number; name: string; ally: boolean; games: number; wins: number };

export type Candidate = {
  heroId: number;
  name: string;
  short: string;
  draftScore: number;      // estimated winrate in this draft, meta only (%)
  base: number;            // hero base winrate on the role at Immortal (%), shrunk by games
  vsTotal: number;         // sum of counter contributions (pp)
  withTotal: number;       // sum of synergy contributions (pp)
  reasons: Reason[];
  poolStatus: "pool" | "familiar" | "outside";
  midGames: number;
  midWins: number;
  personalWinrate: number | null; // %
  personalAdj: number;     // pp adjustment from personal results
  finalScore: number;      // draftScore + personalAdj (%)
  midRate: number;         // share of this hero's games played on the role at Immortal
  vsLane?: VsLane | null;  // против соперника по линии (если он известен)
  top?: TopStat | null;    // как герой идёт у Immortal на этой роли
  predictedAdj: number;    // поправка за вероятные пики врага на твою линию (pp)
  counterRisk: number;     // насколько героя легко законтрить: средний проигрыш худшим популярным матчапам (pp)
  stageAdj: number;        // поправка за очередь пика: ранний пик штрафуется за риск контрпика (pp)
  needsAdj: number;        // поправка за то, что герой закрывает нехватку команды (контроль, пуш…) (pp)
  personalNotes: PersonalNote[];
};
