import { Rng } from '../rng';
import { isConscious, monstersIn, nextUp, resolveChoice, risenSt, startTimers, takeTurn, unitId, type Choice, type Encounter } from './combat';
import type { World } from './world';

/** How many upcoming turns the fight's timeline shows (user, 2026-10-14: a fixed count, so the strip keeps its size). */
export const TIMELINE_TURNS = 12;

/** One upcoming turn on a fight's timeline. */
export interface TimelineTurn {
  /** Whose turn. */
  id: string;
  /** Which of that unit's turns in this fight (0 = its first): with `id`, it names the turn as the timeline shifts. */
  n: number;
  /** Game time it comes. */
  at: number;
  /** A hero's move then: what they picked, or (`auto`) what they'll fall back on. */
  choice?: Choice;
  auto?: boolean;
  /** Stunned: the turn is skipped. */
  stunned?: boolean;
  /** Only happens with some of the dice (a dodge, a stun, a flee): the two extremes disagree on who's still standing. */
  maybe?: boolean;
}

/** Dice that always roll the same: every roll at its lowest (every chance comes off) or its highest (none does). */
function fixedRng(roll: number): Rng {
  const rng = new Rng(0);
  rng.next = () => roll;
  return rng;
}

/** Play the fight in `room` forward on a copy of the world, with fixed dice, and list the next `count` turns. */
function playOut(world: World, room: number, roll: number, count: number): TimelineTurn[] {
  const { rng, mindRng, chronicle, ...rest } = world;
  const sim: World = { ...structuredClone(rest), rng: fixedRng(roll), mindRng: fixedRng(roll), chronicle: [] };
  // Only this fight plays on.
  for (const k of Object.keys(sim.encounters)) if (Number(k) !== room) delete sim.encounters[Number(k)];
  const enc: Encounter = sim.encounters[room];
  const out: TimelineTurn[] = [];
  for (let guard = 0; guard < count * 4 && out.length < count; guard++) {
    if (sim.encounters[room] !== enc || monstersIn(sim, room).length === 0 || !enc.heroes.some((id) => isConscious(sim.heroes[id]))) break;
    startTimers(sim, enc);
    const unit = nextUp(sim, enc, true);
    if (!unit) break;
    const id = unitId(unit);
    const at = enc.next[id];
    sim.time = Math.max(sim.time, at);
    const st = unit.kind === 'hero' ? unit.h.st : unit.kind === 'monster' ? unit.m.st : risenSt(sim, unit.r);
    const turn: TimelineTurn = { id, n: enc.turns?.[id] ?? 0, at };
    if (st.stun) turn.stunned = true;
    if (unit.kind === 'hero') {
      const { choice, auto } = resolveChoice(sim, enc, unit.h);
      turn.choice = choice;
      if (auto) turn.auto = true;
    }
    out.push(turn);
    takeTurn(sim, enc, unit);
  }
  return out;
}

const cache = new WeakMap<Encounter, { key: string; turns: TimelineTurn[] }>();

/**
 * The fight's next turns, if every hero does what they've picked (and then their default), with every haste and delay
 * those moves cause. The dice are played at both extremes; a turn only one of them reaches is `maybe`.
 * Cached per fight until something in it changes.
 */
export function fightTimeline(world: World, enc: Encounter, count = TIMELINE_TURNS): TimelineTurn[] {
  const key = JSON.stringify([
    enc.seq, enc.choices, enc.next, enc.heroes, enc.back, enc.front, Math.floor(world.time),
    enc.heroes.map((id) => world.heroes[id].downedAt), monstersIn(world, enc.room).map((m) => m.id),
  ]);
  const hit = cache.get(enc);
  if (hit && hit.key === key) return hit.turns;
  const low = playOut(world, enc.room, 0, count);
  const high = playOut(world, enc.room, 1 - 1e-9, count);
  // The run where no chance comes off sets the times; turns only the other one reaches come in as maybes.
  const name = (t: TimelineTurn) => `${t.id}#${t.n}`;
  const lowNames = new Set(low.map(name));
  const highNames = new Set(high.map(name));
  // A turn past the end of the shorter list isn't in doubt, just out of sight.
  const lastHigh = high.at(-1)?.at ?? Infinity;
  const lastLow = low.at(-1)?.at ?? Infinity;
  const turns = [
    ...high.map((t) => (!lowNames.has(name(t)) && (low.length < count || t.at <= lastLow) ? { ...t, maybe: true } : t)),
    ...low.filter((t) => !highNames.has(name(t)) && (high.length < count || t.at <= lastHigh)).map((t) => ({ ...t, maybe: true })),
  ].sort((a, b) => a.at - b.at).slice(0, count);
  cache.set(enc, { key, turns });
  return turns;
}
