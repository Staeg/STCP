import { Rng } from '../rng';

/** The start room is also the exit (the rendezvous). */
export type RoomKind = 'exit' | 'normal';

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
  /** Where everyone starts. Always the same room as `exit`. */
  entrance: number;
  exit: number;
  width: number;
  height: number;
}

export const GRID_W = 10;
export const GRID_H = 7;
export const CELL = 100;
export const ROOM_COUNT = { min: 38, max: 50 };
/** The farthest room is at least this many hops from the start (= the exit). */
export const MIN_DEPTH = 5;
export const CROSSROADS_COUNT = { min: 12, max: 24 };
/** Every corridor takes the same time to walk (the game's 6-second beat). */
export const CORRIDOR_TIME = 6;
/** Chance of an extra tunnel between two orthogonally neighbouring rooms. */
export const LOOP_CHANCE = 0.3;
/** At least this many corridors beyond a tree's (rooms − 1): paths cross and rejoin. */
export const MIN_LOOPS = 6;

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

  // Grow a tree out from the middle, so the start (which is also the exit) sits in the heart of the dungeon.
  const entrance = addRoom(rng.int(4, 5), rng.int(2, 4));
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
    if (deg[r.id] >= 3 && rng.chance(0.75)) continue;
    if (deg[r.id] >= 2 && rng.chance(0.4)) continue;
    const [x, y] = rng.pick(free);
    const n = addRoom(x, y);
    connect(r.id, n);
    frontier.push(n);
  }

  // Plenty of loops between orthogonal neighbours, so paths cross and rejoin. Orthogonal-only keeps the graph planar.
  for (const r of rooms) {
    for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
      const n = cellRoom.get(key(r.gx + dx, r.gy + dy));
      if (n !== undefined && r.gx + dx < GRID_W && rng.chance(LOOP_CHANCE)) connect(r.id, n);
    }
  }

  // You leave the way you came in.
  const adj: number[][] = rooms.map(() => []);
  for (const [a, b] of edges) {
    adj[a].push(b);
    adj[b].push(a);
  }
  const dist = bfs(adj, entrance);
  if (Math.max(...dist) < MIN_DEPTH || edges.length - (rooms.length - 1) < MIN_LOOPS) return null;
  const exit = entrance;

  const crossroads = deg.filter((d) => d >= 3).length;
  if (crossroads < CROSSROADS_COUNT.min || crossroads > CROSSROADS_COUNT.max) return null;

  // Names
  const names = rng.shuffle(ADJECTIVES.flatMap((a) => NOUNS.map((n) => `${a} ${n}`)));
  rooms.forEach((r, i) => (r.name = names[i]));
  rooms[exit].kind = 'exit';
  rooms[exit].name = 'The Ruined Gate';

  const corridors: Corridor[] = edges.map(([a, b], id) => {
    rooms[a].corridors.push(id);
    rooms[b].corridors.push(id);
    return { id, a, b, length: CORRIDOR_TIME };
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

/** "the Silent Crypt", but "The Rendezvous" (names that already carry an article). */
export function theRoom(name: string): string {
  return name.startsWith('The ') ? name : `the ${name}`;
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
