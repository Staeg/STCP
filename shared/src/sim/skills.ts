import { CLASS_RULES, abilityById } from '../content/abilities';
import { TALENT_RULES } from '../content/talents';
import { ITEMS, LOOT_TABLE, type ItemId } from '../content/items';
import { theRoom } from '../dungeon/gen';
import { abilitiesOf, addStress, flareLight, inDungeon, isConscious, takeSins } from './combat';
import { dazeAll, lureToward } from './escalation';
import { giveItem, hasSpace } from './loot';
import { notify } from './notify';
import type { Hero, World } from './world';

/**
 * Class skills used outside a fight: the Bellwright's Toll, and every ability marked `field`. Like an event
 * choice, the skill is picked now and happens when the hero's timer runs out, using up that turn. Each shares its
 * cooldown with the ability in fights (same `cooldowns` entry, counted in the hero's turns).
 */
export type FieldSkill = 'toll' | 'sins' | 'elixir' | 'mend' | 'flare' | 'vigil' | 'vengeance';

/** none: no target · any: anyone conscious in your room, you included · other: not you */
type FieldTarget = 'none' | 'any' | 'other';

/** Display name, who it can be aimed at, and what it does out of a fight. */
export const FIELD_SKILLS: Record<FieldSkill, { name: string; target: FieldTarget; desc: string }> = {
  toll: { name: 'Toll', target: 'none', desc: `Every ally hears where you are and sees you for ${CLASS_RULES.tollReveal}s. Monsters next door come to the bell.` },
  sins: { name: 'Take Their Sins', target: 'other', desc: `Take up to ${abilityById('sins')!.power} stress off an ally onto yourself.` },
  elixir: { name: 'Elixir', target: 'any', desc: 'Their next item (or yours) has double effect.' },
  mend: { name: 'Mend', target: 'other', desc: `Heal an ally ${abilityById('mend')!.power} and cure Poison.` },
  flare: { name: 'Flare', target: 'none', desc: `+${CLASS_RULES.flareLight} light to everyone here.` },
  vigil: { name: 'Vigil', target: 'any', desc: `−${abilityById('vigil')!.power} stress.` },
  vengeance: { name: 'Vengeance', target: 'none', desc: 'Swear vengeance before the fight: whoever strikes you in it takes the blow back.' },
};

/** Who a hero's skill can be aimed at, with their Talent (Triage turns Mend on yourself). */
export function skillTarget(h: Hero, skill: FieldSkill): FieldTarget {
  if (skill === 'mend' && h.talent === 'triage') return 'none';
  return FIELD_SKILLS[skill].target;
}

/** Name and text of a skill for this hero (Talents change some numbers). */
export function skillInfo(h: Hero, skill: FieldSkill): { name: string; desc: string } {
  if (skill === 'toll') return h.talent === 'greatBell' ? { name: 'Toll', desc: `${FIELD_SKILLS.toll.desc} Great Bell: every monster is stunned.` } : FIELD_SKILLS.toll;
  const ab = abilitiesOf(h).find((a) => a.id === skill);
  if (skill === 'mend' && h.talent === 'triage') return { name: 'Mend', desc: `Heal yourself ${ab!.power} and cure Poison.` };
  if (skill === 'sins' && h.talent === 'martyr') return { name: FIELD_SKILLS.sins.name, desc: ab!.desc };
  return FIELD_SKILLS[skill];
}

/** This hero's field skills, in ability-slot order (the Toll first). */
export function fieldSkillsOf(h: Hero): FieldSkill[] {
  const skills: FieldSkill[] = h.cls === 'bellwright' ? ['toll'] : [];
  for (const ab of abilitiesOf(h)) if (ab.field) skills.push(ab.id as FieldSkill);
  return skills;
}

export function skillTargeted(h: Hero, skill: FieldSkill): boolean {
  return skillTarget(h, skill) !== 'none';
}

/** Cooldown in the hero's own turns after using it. */
function cooldownOf(h: Hero, skill: FieldSkill): number {
  return skill === 'toll' ? CLASS_RULES.tollCooldown : abilitiesOf(h).find((a) => a.id === skill)!.cooldown;
}

function sameRoom(a: Hero, b: Hero) {
  return a.pos.kind === 'room' && b.pos.kind === 'room' && a.pos.room === b.pos.room;
}

/** Returns an error message, or null if the skill can be used on `targetId` (null = untargeted). */
export function checkSkill(world: World, h: Hero, skill: FieldSkill, targetId: string | null): string | null {
  if (!fieldSkillsOf(h).includes(skill)) return 'You have no such skill.';
  if (h.pos.kind !== 'room') return 'Not while walking a tunnel.';
  const cd = h.cooldowns[skill] ?? 0;
  if (cd > 0) return `${FIELD_SKILLS[skill].name} is ready in ${cd} turn${cd === 1 ? '' : 's'}.`;
  const kind = skillTarget(h, skill);
  if (skill === 'mend' && kind === 'none' && h.hp >= h.maxHp && !h.st.poison) return 'You are not hurt.';
  if (skill === 'vengeance' && h.st.vengeance) return 'You have already sworn vengeance.';
  if (kind === 'none') return null;
  const t = targetId ? world.heroes[targetId] : undefined;
  if (!t || !isConscious(t) || !sameRoom(h, t)) return 'They must be standing here with you.';
  if (kind === 'other' && t === h) return skill === 'sins' ? 'You can only take the sins of others.' : 'Only on someone else.';
  if (skill === 'sins' && t.stress <= 0) return `${t.name} has nothing weighing on them.`;
  if (skill === 'mend' && t.hp >= t.maxHp && !t.st.poison) return `${t.name} is not hurt.`;
  if (skill === 'vigil' && t.stress <= 0) return `${t === h ? 'You are' : `${t.name} is`} already calm.`;
  if (t !== h && t.affliction === 'paranoid') return `${t.name} refuses your help. (Paranoid)`;
  return null;
}

