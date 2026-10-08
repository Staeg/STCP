import { COLLAPSE_AT, EXIT_OPENS_AT, LIGHT_DIM, tierAt } from '../content/constants';
import type { Corridor, RoomKind } from '../dungeon/gen';
import type { ClassId } from '../content/classes';
import { knowsCorridor, type Hero, type HeroPos, type World, type WorldPhase } from './world';

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

export interface AllyView {
  id: string;
  name: string;
  cls: ClassId;
  color: string;
  isBot: boolean;
  /** True if you can see them right now; otherwise `pos` is where you last saw them. */
  live: boolean;
  pos: HeroPos;
  seenAt: number;
}

export interface ChalkView {
  room: number;
  marks: { heroId: string; corridor: number }[];
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
  allies: AllyView[];
  chalk: ChalkView[];
  ghostCorridors: Corridor[];
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

  const allies: AllyView[] = [];
  for (const [id, sighting] of Object.entries(you.lastKnown)) {
    const h = world.heroes[id];
    if (!h) continue;
    const live = sighting.time === world.time;
    allies.push({ id, name: h.name, cls: h.cls, color: h.color, isBot: h.isBot, live, pos: { ...sighting.pos }, seenAt: sighting.time });
    // Make sure the client can place them, even in a room you only know the position of.
    for (const r of posRooms(sighting.pos)) roomIds.add(r);
  }
  const extraCorridors = allies
    .map((a) => (a.pos.kind === 'corridor' ? d.corridors[a.pos.corridor] : null))
    .filter((c): c is Corridor => !!c && !corridors.includes(c));

  const chalk: ChalkView[] = Object.entries(you.knownChalk).map(([room, marks]) => ({
    room: Number(room),
    marks: Object.entries(marks).map(([heroId, corridor]) => ({ heroId, corridor })),
  }));
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
    allies,
    chalk,
    /** Corridors an ally was seen in that you don't otherwise know; position only. */
    ghostCorridors: extraCorridors,
  };
}

function posRooms(pos: HeroPos): number[] {
  return pos.kind === 'room' ? [pos.room] : [pos.from, pos.to];
}
