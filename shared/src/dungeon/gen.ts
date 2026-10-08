import { Rng } from '../rng';

export type RoomKind = 'entrance' | 'exit' | 'normal';

export interface Room {
  id: number;
  /** Grid cell (generation only, but handy for debugging). */
  gx: number;
  gy: number;
  /** World position, in map units. */
  x: number;
  y: number;
  name: string;
  kind: RoomKind;
  /** Corridor ids touching this room. */
  corridors: number[];
}

export interface Corridor {
  id: number;
  a: number;
  b: number;
  /** Seconds to walk end to end. */
  length: number;
}

export interface Dungeon {
  seed: number;
  rooms: Room[];
  corridors: Corridor[];
  entrance: number;
  exit: number;
  width: number;
  height: number;
}

export const GRID_W = 8;
export const GRID_H = 6;
export const CELL = 100;
export const ROOM_COUNT = { min: 25, max: 35 };
export const EXIT_DISTANCE = { min: 5, max: 7 };
export const CROSSROADS_COUNT = { min: 3, max: 6 };
export const CORRIDOR_LENGTH = { min: 3, max: 8 };

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

const ADJECTIVES = [
  'Flooded', 'Collapsed', 'Silent', 'Rotting', 'Gilded', 'Weeping', 'Hollow', 'Sunken',
  'Ashen', 'Forgotten', 'Bleeding', 'Echoing', 'Narrow', 'Crooked', 'Drowned', 'Smoldering',
];
const NOUNS = [
  'Ossuary', 'Crypt', 'Cistern', 'Chapel', 'Gallery', 'Vault', 'Larder', 'Barracks', 'Shrine',
  'Catacomb', 'Well', 'Library', 'Kennel', 'Forge', 'Chamber', 'Hall', 'Undercroft', 'Reliquary',
  'Cellar', 'Pit', 'Scriptorium', 'Refectory',
];

export function generateDungeon(seed: number): Dungeon {
  const rng = new Rng(seed);
  for (let attempt = 0; attempt < 500; attempt++) {
    const d = tryGenerate(rng, seed);
    if (d) return d;
  }
  throw new Error(`Dungeon generation failed for seed ${seed}`);
}

function tryGenerate(rng: Rng, seed: number): Dungeon | null {
  const target = rng.int(ROOM_COUNT.min, ROOM_COUNT.max);
  const key = (gx: number, gy: number) => gy * GRID_W + gx;
  const cellRoom = new Map<number, number>();
  const rooms: Room[] = [];
  const deg: number[] = [];
  const edges: [number, number][] = [];
  const edgeSet = new Set<string>();

  const addRoom = (gx: number, gy: number): number => {
    const id = rooms.length;
    rooms.push({
      id, gx, gy,
      x: gx * CELL + CELL / 2 + rng.float(-22, 22),
      y: gy * CELL + CELL / 2 + rng.float(-22, 22),
      name: '', kind: 'normal', corridors: [],
    });
    deg.push(0);
    cellRoom.set(key(gx, gy), id);
    return id;
  };
  const connect = (a: number, b: number) => {
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (edgeSet.has(k)) return;
    edgeSet.add(k);
    edges.push([a, b]);
    deg[a]++;
    deg[b]++;
  };

  // Grow a tree from the west edge, discouraging bushy nodes so we get winding paths.
  const entrance = addRoom(0, rng.int(1, GRID_H - 2));
  const frontier = [entrance];
  while (rooms.length < target && frontier.length) {
    const idx = rng.int(0, frontier.length - 1);
    const r = rooms[frontier[idx]];
    const free = DIRS.map(([dx, dy]) => [r.gx + dx, r.gy + dy] as const).filter(
      ([x, y]) => x >= 0 && y >= 0 && x < GRID_W && y < GRID_H && !cellRoom.has(key(x, y)),
    );
    if (free.length === 0) {
      frontier.splice(idx, 1);
      continue;
    }
    if (deg[r.id] >= 3 && rng.chance(0.9)) continue;
    if (deg[r.id] >= 2 && rng.chance(0.6)) continue;
    const [x, y] = rng.pick(free);
    const n = addRoom(x, y);
    connect(r.id, n);
    frontier.push(n);
  }

  // Add a few loops between orthogonal neighbours. Orthogonal-only keeps the graph planar.
  for (const r of rooms) {
    for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
      const n = cellRoom.get(key(r.gx + dx, r.gy + dy));
      if (n !== undefined && r.gx + dx < GRID_W && rng.chance(0.12)) connect(r.id, n);
    }
  }

  // Exit: a room at the right hop distance, preferring the far end.
  const adj: number[][] = rooms.map(() => []);
  for (const [a, b] of edges) {
    adj[a].push(b);
    adj[b].push(a);
  }
  const dist = bfs(adj, entrance);
  const candidates = rooms.filter((r) => dist[r.id] >= EXIT_DISTANCE.min && dist[r.id] <= EXIT_DISTANCE.max);
  if (candidates.length === 0) return null;
  const far = candidates.filter((r) => dist[r.id] >= EXIT_DISTANCE.max - 1);
  const exit = rng.pick(far.length ? far : candidates).id;

  const crossroads = deg.filter((d) => d >= 3).length;
  if (crossroads < CROSSROADS_COUNT.min || crossroads > CROSSROADS_COUNT.max) return null;

  // Names
  const names = rng.shuffle(ADJECTIVES.flatMap((a) => NOUNS.map((n) => `${a} ${n}`)));
  rooms.forEach((r, i) => (r.name = names[i]));
  rooms[entrance].kind = 'entrance';
  rooms[entrance].name = 'The Ruined Gate';
  rooms[exit].kind = 'exit';
  rooms[exit].name = 'The Rendezvous';

  const corridors: Corridor[] = edges.map(([a, b], id) => {
    const ra = rooms[a];
    const rb = rooms[b];
    const d = Math.hypot(ra.x - rb.x, ra.y - rb.y) / CELL;
    const length = clamp(Math.round(d * 5 * 2) / 2, CORRIDOR_LENGTH.min, CORRIDOR_LENGTH.max);
    ra.corridors.push(id);
    rb.corridors.push(id);
    return { id, a, b, length };
  });

  return { seed, rooms, corridors, entrance, exit, width: GRID_W * CELL, height: GRID_H * CELL };
}

function bfs(adj: number[][], start: number): number[] {
  const dist = adj.map(() => Infinity);
  dist[start] = 0;
  const q = [start];
  while (q.length) {
    const cur = q.shift()!;
    for (const n of adj[cur]) {
      if (dist[n] === Infinity) {
        dist[n] = dist[cur] + 1;
        q.push(n);
      }
    }
  }
  return dist;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// ---- Graph helpers used by the sim and the client ----

export function otherEnd(c: Corridor, room: number): number {
  return c.a === room ? c.b : c.a;
}

export function corridorBetween(d: Dungeon, a: number, b: number): Corridor | undefined {
  return d.rooms[a].corridors.map((id) => d.corridors[id]).find((c) => otherEnd(c, a) === b);
}

export function neighbours(d: Dungeon, room: number): number[] {
  return d.rooms[room].corridors.map((id) => otherEnd(d.corridors[id], room));
}

export function isCrossroads(d: Dungeon, room: number): boolean {
  return d.rooms[room].corridors.length >= 3;
}

/** Hop distances from `start` over the full graph. */
export function hopDistances(d: Dungeon, start: number): number[] {
  return bfs(d.rooms.map((r) => neighbours(d, r.id)), start);
}
