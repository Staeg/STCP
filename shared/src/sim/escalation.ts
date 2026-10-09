import { EXIT_OPENS_AT, tierAt } from '../content/constants';
import { ENEMIES, ESCALATION, type EnemyId } from '../content/enemies';
import { neighbours, otherEnd, theRoom } from '../dungeon/gen';
import { armored, downHero, inDungeon, monstersIn, onHeroInRoom, pickGroup, spawnGroup, type Monster } from './combat';
import { notify } from './notify';
import { chronicle, explore, type World } from './world';

/** A group of monsters that walks the halls. While travelling, its monsters have room = -1. */
export interface Pack {
  id: string;
  monsters: string[];
  room: number;
  /** Travelling to `to`, arriving at `arriveAt`; null when resting in `room`. */
  to: number | null;
  arriveAt: number;
  /** Rest until this time before picking the next room. */
  restUntil: number;
  /** Waves head straight for this room. */
  goal: number | null;
}

/** Everything that makes the dungeon worse over time. Called every tick. */
export function tickEscalation(world: World) {
  const tier = tierAt(world.time);
  if (tier > world.tier) {
    world.tier = tier;
    onTierUp(world, tier);
  }
  movePacks(world);
  if (tier >= 1 && world.time >= world.nextRespawn) {
    world.nextRespawn = world.time + (tier >= 4 ? ESCALATION.respawnEveryLate : ESCALATION.respawnEvery);
    respawn(world, tier);
  }
  if (tier >= 2 && world.time >= world.nextWanderer) {
    world.nextWanderer = world.time + ESCALATION.wandererEvery;
    spawnWanderer(world, tier);
  }
  if (tier >= 3 && world.time >= world.nextCollapse) {
    world.nextCollapse = world.time + ESCALATION.collapseEvery;
    collapseRandomCorridor(world);
  }
  if (world.time >= EXIT_OPENS_AT && world.time >= world.nextWave) {
    world.nextWave = world.time + (tier >= 6 ? ESCALATION.waveEveryLate : ESCALATION.waveEvery);
    spawnWave(world, tier);
  }
}

export const TIER_TEXT: Record<number, string> = {
  1: 'The dead stir again. Cleared rooms can fill back up.',
  2: 'Something walks the halls. Wandering packs roam the dungeon.',
  3: 'The ceiling groans. Tunnels begin to collapse, and Bone Brutes rise.',
  4: 'The air thickens. Torches burn out faster.',
  5: 'THE EXIT IS OPEN. Get to the rendezvous — they are coming for it.',
  6: 'The dungeon is coming down. Waves pour toward the exit.',
};

function onTierUp(world: World, tier: number) {
  chronicle(world, `Tier ${tier}: ${TIER_TEXT[tier] ?? ''}`);
}

// ---------------------------------------------------------------------------

function occupied(world: World, room: number): boolean {
  return Object.values(world.heroes).some((h) => inDungeon(h) && h.pos.kind === 'room' && h.pos.room === room);
}

function liveMonsterCount(world: World): number {
  return Object.keys(world.monsters).length;
}

function monsterCap(world: World): number {
  return ESCALATION.capBase + ESCALATION.capPerTier * world.tier;
}

function groupFor(world: World, tier: number): EnemyId[] {
  const g = pickGroup(world, tier);
  // Bigger groups later on.
  if (tier >= 4 && world.rng.chance(0.5)) return [...g, world.rng.pick(['ghoul', 'crawler'] as EnemyId[])];
  return g;
}

function respawn(world: World, tier: number) {
  const d = world.dungeon;
  for (let i = 0; i < (tier >= 4 ? 2 : 1); i++) {
    if (liveMonsterCount(world) >= monsterCap(world)) return;
    const candidates = d.rooms.filter(
      (r) => r.kind === 'normal' && monstersIn(world, r.id).length === 0 && !occupied(world, r.id) && !world.encounters[r.id],
    );
    if (candidates.length === 0) return;
    spawnGroup(world, world.rng.pick(candidates).id, groupFor(world, tier), tier);
  }
}

function spawnWanderer(world: World, tier: number) {
  if (liveMonsterCount(world) >= monsterCap(world)) return;
  const d = world.dungeon;
  const candidates = d.rooms.filter((r) => r.kind === 'normal' && !occupied(world, r.id) && monstersIn(world, r.id).length === 0);
  if (candidates.length === 0) return;
  const room = world.rng.pick(candidates).id;
  makePack(world, spawnGroup(world, room, groupFor(world, tier), tier), room, null);
}

