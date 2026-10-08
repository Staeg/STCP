import { COLLAPSE_AT, EXIT_OPENS_AT, LIGHT_DIM, tierAt } from '../content/constants';
import type { Corridor, RoomKind } from '../dungeon/gen';
import { knowsCorridor, type Hero, type World, type WorldPhase } from './world';

/** What a hero knows about a room. 'unknown' = a corridor leads there but they haven't glimpsed it. */
export type RoomKnowledge = 'explored' | 'seen' | 'unknown';

export interface RoomView {
  id: number;
  x: number;
  y: number;
  knowledge: RoomKnowledge;
  name?: string;
  kind?: RoomKind;
  /** Known corridor ids only. */
  corridors: number[];
}

export interface PlayerView {
  time: number;
  tier: number;
  exitOpensAt: number;
  collapseAt: number;
  phase: WorldPhase;
  width: number;
  height: number;
  you: Hero;
  dim: boolean;
  rooms: RoomView[];
  corridors: Corridor[];
}

/**
 * Fog-filtered snapshot for one hero. Everything the client gets goes through here,
 * so hidden information never leaves the server.
 */
export function buildView(world: World, heroId: string): PlayerView {
  const d = world.dungeon;
  const you = world.heroes[heroId];
  const corridors = d.corridors.filter((c) => knowsCorridor(you, c));
  const roomIds = new Set<number>(you.seen);
  for (const c of corridors) {
    roomIds.add(c.a);
    roomIds.add(c.b);
  }
  const rooms: RoomView[] = [...roomIds].map((id) => {
    const r = d.rooms[id];
    const knowledge: RoomKnowledge = you.explored.includes(id) ? 'explored' : you.seen.includes(id) ? 'seen' : 'unknown';
    return {
      id,
      x: r.x,
      y: r.y,
      knowledge,
      name: knowledge === 'unknown' ? undefined : r.name,
      kind: knowledge === 'unknown' ? undefined : r.kind,
      corridors: r.corridors.filter((cid) => knowsCorridor(you, d.corridors[cid])),
    };
  });
  return {
    time: world.time,
    tier: tierAt(world.time),
    exitOpensAt: EXIT_OPENS_AT,
    collapseAt: COLLAPSE_AT,
    phase: world.phase,
    width: d.width,
    height: d.height,
    you: structuredClone(you) as Hero,
    dim: you.light < LIGHT_DIM,
    rooms,
    corridors,
  };
}
