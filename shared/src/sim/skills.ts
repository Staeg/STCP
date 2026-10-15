import { LIGHT_MAX } from '../content/constants';
import { hasTalent, TALENT_RULES } from '../content/talents';
import { CLASS_RULES, FIELD_RULES as F } from '../content/innates';
import { ITEMS, LOOT_TABLE, type ItemId } from '../content/items';
import { theRoom } from '../dungeon/gen';
import { addClang, gainLight, inDungeon, isConscious, makeRoom, onHeroInRoom, spendLight, stealthOf } from './combat';
import { ENEMIES } from '../content/enemies';
import { dazeAll, lureToward } from './escalation';
import { lightBy } from './gear';
import { giveItem, hasSpace } from './loot';
import { notify } from './notify';
import type { Hero, World } from './world';
import type { CardMark, CardMotif, School } from '../content/cards';

/**
 * Field abilities (M16, user 2026-10-14): each class has one (the Bellwright also keeps the Toll), used outside a
 * fight. Like an event choice, it's picked now and happens when the hero's timer runs out, using up that turn. Each
 * has a cooldown in seconds (the Toll is once a run instead) that runs all the time, fights included.
 */
export type FieldSkill = 'toll' | 'formup' | 'sneak' | 'rekindle' | 'siphon' | 'unearth' | 'ringin' | 'flagellate' | 'brew';

/** none: no target (every field skill now). */
export type FieldTarget = 'none';

/** Display name, who it can be aimed at, what it does out of a fight, and its cooldown in seconds (0: none). */
export const FIELD_SKILLS: Record<FieldSkill, { name: string; target: FieldTarget; desc: string; cooldown: number }> = {
  toll: { name: 'Toll', target: 'none', cooldown: 0,
    desc: `Once a run. Every ally hears where you are and sees you for ${CLASS_RULES.tollReveal}s. Every monster in the dungeon reels: those fighting lose their next turn, the rest stop for ${CLASS_RULES.tollDaze}s, then come one room closer to the bell.` },
  formup: { name: 'Form Up', target: 'none', cooldown: F.formUpCooldown,
    desc: `You and every ally in the room +${F.formUpShield} Shield (never past ${F.formUpCap}).` },
  sneak: { name: 'Sneak', target: 'none', cooldown: 0,
    desc: `On or off, at once and without using your turn. While Sneaking your Speed is doubled, and your cards get their Sneaking bonuses. Walk in on monsters Sneaking and alone, with Stealth (your light ÷ ${CLASS_RULES.stealthPerLight}) below every one's Speed, and it's an Ambush: none of them acts until you do. On your first turn, Flee becomes Sneak Past: the fight is off and you stay there unnoticed (no loot or event while they're there). Turning Sneak off there starts the fight.` },
  siphon: { name: 'Siphon the Flame', target: 'none', cooldown: F.siphonCooldown,
    desc: `Burn ${F.siphonLight} of your light: +1 Anima.` },
  unearth: { name: 'Unearth', target: 'none', cooldown: F.unearthCooldown,
    desc: `A Ghoul claws up from the floor and follows you for good (at most ${CLASS_RULES.followingMax} undead; past that the most decayed crumbles).` },
  rekindle: { name: 'Rekindle', target: 'none', cooldown: F.rekindleCooldown,
    desc: `Every hero in the room, you included, +${F.rekindleLight} light.` },
  ringin: { name: 'Ring In', target: 'none', cooldown: F.ringInCooldown,
    desc: `+${F.ringInClang} Clang, ready for the next fight (they fade as usual, one every 2 of your turns).` },
  flagellate: { name: 'Flagellate', target: 'none', cooldown: F.flagellateCooldown,
    desc: `Lose ${F.flagellateHp} HP and up to ${F.flagellateLight} of your light; every other hero in the room shares the light you lose.` },
  brew: { name: 'Brew', target: 'none', cooldown: F.brewCooldown,
    desc: 'Brew a random consumable into your pack.' },
};

/**
 * Field ability pictures (user, 2026-10-15): built like a card's (a motif for the main effect, a mark for the second,
 * on a school's tint) but struck as a round bronze medallion, so a field ability never looks like a card.
 */
