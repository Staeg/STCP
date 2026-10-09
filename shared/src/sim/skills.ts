import { ABILITIES, CLASS_RULES } from '../content/abilities';
import { ITEMS, LOOT_TABLE, type ItemId } from '../content/items';
import { theRoom } from '../dungeon/gen';
import { inDungeon, isConscious, takeSins } from './combat';
import { lureToward } from './escalation';
import { giveItem, hasSpace } from './loot';
import { notify } from './notify';
import { speedOf } from './speed';
import type { Hero, World } from './world';

/**
 * Class skills used outside a fight (the Lampbearer's Mend is separate and instant). Like an event choice,
 * the skill is picked now and happens when the hero's timer runs out, using up that turn.
 */
export type FieldSkill = 'toll' | 'sins' | 'elixir';

export function fieldSkillOf(h: Hero): FieldSkill | null {
  return h.cls === 'bellringer' ? 'toll' : h.cls === 'zealot' ? 'sins' : h.cls === 'alchemist' ? 'elixir' : null;
}

/** Display name and whether the skill is aimed at someone in your room. */
export const FIELD_SKILLS: Record<FieldSkill, { name: string; targeted: boolean; desc: string }> = {
  toll: { name: 'Toll', targeted: false, desc: `Every ally hears where you are and sees you for ${CLASS_RULES.tollReveal}s. Monsters next door come to the bell.` },
  sins: { name: 'Take Their Sins', targeted: true, desc: `Take up to ${ABILITIES.zealot[1].power} stress off an ally onto yourself.` },
  elixir: { name: 'Elixir', targeted: true, desc: 'Their next item (or yours) has double effect.' },
};

/** Seconds of cooldown after using it out of a fight: the Toll's own, or the ability's cooldown in your turns. */
function cooldownSecs(world: World, h: Hero, skill: FieldSkill): number {
  if (skill === 'toll') return CLASS_RULES.tollCooldown;
  const ab = skill === 'sins' ? ABILITIES.zealot[1] : ABILITIES.alchemist[2];
  return ab.cooldown * speedOf(h, world.time);
}

function sameRoom(a: Hero, b: Hero) {
  return a.pos.kind === 'room' && b.pos.kind === 'room' && a.pos.room === b.pos.room;
}

/** Returns an error message, or null if the skill can be used on `targetId` (null = untargeted). */
export function checkSkill(world: World, h: Hero, targetId: string | null): string | null {
  const skill = fieldSkillOf(h);
  if (!skill) return 'You have no such skill.';
  if (h.pos.kind !== 'room') return 'Not while walking a tunnel.';
  if (world.time < h.skillReadyAt) return `${FIELD_SKILLS[skill].name} is ready in ${Math.ceil(h.skillReadyAt - world.time)}s.`;
  if (!FIELD_SKILLS[skill].targeted) return null;
  const t = targetId ? world.heroes[targetId] : undefined;
  if (!t || !isConscious(t) || !sameRoom(h, t)) return 'They must be standing here with you.';
  if (skill === 'sins') {
    if (t === h) return 'You can only take the sins of others.';
    if (t.stress <= 0) return `${t.name} has nothing weighing on them.`;
  }
  if (t !== h && t.affliction === 'paranoid') return `${t.name} refuses your help. (Paranoid)`;
  return null;
}

/** The timer ran out with this skill queued: do it (if it still works). */
export function useSkill(world: World, h: Hero, targetId: string | null) {
  const err = checkSkill(world, h, targetId);
  if (err) return notify(world, h, err);
  const skill = fieldSkillOf(h)!;
  h.skillReadyAt = world.time + cooldownSecs(world, h, skill);
  const t = targetId ? world.heroes[targetId] : h;
  switch (skill) {
    case 'toll':
      return toll(world, h);
    case 'sins': {
      const moved = takeSins(h, t, ABILITIES.zealot[1].power);
      notify(world, h, `You take ${t.name}'s sins upon yourself. (+${moved} stress)`);
      notify(world, t, `${h.name} takes your sins upon themself. (−${moved} stress)`);
      return;
    }
    case 'elixir':
      t.elixir = true;
      notify(world, h, t === h ? 'You drink an elixir: your next item has double effect.' : `You give ${t.name} an elixir.`);
      if (t !== h) notify(world, t, `${h.name} gives you an elixir: your next item has double effect.`);
      return;
  }
}

/** Bellringer: everyone in the dungeon hears it, sees you for a while, and the monsters next door come running. */
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
  if (!isConscious(h) || !hasSpace(h)) return;
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