/** Waves spawn next to the exit (so you get a moment's warning) and march on it. */
function spawnWave(world: World, tier: number) {
  const d = world.dungeon;
  const near = neighbours(d, d.exit).filter((n) => !occupied(world, n) && !corridorCollapsedBetween(world, n, d.exit));
  if (near.length === 0) return;
  const from = world.rng.pick(near);
  const pack = makePack(world, spawnGroup(world, from, groupFor(world, tier), tier), from, d.exit);
  pack.restUntil = world.time + 3;
  world.stats.waves++;
  chronicle(world, 'A wave of monsters marches on the exit.');
}

function makePack(world: World, monsters: Monster[], room: number, goal: number | null): Pack {
  const pack: Pack = {
    id: `p${world.nextId++}`, monsters: monsters.map((m) => m.id), room, to: null, arriveAt: 0,
    restUntil: world.time + world.rng.float(4, 9), goal,
  };
  world.packs[pack.id] = pack;
  return pack;
}

/**
 * A bell rang in `room`: monsters resting in the rooms next to it (through open tunnels, not fighting,
 * no heroes with them) head straight there.
 */
export function lureToward(world: World, room: number) {
  const d = world.dungeon;
  for (const cid of d.rooms[room].corridors) {
    if (world.collapsed.includes(cid)) continue;
    const from = otherEnd(d.corridors[cid], room);
    if (world.encounters[from] || occupied(world, from)) continue;
    const here = monstersIn(world, from);
    if (here.length === 0) continue;
    // Monsters already in a resting pack go with it; any others form a new one.
    const packs = Object.values(world.packs).filter((p) => p.to === null && p.room === from);
    const loose = here.filter((m) => !packs.some((p) => p.monsters.includes(m.id)));
    if (loose.length) packs.push(makePack(world, loose, from, null));
    for (const pack of packs) {
      const members = pack.monsters.map((id) => world.monsters[id]).filter(Boolean);
      pack.to = room;
      pack.arriveAt = world.time + Math.max(...members.map((m) => ENEMIES[m.type].speed)) * ESCALATION.packSlowness;
      for (const m of members) m.room = -1;
    }
  }
}

function movePacks(world: World) {
  const d = world.dungeon;
  for (const pack of Object.values(world.packs)) {
    pack.monsters = pack.monsters.filter((id) => world.monsters[id]);
    if (pack.monsters.length === 0) {
      delete world.packs[pack.id];
      continue;
    }
    const members = pack.monsters.map((id) => world.monsters[id]);
    if (pack.to !== null) {
      if (world.time < pack.arriveAt) continue;
      // Arrive.
      pack.room = pack.to;
      pack.to = null;
      pack.restUntil = world.time + world.rng.float(5, 10);
      for (const m of members) m.room = pack.room;
      const here = Object.values(world.heroes).find((h) => inDungeon(h) && h.pos.kind === 'room' && h.pos.room === pack.room);
      if (here) {
        for (const h of Object.values(world.heroes)) {
          if (inDungeon(h) && h.pos.kind === 'room' && h.pos.room === pack.room) notify(world, h, 'Monsters burst in!');
        }
        onHeroInRoom(world, here, pack.room);
      }
      continue;
    }
    // Resting. Packs stay put while fighting or while heroes are in the room.
    if (world.time < pack.restUntil || world.encounters[pack.room] || occupied(world, pack.room)) continue;
    if (pack.goal !== null && pack.room === pack.goal) continue; // waves hold the exit
    const options = d.rooms[pack.room].corridors
      .map((cid) => d.corridors[cid])
      .filter((c) => !world.collapsed.includes(c.id));
    if (options.length === 0) continue;
    let c = world.rng.pick(options);
    if (pack.goal !== null) {
      const toward = options.find((x) => otherEnd(x, pack.room) === pack.goal);
      if (toward) c = toward;
    } else if (world.tier >= 5 && world.rng.chance(0.4)) {
      // Late game: wanderers drift toward the exit.
      const best = options.sort((a, b) => dist(world, otherEnd(a, pack.room), d.exit) - dist(world, otherEnd(b, pack.room), d.exit))[0];
      c = best;
    }
    pack.to = otherEnd(c, pack.room);
    // A pack moves at its slowest member's Speed.
    pack.arriveAt = world.time + Math.max(...members.map((m) => ENEMIES[m.type].speed)) * ESCALATION.packSlowness;
    for (const m of members) m.room = -1;
  }
}

