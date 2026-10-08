import { EXIT_OPENS_AT } from '../content/constants';
import { Rng } from '../rng';
import type { PlayerView, RoomView } from '../sim/views';
import type { Intent } from '../sim/world';
import { botUseItem, botVote } from './looter';

/**
 * Exploration brain for bots. It only ever sees its own fog-filtered PlayerView,
 * so bots play by the same information rules as humans.
 */
export interface BotMemory {
  rng: Rng;
  /** 0.2–0.8. Greedier bots explore longer before heading to the rendezvous. */
  greed: number;
  /** Game time at which the bot starts heading for the exit. */
  returnAt: number;
  /** Bots pause briefly in each room, as a human would. */
  thinkUntil: number;
  /** Combat: which round we're deciding for, and when we'll commit. */
  combatKey: string;
  decideAt: number;
}

export function createBotMemory(seed: number): BotMemory {
  const rng = new Rng(seed);
  const greed = rng.float(0.2, 0.8);
  // 0.2 → 7:00 … 0.8 → 11:00. Greedy bots are often late, by design.
  const returnAt = EXIT_OPENS_AT - 180 + (greed - 0.2) / 0.6 * 240;
  return { rng, greed, returnAt, thinkUntil: 0, combatKey: '', decideAt: 0 };
}

export function botThink(view: PlayerView, mem: BotMemory): Intent | null {
  const you = view.you;
  if (view.phase !== 'running' || you.pos.kind !== 'room' || you.path.length > 0) return null;
  if (view.time < mem.thinkUntil) return null;
  mem.thinkUntil = view.time + mem.rng.float(0.4, 1.6);

  const here = you.pos.room;
  // Get a downed ally in this room back up before anything else.
  const downed = view.allies.find((a) => a.live && a.downed && !a.dead && a.pos.kind === 'room' && a.pos.room === here);
  if (downed) return { type: 'revive', target: downed.id };
  const vote = botVote(view);
  if (vote !== undefined) return vote;
  const use = botUseItem(view);
  if (use) return use;

  const exit = view.rooms.find((r) => r.kind === 'exit');
  if (exit && here === exit.id) return null;
  const costs = viewDistances(view, here);

  if (exit && view.time >= mem.returnAt) {
    if (costs.has(exit.id)) return { type: 'goto', room: exit.id };
    // Route unknown: push into the unexplored room that looks closest to the exit.
    const frontier = frontierRooms(view, costs);
    if (frontier.length) {
      const best = minBy(frontier, (r) => Math.hypot(r.x - exit.x, r.y - exit.y) + costs.get(r.id)! * 4);
      return { type: 'goto', room: best.id };
    }
    return null;
  }

  // Explore: nearest frontier, with noise. Prefer exits other heroes haven't chalked, so bots spread out.
  const chalked = new Set(view.chalk.find((c) => c.room === here)?.marks.filter((m) => m.heroId !== you.id).map((m) => m.corridor));
  const frontier = frontierRooms(view, costs);
  if (frontier.length === 0) return exit && costs.has(exit.id) ? { type: 'goto', room: exit.id } : null;
  const roomById = new Map(view.rooms.map((r) => [r.id, r]));
  const best = minBy(frontier, (r) => {
    let score = costs.get(r.id)! + mem.rng.float(0, 6) + (r.threat ?? 0) * 3;
    const firstCorridor = firstStepCorridor(view, here, r.id, costs, roomById);
    if (firstCorridor !== null && chalked.has(firstCorridor)) score += 6;
    return score;
  });
  return { type: 'goto', room: best.id };
}

function frontierRooms(view: PlayerView, costs: Map<number, number>): RoomView[] {
  return view.rooms.filter((r) => r.knowledge !== 'explored' && r.kind !== 'exit' && costs.has(r.id));
}

/** Dijkstra over the corridors in a view. */
export function viewDistances(view: PlayerView, start: number): Map<number, number> {
  const adj = new Map<number, { to: number; len: number }[]>();
  for (const c of view.corridors) {
    (adj.get(c.a) ?? adj.set(c.a, []).get(c.a)!).push({ to: c.b, len: c.length });
    (adj.get(c.b) ?? adj.set(c.b, []).get(c.b)!).push({ to: c.a, len: c.length });
  }
  const dist = new Map<number, number>([[start, 0]]);
  const done = new Set<number>();
  while (true) {
    let cur = -1;
    let best = Infinity;
    for (const [room, cost] of dist) if (!done.has(room) && cost < best) [cur, best] = [room, cost];
    if (cur === -1) return dist;
    done.add(cur);
    for (const e of adj.get(cur) ?? []) {
      if (best + e.len < (dist.get(e.to) ?? Infinity)) dist.set(e.to, best + e.len);
    }
  }
}

/** The corridor out of `from` on a shortest path toward `to`. */
function firstStepCorridor(
  view: PlayerView, from: number, to: number, costs: Map<number, number>, rooms: Map<number, RoomView>,
): number | null {
  // Walk back from `to` along decreasing cost until we reach a neighbour of `from`.
  let cur = to;
  for (let guard = 0; guard < 64; guard++) {
    const room = rooms.get(cur);
    if (!room) return null;
    let stepped = false;
    for (const cid of room.corridors) {
      const c = view.corridors.find((x) => x.id === cid);
      if (!c) continue;
      const prev = c.a === cur ? c.b : c.a;
      if (Math.abs((costs.get(prev) ?? Infinity) + c.length - costs.get(cur)!) < 1e-6) {
        if (prev === from) return c.id;
        cur = prev;
        stepped = true;
        break;
      }
    }
    if (!stepped) return null;
  }
  return null;
}

function minBy<T>(arr: T[], f: (x: T) => number): T {
  let best = arr[0];
  let bestV = f(best);
  for (let i = 1; i < arr.length; i++) {
    const v = f(arr[i]);
    if (v < bestV) [best, bestV] = [arr[i], v];
  }
  return best;
}
