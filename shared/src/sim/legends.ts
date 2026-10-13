import { LEGEND_IDS, type LegendId } from '../content/legends';
import { ENEMIES } from '../content/enemies';
import { GEAR_SLOTS, ITEMS } from '../content/items';
import { theRoom } from '../dungeon/gen';
import { inDungeon, leaveEncounter, monsterScale, monstersIn, onHeroInRoom, reviveHero, type CombatEvent, type Encounter, type Risen } from './combat';
import { bodyRoom } from './loot';
import { leftRoom } from './gear';
import { notify } from './notify';
import { chronicle, explore, type Hero, type World } from './world';

/**
 * Legendary Gear's cards (user, 2026-10-11; cards since M15, content in content/cards.ts and content/legends.ts).
 * The card effects themselves are in sim/cards.ts; these are the longer pieces they share.
 */

export const PICK_A_ROOM = 'Pick a room on your map.';

/** The Legendaries this hero wears, in slot order. */
export function legendsOf(h: Pick<Hero, 'weapon' | 'armor' | 'amulet' | 'ring'>): LegendId[] {
  return GEAR_SLOTS.flatMap((s) => {
    const it = h[s];
    const l = it ? ITEMS[it].legend : undefined;
    return l ? [l] : [];
  });
}

export function isLegend(id: string): id is LegendId {
  return (LEGEND_IDS as readonly string[]).includes(id);
}

/** Wolves running with this hero: at their side between fights, and still standing in any fight. */
export function wolvesOf(world: World, h: Hero): number {
  let n = h.legion.filter((r) => r.type === 'wolf').length;
  for (const enc of Object.values(world.encounters)) n += (enc.legion ?? []).filter((r) => r.by === h.id && r.type === 'wolf' && r.hp > 0).length;
  return n;
}

/** A wolf for Howl: middling Speed and HP, a weak bite, scaled with the dungeon like the monsters it fights. */
export function summonWolf(world: World): Omit<Risen, 'id' | 'by'> {
  const scale = monsterScale(world, 'wolf', world.escalation);
  const hp = Math.round(ENEMIES.wolf.maxHp * scale);
  return { type: 'wolf', hp, maxHp: hp, dmgMult: scale, turns: 1, permanent: true };
}

/** Unmake (a card now, so only ever its player's own fight): every monster here simply ceases to be. No loot, no Corpses. */
export function unmakeFight(world: World, h: Hero, enc: Encounter) {
  const monsters = monstersIn(world, enc.room);
  for (const m of monsters) delete world.monsters[m.id];
  world.risings = world.risings.filter((r) => r.room !== enc.room);
  delete world.bounty[enc.room];
  enc.slain = [];
  enc.lastSlain = null;
  const where = theRoom(world.dungeon.rooms[enc.room].name);
  chronicle(world, `${h.name} unmade ${monsters.length} monster${monsters.length === 1 ? '' : 's'} in ${where}.`);
}

/** Forgive: a downed ally gets up whole; a dead one lives again, at full HP (with nothing: their things lie where they fell). */
export function forgive(world: World, h: Hero, t: Hero, tell: (text: string, kind?: CombatEvent['kind'], who?: string, amount?: number) => void) {
  const where = bodyRoom(t);
  if (!t.dead) {
    reviveHero(t, 1, world, h);
    tell(`${h.name} calls ${t.name} back to their feet, whole.`, 'heal', t.id, t.hp);
    return;
  }
  t.dead = false;
  t.diedAt = null;
  t.downedAt = null;
  t.riseAt = null;
  t.fate = null;
  t.hp = t.maxHp;
  t.pos = { kind: 'room', room: where };
  t.path = [];
  t.heading = null;
  t.channel = null;
  tell(`${h.name} speaks a word, and ${t.name} rises from death, whole!`, 'heal', t.id, t.hp);
  notify(world, t, `${h.name} calls you back from death. You breathe again.`);
  for (const o of Object.values(world.heroes)) if (o !== h && o !== t && inDungeon(o)) notify(world, o, `Somewhere, ${t.name} draws breath again.`);
  chronicle(world, `${h.name} brought ${t.name} back from the dead in ${theRoom(world.dungeon.rooms[where].name)}.`);
  onHeroInRoom(world, t, where);
}

/** Waystep: out of the fight and into any known room, at once. */
export function waystep(world: World, h: Hero, room: number, enc: Encounter, events: CombatEvent[]) {
  const from = h.pos.kind === 'room' ? h.pos.room : null;
  leaveEncounter(world, enc, h);
  events.push({ actor: h.id, kind: 'flee', target: h.id, text: `${h.name} steps out of the world.` });
  h.channel = null;
  h.pos = { kind: 'room', room };
  h.prevRoom = from;
  h.path = [];
  h.heading = null;
  leftRoom(h);
  explore(world, h, room);
  notify(world, h, `You step out of the world and into ${theRoom(world.dungeon.rooms[room].name)}.`);
  onHeroInRoom(world, h, room);
}