export const FIELD_ART: Record<FieldSkill, { motif: CardMotif; mark?: CardMark; school: School }> = {
  toll: { motif: 'waves', mark: 'eye', school: 'hinder' },
  formup: { motif: 'gate', mark: 'swirl', school: 'guard' },
  sneak: { motif: 'veil', mark: 'eye', school: 'hasten' },
  rekindle: { motif: 'lamp', mark: 'sun', school: 'light' },
  siphon: { motif: 'flame', mark: 'swirl', school: 'light' },
  unearth: { motif: 'ghoul', school: 'conjure' },
  ringin: { motif: 'bell', mark: 'sword', school: 'hinder' },
  flagellate: { motif: 'whip', mark: 'sun', school: 'light' },
  brew: { motif: 'flask', mark: 'flame', school: 'mend' },
};

export function skillTarget(_h: Hero, skill: FieldSkill): FieldTarget {
  return FIELD_SKILLS[skill].target;
}

export function skillInfo(_h: Hero, skill: FieldSkill): { name: string; desc: string } {
  return FIELD_SKILLS[skill];
}

/** Each class's field ability (M16). */
export const CLASS_SKILL: Partial<Record<Hero['cls'], FieldSkill>> = {
  warden: 'formup', cutthroat: 'sneak', lampbearer: 'rekindle', sorceress: 'siphon', undertaker: 'unearth', bellwright: 'ringin', zealot: 'flagellate', alchemist: 'brew',
};

/** This hero's field abilities, in the order the bar shows them (keys M, N): the Bellwright's Toll first. */
export function fieldSkillsOf(h: Pick<Hero, 'cls'>): FieldSkill[] {
  const own = CLASS_SKILL[h.cls];
  return [...(h.cls === 'bellwright' ? ['toll' as const] : []), ...(own ? [own] : [])];
}

export function skillTargeted(h: Hero, skill: FieldSkill): boolean {
  return skillTarget(h, skill) !== 'none';
}

/** Seconds this skill's cooldown takes for this hero (Scourged halves Flagellate's). */
export function skillCooldown(h: Pick<Hero, 'talents'>, skill: FieldSkill): number {
  const cd = FIELD_SKILLS[skill].cooldown;
  return skill === 'flagellate' && hasTalent(h, 'scourged') ? cd * TALENT_RULES.scourgedCooldown : cd;
}

/** Seconds until this skill is ready again (0: ready). */
export function skillWait(world: Pick<World, 'time'>, h: Pick<Hero, 'fieldReady'>, skill: FieldSkill): number {
  return Math.max(0, (h.fieldReady[skill] ?? 0) - world.time);
}

/** Everyone standing (conscious) in this hero's room, them included. */
function roomMates(world: World, h: Hero): Hero[] {
  if (h.pos.kind !== 'room') return [h];
  const room = h.pos.room;
  return Object.values(world.heroes).filter((o) => isConscious(o) && o.pos.kind === 'room' && o.pos.room === room);
}

/** Returns an error message, or null if the skill can be used. */
export function checkSkill(world: World, h: Hero, skill: FieldSkill): string | null {
  if (!fieldSkillsOf(h).includes(skill)) return 'You have no such skill.';
  // Sneak flips on or off anywhere outside a fight, tunnels included.
  if (skill === 'sneak') return h.encounter !== null ? 'Not in a fight.' : isConscious(h) ? null : 'You cannot.';
  if (h.pos.kind !== 'room') return 'Not while walking a tunnel.';
  if (h.encounter !== null) return 'Not in a fight.';
  if (skill === 'toll' && h.tolled) return 'You have already rung the bell this run.';
  const wait = skillWait(world, h, skill);
  if (wait > 0) return `${FIELD_SKILLS[skill].name} is ready again in ${Math.ceil(wait)}s.`;
  switch (skill) {
    case 'rekindle':
      return roomMates(world, h).some((o) => o.light < LIGHT_MAX) ? null : 'Every lamp here burns full.';
    case 'siphon':
      return h.light >= F.siphonLight ? null : `You need ${F.siphonLight} light to burn.`;
    case 'flagellate':
      if (h.light <= 0 && (hasTalent(h, 'scourged') || h.hp <= 1)) return 'There is nothing left to scourge.';
      return null;
    case 'brew':
      if (h.rites.includes('gem')) return 'The Gem Rite forbids it.';
      return hasSpace(h) ? null : 'Your pack is full.';
  }
  return null;
}