/** The timer ran out with this skill queued: do it (if it still works). */
export function useSkill(world: World, h: Hero, skill: FieldSkill, targetId: string | null) {
  const err = checkSkill(world, h, skill, targetId);
  if (err) return notify(world, h, err);
  const cd = cooldownOf(h, skill);
  if (cd > 0) h.cooldowns[skill] = cd;
  h.cdClock = 0;
  const t = targetId && skillTarget(h, skill) !== 'none' ? world.heroes[targetId] : h;
  switch (skill) {
    case 'toll':
      return toll(world, h);
    case 'sins': {
      const moved = takeSins(h, t, abilitiesOf(h)[2].power);
      // Martyr: and eases their wounds.
      const before = t.hp;
      if (h.talent === 'martyr') t.hp = Math.min(t.maxHp, t.hp + TALENT_RULES.martyrHeal);
      const healed = t.hp > before ? `, +${t.hp - before} HP` : '';
      notify(world, h, `You take ${t.name}'s sins upon yourself. (+${moved} stress)`);
      notify(world, t, `${h.name} takes your sins upon themself. (−${moved} stress${healed})`);
      return;
    }
    case 'vengeance':
      h.st.vengeance = CLASS_RULES.vengeanceTurns + TALENT_RULES.unyieldingTurns;
      notify(world, h, `You swear vengeance. Whoever strikes you in your next ${h.st.vengeance} turns will feel it.`);
      return;
    case 'elixir':
      t.elixir = true;
      notify(world, h, t === h ? 'You drink an elixir: your next item has double effect.' : `You give ${t.name} an elixir.`);
      if (t !== h) notify(world, t, `${h.name} gives you an elixir: your next item has double effect.`);
      return;
    case 'mend': {
      const before = t.hp;
      t.hp = Math.min(t.maxHp, t.hp + abilitiesOf(h)[2].power);
      delete t.st.poison;
      if (t === h) return notify(world, h, `You tend your own wounds (+${t.hp - before}).`);
      notify(world, h, `You mend ${t.name} (+${t.hp - before}).`);
      notify(world, t, `${h.name} mends your wounds (+${t.hp - before}).`);
      return;
    }
    case 'flare':
      if (h.pos.kind === 'room') flareLight(world, h.pos.room);
      for (const o of Object.values(world.heroes)) {
        if (inDungeon(o) && sameRoom(o, h)) notify(world, o, o === h ? `You light a flare. (+${CLASS_RULES.flareLight} light)` : `${h.name} lights a flare. (+${CLASS_RULES.flareLight} light)`);
      }
      return;
    case 'vigil': {
      const eased = -addStress(t, -abilityById('vigil')!.power);
      notify(world, h, t === h ? `You keep a quiet vigil. (−${eased} stress)` : `You keep vigil over ${t.name}. (−${eased} stress)`);
      if (t !== h) notify(world, t, `${h.name} keeps vigil over you. (−${eased} stress)`);
      return;
    }
  }
}

/** Bellwright: everyone in the dungeon hears it, sees you for a while, and the monsters next door come running. */
function toll(world: World, h: Hero) {
  if (h.pos.kind !== 'room') return;
  const room = h.pos.room;
  world.tolls.push({ by: h.id, room, time: world.time });
  if (world.tolls.length > 20) world.tolls.shift();
  const where = theRoom(world.dungeon.rooms[room].name);
  for (const o of Object.values(world.heroes)) {
    if (!inDungeon(o)) continue;
    if (!o.seen.includes(room)) o.seen.push(room);
    notify(world, o, o === h ? 'You ring the bell. Everyone heard that, and so did the dark.' : `A bell tolls from ${where}: ${h.name}.`);
  }
  lureToward(world, room);
  // Great Bell: the whole dungeon reels from it.
  if (h.talent === 'greatBell') {
    dazeAll(world, TALENT_RULES.greatBellDaze);
    for (const o of Object.values(world.heroes)) if (inDungeon(o)) notify(world, o, 'The great bell shakes the dungeon. Every monster reels.');
  }
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

/** Alchemist: a fresh consumable every so often, if there's room in the pack. */
export function tickBrew(world: World, h: Hero) {
  if (!inDungeon(h) || world.time < h.brewAt) return;
  h.brewAt += CLASS_RULES.brewEvery;
  if (!isConscious(h) || !hasSpace(h) || h.rites.includes('gem')) return;
  const pool = LOOT_TABLE.filter((e) => ITEMS[e.item].kind === 'consumable');
  let roll = world.rng.float(0, pool.reduce((s, e) => s + e.weight, 0));
  let item: ItemId = pool[0].item;
  for (const e of pool) {
    roll -= e.weight;
    if (roll <= 0) {
      item = e.item;
      break;
    }
  }
  giveItem(h, item);
  notify(world, h, `You brew a ${ITEMS[item].name}.`);
}
