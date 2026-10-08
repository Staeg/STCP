/** Career titles, earned by total gold extracted across all runs. Purely for bragging. */
export const TITLES: { minGold: number; title: string }[] = [
  { minGold: 0, title: 'Nobody' },
  { minGold: 100, title: 'Scavenger' },
  { minGold: 300, title: 'Delver' },
  { minGold: 700, title: 'Treasure-Seeker' },
  { minGold: 1500, title: 'Gilded' },
  { minGold: 3000, title: 'Legend of the Deep' },
];

export function titleFor(totalGold: number): string {
  let t = TITLES[0].title;
  for (const x of TITLES) if (totalGold >= x.minGold) t = x.title;
  return t;
}

/** Gold needed for the next title, or null at the top. */
export function nextTitle(totalGold: number): { title: string; at: number } | null {
  const next = TITLES.find((x) => x.minGold > totalGold);
  return next ? { title: next.title, at: next.minGold } : null;
}

export interface CareerStats {
  /** Total gold extracted. */
  gold: number;
  runs: number;
  escapes: number;
  /** Most gold extracted in a single run. */
  best: number;
}

export interface LeaderboardEntry extends CareerStats {
  name: string;
  title: string;
}