/** The timer ran out with this skill queued: do it (if it still works). */
export function useSkill(world: World, h: Hero, skill: FieldSkill) {
  const err = checkSkill(world, h, skill);
  if (err) return notify(world, h, err);
  const cd = skillCooldown(h, skill);
  if (cd > 0) h.fieldReady[skill] = world.time + cd;
  switch (skill) {
    case 'toll':
      h.tolled = true;
      toll(world, h);
      return;
    case 'formup':
      return formUp(world, h);
    case 'rekindle': {
      const lit = roomMates(world, h).map((o) => ({ o, got: Math.round(gainLight(o, lightBy(h, o, F.rekindleLight))) }));
      for (const { o, got } of lit) {
        notify(world, o, o === h ? `You rekindle every lamp here. (+${got} light)` : `${h.name} rekindles your lamp. (+${got} light)`);
      }
      return;
    }
    case 'siphon':
      spendLight(h, F.siphonLight);
      h.anima++;
      notify(world, h, `You drink the flame from your own lamp. (−${F.siphonLight} light, +1 Anima: ${h.anima})`);
      return;
    case 'unearth': {
      const gone = makeRoom(world, h);
      const hp = ENEMIES.ghoul.maxHp;
      h.legion.push({ type: 'ghoul', hp, maxHp: hp, dmgMult: 1, turns: 1, permanent: true, decay: 0, age: 0 });
      notify(world, h, `A Ghoul claws its way up and shambles after you.${gone ? ` (Your ${gone} crumbles away to make room.)` : ''}`);
      return;
    }
    case 'ringin':
      addClang(h, F.ringInClang);
      notify(world, h, `You ring the bell in, low and steady. (Clang ×${h.st.clang?.stacks ?? F.ringInClang}: your cards are quicker)`);
      return;
    case 'flagellate':
      return flagellate(world, h);
    case 'brew': {
      const item = brewRoll(world);
      giveItem(h, item);
      notify(world, h, `You brew a ${ITEMS[item].name}.`);
      return;
    }
  }
}

/**
 * Cutthroat: Sneak on or off (at once, no turn). Turned off where they stood unnoticed among monsters (a Sneak Past),
 * the fight starts there and then.
 */
export function toggleSneak(world: World, h: Hero) {
  h.sneaking = !h.sneaking;
  if (h.sneaking) return notify(world, h, `You start Sneaking. (Speed ×${CLASS_RULES.sneakSpeedMult}; Stealth ${stealthOf(h).toFixed(1)})`);
  notify(world, h, 'You stop Sneaking.');
  if (h.pos.kind === 'room' && h.unnoticedIn === h.pos.room) {
    h.unnoticedIn = null;
    onHeroInRoom(world, h, h.pos.room);
  }
}

/** Warden: you and everyone in the room get Shield, never past the cap (Shield from fights may be higher already). */
function formUp(world: World, h: Hero) {
  for (const o of roomMates(world, h)) {
    const before = o.st.shield ?? 0;
    const after = Math.max(before, Math.min(F.formUpCap, before + F.formUpShield));
    if (after > before) o.st.shield = after;
    const got = after - before;
    notify(world, o, o === h
      ? `You call the line to form up. (+${got} Shield${got < F.formUpShield ? `; never past ${F.formUpCap}` : ''})`
      : `${h.name} calls you into line. (+${got} Shield)`);
  }
}

/** Zealot: blood and darkness, and the light they give up goes to the others in the room. */
function flagellate(world: World, h: Hero) {
  const scourged = hasTalent(h, 'scourged');
  const cost = scourged ? 0 : Math.min(h.hp - 1, F.flagellateHp);
  if (cost > 0) h.hp -= cost;
  const lost = spendLight(h, F.flagellateLight);
  const others = roomMates(world, h).filter((o) => o !== h);
  for (const o of others) {
    const got = Math.round(gainLight(o, lightBy(h, o, lost / others.length)));
    notify(world, o, `${h.name} scourges themself, and their light passes to you. (+${got} light)`);
  }
  notify(world, h, `You scourge your own back. (${cost ? `−${cost} HP, ` : ''}−${Math.round(lost)} light${others.length ? ', shared with the others here' : ''})`);
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

/** A random consumable, as the loot table weighs them (the Alchemist's Brew, Opus Magnum). */
export function brewRoll(world: World): ItemId {
  const pool = LOOT_TABLE.filter((e) => ITEMS[e.item].kind === 'consumable');
  let roll = world.rng.float(0, pool.reduce((s, e) => s + e.weight, 0));
  for (const e of pool) {
    roll -= e.weight;
    if (roll <= 0) return e.item;
  }
  return pool[0].item;
}
