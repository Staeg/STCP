import { Rng } from '../rng';

/** The start room is also the exit (the rendezvous). Secret rooms stay sealed until their tier (see `secrets`). */
export type RoomKind = 'exit' | 'normal' | 'secret';

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
  /** The way into a secret room (drawn golden). */
  secret?: boolean;
}

/**
 * A sealed way into a secret room. The room is in `rooms` from the start, with no corridors; at `tier` (or earlier, if a
 * hero crawls in) the corridor is added to `corridors` and to both rooms. Its id is settled when it opens.
 */
export interface SecretPassage {
  room: number;
  /** The one ordinary room it opens off (never the exit). */
  host: number;
  corridor: Corridor;
  tier: number;
  open: boolean;
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
  /** Secret rooms, in the order their passages open. */
  secrets: SecretPassage[];
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

/** Secret rooms (user, 2026-10-10): the tier each one opens at, in opening order. */
export const SECRET_TIERS = [4, 4, 5, 5, 5, 5];
const SECRET_NAMES = [
  'The Sealed Hoard', 'The Hidden Treasury', 'The Gilded Sanctum', 'The Lost Sacristy', 'The Veiled Reliquary',
  'The Buried Coffers', 'The Forgotten Strongroom', 'The Walled-Up Chapel',
];

/** How far a room may sit off its grid cell's centre. Under CELL / 4, so a corridor's compass direction is never in doubt. */
const JITTER = 18;

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
      x: gx * CELL + CELL / 2 + rng.float(-JITTER, JITTER),
      y: gy * CELL + CELL / 2 + rng.float(-JITTER, JITTER),
      name: '', kind: 'normal', corridors: [],
    });
    deg.push(0);
    cellRoom.set(key(gx, gy), id);
    return id;
  };
  const connect = (a: number, b: number) => {
    // Hard rule: corridors only join grid neighbours, so every room has at most one exit north, east, south and west.
    if (Math.abs(rooms[a].gx - rooms[b].gx) + Math.abs(rooms[a].gy - rooms[b].gy) !== 1) throw new Error('corridor between non-neighbours');
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

  const secrets = placeSecrets(seed, rooms, cellRoom, corridors.length, exit);
  if (!secrets) return null;
  return { seed, rooms, corridors, entrance, exit, width: GRID_W * CELL, height: GRID_H * CELL, secrets };
}

/**
 * Secret rooms take empty grid cells beside the dungeon, each sealed off from exactly one ordinary room (never the
 * exit). Every empty cell next to such a room is equally likely. Their own RNG leaves the rest of the layout as it was.
 */
function placeSecrets(seed: number, rooms: Room[], cellRoom: Map<number, number>, firstCorridor: number, exit: number): SecretPassage[] | null {
  const rng = new Rng(seed ^ 0x6a09e667);
  const key = (gx: number, gy: number) => gy * GRID_W + gx;
  const hostsOf = (gx: number, gy: number) => DIRS
    .map(([dx, dy]) => cellRoom.get(key(gx + dx, gy + dy)))
    .filter((id, i): id is number => {
      const [dx, dy] = DIRS[i];
      const x = gx + dx;
      const y = gy + dy;
      return id !== undefined && x >= 0 && y >= 0 && x < GRID_W && y < GRID_H && id !== exit;
    });
  const cells: [number, number][] = [];
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) if (!cellRoom.has(key(gx, gy)) && hostsOf(gx, gy).length) cells.push([gx, gy]);
  }
  if (cells.length < SECRET_TIERS.length) return null;
  const picked = rng.shuffle(cells).slice(0, SECRET_TIERS.length);
  const names = rng.shuffle([...SECRET_NAMES]);
  return picked.map(([gx, gy], i) => {
    const id = rooms.length;
    rooms.push({
      id, gx, gy,
      x: gx * CELL + CELL / 2 + rng.float(-JITTER, JITTER),
      y: gy * CELL + CELL / 2 + rng.float(-JITTER, JITTER),
      name: names[i], kind: 'secret', corridors: [],
    });
    const host = rng.pick(hostsOf(gx, gy));
    return { room: id, host, corridor: { id: firstCorridor + i, a: host, b: id, length: CORRIDOR_TIME, secret: true }, tier: SECRET_TIERS[i], open: false };
  });
}

/** Open every sealed passage due by `tier`. Returns the ones that just opened. */
export function openSecrets(d: Dungeon, tier: number): SecretPassage[] {
  const opened: SecretPassage[] = [];
  for (const s of d.secrets) {
    if (s.open || s.tier > tier) continue;
    openSecret(d, s);
    opened.push(s);
  }
  return opened;
}

/** Open one sealed passage now, whatever its tier (the Crawlspace can break into one early). */
export function openSecret(d: Dungeon, s: SecretPassage) {
  if (s.open) return;
  s.open = true;
  // Corridor ids are indexes into `corridors`, so it takes the next one free (passages may open out of order).
  s.corridor.id = d.corridors.length;
  d.corridors.push(s.corridor);
  d.rooms[s.host].corridors.push(s.corridor.id);
  d.rooms[s.room].corridors.push(s.corridor.id);
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

export type Dir = 'north' | 'east' | 'south' | 'west';
export const DIR_NAMES: Dir[] = ['north', 'east', 'south', 'west'];

/** Compass direction from one room to a neighbour, from their positions (works on the client's room views too). */
export function dirBetween(from: { x: number; y: number }, to: { x: number; y: number }): Dir {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'east' : 'west';
  return dy > 0 ? 'south' : 'north';
}

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