function dist(world: World, a: number, b: number): number {
  const d = world.dungeon;
  return Math.hypot(d.rooms[a].x - d.rooms[b].x, d.rooms[a].y - d.rooms[b].y);
}

// ---------------------------------------------------------------------------
// Collapses

export function corridorCollapsedBetween(world: World, a: number, b: number): boolean {
  return world.collapsed.some((cid) => {
    const c = world.dungeon.corridors[cid];
    return (c.a === a && c.b === b) || (c.a === b && c.b === a);
  });
}

export function collapseCorridor(world: World, cid: number, reason = 'A tunnel collapses') {
  const d = world.dungeon;
  const c = d.corridors[cid];
  world.collapsed.push(cid);
  world.stats.collapses++;
  chronicle(world, `${reason} between ${theRoom(d.rooms[c.a].name)} and ${theRoom(d.rooms[c.b].name)}.`);
  for (const h of Object.values(world.heroes)) {
    if (!inDungeon(h)) continue;
    const pos = h.pos;
    if (pos.kind === 'corridor' && pos.corridor === cid) {
      // Caught inside: thrown out to the nearer end, hurt.
      const back = pos.t < pos.dur / 2 ? pos.from : pos.to;
      h.pos = { kind: 'room', room: back };
      h.path = [];
      // You may land in the room you were heading for: you now know it (and its exits).
      explore(world, h, back);
      h.knownCollapsed.push(cid);
      notify(world, h, 'The tunnel caves in around you!');
      if (h.downedAt === null) {
        h.hp -= armored(h, 4);
        if (h.hp <= 0) downHero(world, h, null);
      }
      chronicle(world, `${h.name} was caught in a cave-in.`);
      onHeroInRoom(world, h, back);
    }
    if (pos.kind === 'room' && (pos.room === c.a || pos.room === c.b)) {
      if (!h.knownCollapsed.includes(cid)) h.knownCollapsed.push(cid);
      notify(world, h, 'You hear a tunnel collapse nearby!');
    }
  }
}

function collapseRandomCorridor(world: World) {
  const d = world.dungeon;
  // Any tunnel can go, but not one someone is already digging out.
  const digging = new Set(Object.values(world.heroes).map((h) => (h.channel?.kind === 'dig' ? h.channel.corridor : -1)));
  const fresh = (cid: number) => world.time - (world.clearedAt[cid] ?? -Infinity) < 60;
  const candidates = d.corridors.filter((c) => !world.collapsed.includes(c.id) && !digging.has(c.id) && !fresh(c.id));
  if (candidates.length === 0) return;
  // Mostly bring down tunnels that leave another way round; sometimes cut people off for real.
  const loops = candidates.filter((c) => !cutsOff(world, c.id));
  const pool = loops.length && world.rng.chance(ESCALATION.collapsePreferLoops) ? loops : candidates;
  collapseCorridor(world, world.rng.pick(pool).id);
}

/** Would losing this tunnel split the dungeon (given what's already collapsed)? */
function cutsOff(world: World, cid: number): boolean {
  const d = world.dungeon;
  const blocked = new Set([...world.collapsed, cid]);
  const seen = new Set([d.exit]);
  const q = [d.exit];
  while (q.length) {
    const cur = q.shift()!;
    for (const id of d.rooms[cur].corridors) {
      if (blocked.has(id)) continue;
      const n = otherEnd(d.corridors[id], cur);
      if (!seen.has(n)) (seen.add(n), q.push(n));
    }
  }
  const before = new Set([d.exit]);
  const q2 = [d.exit];
  while (q2.length) {
    const cur = q2.shift()!;
    for (const id of d.rooms[cur].corridors) {
      if (world.collapsed.includes(id)) continue;
      const n = otherEnd(d.corridors[id], cur);
      if (!before.has(n)) (before.add(n), q2.push(n));
    }
  }
  return seen.size < before.size;
}

/** Rubble is cleared: the corridor is open again. */
export function clearRubble(world: World, cid: number, by: string) {
  const d = world.dungeon;
  const c = d.corridors[cid];
  world.collapsed = world.collapsed.filter((x) => x !== cid);
  world.clearedAt[cid] = world.time;
  chronicle(world, `${by} dug through the rubble between ${theRoom(d.rooms[c.a].name)} and ${theRoom(d.rooms[c.b].name)}.`);
  for (const h of Object.values(world.heroes)) {
    if (h.pos.kind === 'room' && (h.pos.room === c.a || h.pos.room === c.b)) h.knownCollapsed = h.knownCollapsed.filter((x) => x !== cid);
  }
}
