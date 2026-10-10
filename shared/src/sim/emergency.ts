import { EMERGENCIES, type EmergencyDef, type EmergencyId } from '../content/emergencies';
import { ENEMIES, LAIR_GROUPS, ROSTER_RULES, type EnemyId, type Roster } from '../content/enemies';
import { EVENT_SEEDING } from '../content/events';
import { GEAR_SLOTS, LOOT, type ItemId } from '../content/items';
import { neighbours } from '../dungeon/gen';
import { Rng } from '../rng';
import { crUnits, fillGroup, monstersIn, pickGroup, pickTemplate, spawnGroup } from './combat';
import { villagerHere } from './events';
import { addToPile } from './loot';
import type { Hero, World } from './world';

/**
 * Emergencies in the dungeon (M13): what the run is seeded with so each player's Emergency can be done, and how far
 * along it is. Party-wide needs take the largest of the players' (3 villagers and 4 villagers make 4); personal
 * seeding (Tithe's Relic and Gems) is per player.
 */

/** Quarry: a kill target becomes one of the run's default units for its tier (the Lich, T3, has no default slot). */
export function forceRoster(roster: Roster, ids: readonly EmergencyId[]) {
  for (const id of ids) {
    const e = EMERGENCIES[id].kill?.enemy;
    if (!e) continue;
    const t = ENEMIES[e].tier;
    if (ROSTER_RULES.defaults[t] === 0 || roster.main[t].includes(e)) continue;
    if (roster.cr[t] === e) roster.cr[t] = roster.main[t][0] ?? null;
    roster.main[t][0] = e;
  }
}

/** Seed the dungeon so every player's Emergency can be done. Its own RNG for placement. */
export function seedEmergencies(world: World, ids: readonly EmergencyId[]) {
  if (!ids.length) return;
  const defs = ids.map((id) => EMERGENCIES[id]);
  const most = (f: (d: EmergencyDef) => number | undefined) => Math.max(0, ...defs.map((d) => f(d) ?? 0));
  const rng = new Rng(world.seed ^ 0x51ed27a3);
  const d = world.dungeon;
  const safe = new Set([d.entrance, d.exit, ...neighbours(d, d.entrance)]);
  const open = () => d.rooms.filter((r) => r.kind === 'normal' && !safe.has(r.id));
  const bare = () => open().filter((r) => !world.events[r.id] && !villagerHere(world, r.id));
  /** A room for something new: one with no monsters, event or captive if possible. */
  const pickRoom = (quiet: boolean) => {
    const free = bare();
    const best = free.filter((r) => monstersIn(world, r.id).length === 0);
    const from = quiet && best.length ? best : free.length ? free : open();
    return from.length ? rng.pick(from).id : null;
  };

  // Captives (always guarded, as in spawnEvents).
  const villagers = most((x) => x.villagers) - Object.values(world.villagers).filter((v) => v.state === 'captive').length;
  for (let i = 0; i < villagers; i++) {
    const room = pickRoom(false);
    if (room === null) break;
    if (monstersIn(world, room).length === 0) spawnGroup(world, room, pickGroup(world, 0), 0);
    const id = `v${world.nextId++}`;
    world.villagers[id] = { id, room, leader: null, hp: EVENT_SEEDING.villagerHp, maxHp: EVENT_SEEDING.villagerHp, state: 'captive' };
  }

  // Altars.
  const altars = most((x) => x.altars) - Object.values(world.events).filter((e) => e.kind === 'altar').length;
  for (let i = 0; i < altars; i++) {
    const room = pickRoom(true);
    if (room === null) break;
    world.events[room] = { room, kind: 'altar', done: false, progress: 0, by: null, spawned: false };
  }

  // Quarry: each target leads an ordinary group of its own, placed now, whatever the Escalation.
  const targets = new Map<EnemyId, number>();
  for (const def of defs) {
    if (!def.kill || (def.minCr !== undefined && world.cr < def.minCr)) continue;
    targets.set(def.kill.enemy, Math.max(targets.get(def.kill.enemy) ?? 0, def.kill.n));
  }
  for (const [enemy, n] of targets) {
    for (let i = 0; i < n; i++) {
      const room = pickRoom(true);
      if (room === null) break;
      spawnGroup(world, room, [enemy, ...pickGroup(world, 0)], 0);
    }
  }

  // Tithe: per player, sure Relics in lairs (a lair is made if there are too few) and Gems lying about.
  const relics = defs.reduce((s, x) => s + (x.seed?.relics ?? 0), 0);
  const lairs = rng.shuffle(open().filter((r) => (world.bounty[r.id] ?? 0) > 0 && monstersIn(world, r.id).length > 0).map((r) => r.id));
  for (let i = 0; i < relics; i++) {
    let room = lairs[i];
    if (room === undefined) {
      const at = pickRoom(true);
      if (at === null) break;
      room = at;
      spawnGroup(world, room, crUnits(world, fillGroup(world, pickTemplate(world, LAIR_GROUPS).tiers), 'lair', room), 0);
      world.bounty[room] = LOOT.lairBounty;
      addToPile(world, room, rng.int(...LOOT.lairGold), []);
    }
    addToPile(world, room, 0, ['relic']);
  }
  const gems = defs.reduce((s, x) => s + (x.seed?.gems ?? 0), 0);
  for (let i = 0; i < gems; i++) {
    const rooms = open();
    if (!rooms.length) break;
    addToPile(world, rng.pick(rooms).id, 0, ['gem']);
  }
}

