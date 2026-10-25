export type Attr = "str" | "agi" | "int" | "all";
export type Hero = { id: number; name: string; short: string; attr: Attr };

export type PairStat = { h: number; n: number; w: number; s: number };
export type Matchup = { heroId: number; matchCountWith: number; matchCountVs: number; with: PairStat[]; vs: PairStat[] };

export type MidMeta = { heroId: number; name: string; midGames: number; midWins: number; allGames: number; midRate: number; midWinrate: number };

export type PoolEntry = { heroId: number; name: string; games: number; wins: number; midGames: number; midWins: number; lastPlayed: number; byRole?: Record<string, { games: number; wins: number }> };
export type RoleMetaEntry = { heroId: number; games: number; wins: number; winrate: number; rate: number };

export type PersonalPair = { role?: number; own: number; other: number; ally: boolean; games: number; wins: number };

export type Role = 1 | 2 | 3 | 4 | 5;
export type Pick = { id: number; role: Role | null };   // role null = не задана, будет предсказана
export type PoolOverride = { add: number[]; remove: number[] }; // ручные правки пула (хранятся в браузере)
export type DraftInput = { bans: number[]; enemies: Pick[]; allies: Pick[]; pool?: PoolOverride; role?: Role };
export type HeroPositions = { heroId: number; name: string; games: number; p: Record<"1" | "2" | "3" | "4" | "5", number> };
export type RoleGuess = { id: number; role: Role; prob: number; locked: boolean };

export type Reason = { kind: "vs" | "with" | "base"; heroId?: number; name: string; value: number; games?: number; laneOpp?: boolean };

export type PersonalNote = { heroId: number; name: string; ally: boolean; games: number; wins: number };

export type Candidate = {
  heroId: number;
  name: string;
  short: string;
  draftScore: number;      // estimated winrate in this draft, meta only (%)
  base: number;            // hero base mid winrate at Divine/Immortal (%)
  vsTotal: number;         // sum of counter contributions (pp)
  withTotal: number;       // sum of synergy contributions (pp)
  reasons: Reason[];
  poolStatus: "pool" | "familiar" | "outside";
  midGames: number;
  midWins: number;
  personalWinrate: number | null; // %
  personalAdj: number;     // pp adjustment from personal results
  finalScore: number;      // draftScore + personalAdj (%)
  midRate: number;         // share of this hero's games played mid at Divine/Immortal
  personalNotes: PersonalNote[];
};
