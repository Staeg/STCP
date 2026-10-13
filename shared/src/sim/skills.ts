import { CLASS_RULES } from '../content/innates';
import { ITEMS, LOOT_TABLE, type ItemId } from '../content/items';
import { theRoom } from '../dungeon/gen';
import { inDungeon, isConscious } from './combat';
import { dazeAll, lureToward } from './escalation';
import { giveItem, hasSpace } from './loot';
import { notify } from './notify';
import type { Hero, World } from './world';

/**
 * Class skills used outside a fight. Since the cards (M15) only the Bellwright's Toll is left: cards are for fights.
 * Like an event choice, it's picked now and happens when the hero's timer runs out, using up that turn.
 */
export type FieldSkill = 'toll';

/** none: no target (every field skill now). */
export type FieldTarget = 'none';

/** Display name, who it can be aimed at, and what it does out of a fight. */
export const FIELD_SKILLS: Record<FieldSkill, { name: string; target: FieldTarget; desc: string }> = {
  toll: { name: 'Toll', target: 'none', desc: `Once a run. Every ally hears where you are and sees you for ${CLASS_RULES.tollReveal}s. Every monster in the dungeon reels: those fighting lose their next turn, the rest stop for ${CLASS_RULES.tollDaze}s, then come one room closer to the bell.` },
};

export function skillTarget(_h: Hero, skill: FieldSkill): FieldTarget {
  return FIELD_SKILLS[skill].target;
}

export function skillInfo(_h: Hero, skill: FieldSkill): { name: string; desc: string } {
  return FIELD_SKILLS[skill];
}

/** This hero's field skills: the Toll, for a Bellwright. */
export function fieldSkillsOf(h: Hero): FieldSkill[] {
  return h.cls === 'bellwright' ? ['toll'] : [];
}

export function skillTargeted(h: Hero, skill: FieldSkill): boolean {
  return skillTarget(h, skill) !== 'none';
}

/** Returns an error message, or null if the skill can be used. */
export function checkSkill(_world: World, h: Hero, skill: FieldSkill): string | null {
  if (!fieldSkillsOf(h).includes(skill)) return 'You have no such skill.';
  if (h.pos.kind !== 'room') return 'Not while walking a tunnel.';
  if (skill === 'toll' && h.tolled) return 'You have already rung the bell this run.';
  return null;
}

/** The timer ran out with this skill queued: do it (if it still works). */
export function useSkill(world: World, h: Hero, skill: FieldSkill) {
  const err = checkSkill(world, h, skill);
  if (err) return notify(world, h, err);
  h.tolled = true;
  toll(world, h);
}

/** Bellwright: everyone in the dungeon hears it, sees you for a while, and every monster comes one room closer. */
export function toll(world: World, h: Hero) {
  if (h.pos.kind !== 'room') return;
  const room = h.pos.room;
  world.tolls.push({ by: h.id, room, time: world.time });
  if (world.tolls.length > 20) world.tolls.shift();
  const where = theRoom(world.dungeon.rooms[room].name);
  for (const o of Object.values(world.heroes)) {
    if (!inDungeon(o)) continue;
    if (!o.seen.includes(room)) o.seen.push(room);
    notify(world, o, o === h ? 'You ring the bell. Everyone heard that, and so did the dark.' : `A bell tolls from ${where}: ${h.name}.`, 'toll');
  }
  lureToward(world, room);
  // The whole dungeon reels from it (Great Bell's until 2026-10-11).
  dazeAll(world, CLASS_RULES.tollDaze);
  for (const o of Object.values(world.heroes)) if (inDungeon(o)) notify(world, o, 'The bell shakes the dungeon. Every monster reels.');
}

/** Is `h` being heard right now (a toll in the last few seconds)? Allies then see them as if in sight. */
export function hearsToll(world: World, h: Hero): boolean {
  if (!inDungeon(h)) return false;
  for (let i = world.tolls.length - 1; i >= 0; i--) {
    const t = world.tolls[i];
    if (world.time - t.time > CLASS_RULES.tollReveal) break;
    if (t.by === h.id) return true;
  }
  return false;
}

/** A random consumable, as the loot table weighs them (the Alchemist's brews, Opus Magnum). */
export function brewRoll(world: World): ItemId {
  const pool = LOOT_TABLE.filter((e) => ITEMS[e.item].kind === 'consumable');
  let roll = world.rng.float(0, pool.reduce((s, e) => s + e.weight, 0));
  for (const e of pool) {
    roll -= e.weight;
    if (roll <= 0) return e.item;
  }
  return pool[0].item;
}

/** Alchemist: a fresh consumable every so often, if there's room in the pack. */
export function tickBrew(world: World, h: Hero) {
  if (!inDungeon(h) || world.time < h.brewAt) return;
  h.brewAt += CLASS_RULES.brewEvery;
  if (!isConscious(h) || !hasSpace(h) || h.rites.includes('gem')) return;
  const item = brewRoll(world);
  giveItem(h, item);
  notify(world, h, `You brew a ${ITEMS[item].name}.`);
}