/** One part of an Emergency and how far along it is. */
export interface EmergencyPart {
  label: string;
  have: number;
  need: number;
}

export interface EmergencyProgress {
  id: EmergencyId;
  parts: EmergencyPart[];
  /** Done, as things stand (a personal one only counts at the end if the hero escapes, or an Undertaker carries it). */
  done: boolean;
  /** The kill target can't come this run (CR too low). */
  impossible?: string;
}

/** What this hero would bring home: pack and Gear, plus what an Undertaker or the Tome Rite is carrying for them. */
export function carriedHome(h: Hero): ItemId[] {
  const own = h.dead ? [] : [...h.items, ...GEAR_SLOTS.map((s) => h[s]).filter((x): x is ItemId => !!x)];
  return [...own, ...h.legacyItems];
}

/** How far along this hero's player is with their Emergency. */
export function emergencyProgress(world: World, h: Hero): EmergencyProgress | null {
  if (!h.emergency) return null;
  const def = EMERGENCIES[h.emergency];
  const parts: EmergencyPart[] = [];
  if (def.kill) parts.push({ label: `${def.kill.enemy === 'lich' ? 'Liches' : `${ENEMIES[def.kill.enemy].name}s`} slain`, have: world.kills[def.kill.enemy] ?? 0, need: def.kill.n });
  if (def.altars) parts.push({ label: 'Altars cleansed', have: world.objectives.altars, need: def.altars });
  if (def.villagers) parts.push({ label: 'villagers saved', have: world.objectives.villagers, need: def.villagers });
  if (def.allEscape) {
    const players = Object.values(world.heroes).filter((x) => x.player);
    parts.push({ label: 'players escaped', have: players.filter((x) => x.extracted).length, need: players.length });
  }
  if (def.carry) {
    const carried = carriedHome(h);
    for (const c of def.carry) parts.push({ label: c.label, have: carried.filter((it) => c.items.includes(it)).length, need: c.n });
  }
  const impossible = def.minCr !== undefined && world.cr < def.minCr ? `No ${def.kill?.enemy === 'lich' ? 'Liches' : 'targets'} at CR ${world.cr}.` : undefined;
  return { id: h.emergency, parts, done: parts.every((p) => p.have >= p.need), impossible };
}

/** At the end of the run: did this hero's player do their Emergency? */
export function emergencyDone(world: World, h: Hero): boolean {
  // Carried things only count if they came out (carriedHome): the hero escaped, or it was carried home for the dead.
  return !!emergencyProgress(world, h)?.done;
}
