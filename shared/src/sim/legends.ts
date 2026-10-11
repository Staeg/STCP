import { BOSS_TIER, LEGEND_RULES, LEGENDS, type LegendId } from '../content/legends';
import { ENEMIES } from '../content/enemies';
import { GEAR_SLOTS, ITEMS } from '../content/items';
import { theRoom } from '../dungeon/gen';
import {
  abilitiesOf, applyMonsterDamage, heroBlock, heroHits, inDungeon, isConscious, leaveEncounter, monsterScale, monstersIn, onHeroInRoom, reviveHero,
  record, say, type CombatEvent, type Encounter, type Risen,
} from './combat';
import { bodyRoom } from './loot';
import { cooldownFor, leftRoom } from './gear';
import { notify } from './notify';
import { chronicle, explore, type Hero, type World } from './world';

/**
 * Legendary Gear's abilities (user, 2026-10-11; content in content/legends.ts). In a fight one is picked like any
 * ability and happens on the hero's turn; out of one it's a field skill, happening when their Speed timer runs out.
 * Cooldowns live in `hero.cooldowns` under the ability's id, shared by fights and the field.
 */

export const PICK_A_ROOM = 'Pick a room on your map.';

/** The Legendary abilities this hero's worn Gear gives them, in slot order. */
export function legendsOf(h: Pick<Hero, 'weapon' | 'armor' | 'amulet' | 'ring'>): LegendId[] {
  return GEAR_SLOTS.flatMap((s) => {
    const it = h[s];
    const l = it ? ITEMS[it].legend : undefined;
    return l ? [l] : [];
  });
}

export function isLegend(id: string): id is LegendId {
  return id in LEGENDS;
}

/** Wolves running with this hero: at their side between fights, and still standing in any fight. */
export function wolvesOf(world: World, h: Hero): number {
  let n = h.legion.filter((r) => r.type === 'wolf').length;
  for (const enc of Object.values(world.encounters)) n += (enc.legion ?? []).filter((r) => r.by === h.id && r.type === 'wolf' && r.hp > 0).length;
  return n;
}

function roomOf(h: Hero): number | null {
  return h.pos.kind === 'room' ? h.pos.room : null;
}

/** Who `id` can be aimed at now (hero ids; [] for an untargeted or a room-targeted ability). */
export function legendTargets(world: World, h: Hero, id: LegendId, enc: Encounter | null): string[] {
  const here = roomOf(h);
  const heroes = Object.values(world.heroes).filter((o) => inDungeon(o) || o.dead);
  switch (LEGENDS[id].target) {
    case 'ally':
      return enc
        ? enc.heroes.map((x) => world.heroes[x]).filter(isConscious).map((x) => x.id)
        : heroes.filter((o) => isConscious(o) && o.pos.kind === 'room' && o.pos.room === here && o.encounter === null).map((o) => o.id);
    case 'fallen':
      // Downed or dead, lying in this room (a dead one an Undertaker has Raised already walks again, after a fashion).
      return heroes
        .filter((o) => o !== h && !o.extracted && (o.dead ? !o.raised : o.downedAt !== null) && here !== null && bodyRoom(o) === here)
        .map((o) => o.id);
    default:
      return [];
  }
}

/** Why `h` can't use `id` now (`enc`: in that fight), or null if they can. A missing target is fine (one is picked). */
export function legendError(world: World, h: Hero, id: LegendId, target: string | null, room: number | null, enc: Encounter | null): string | null {
  const l = LEGENDS[id];
  if (!legendsOf(h).includes(id)) return 'You wear nothing that does that.';
  const cd = h.cooldowns[id] ?? 0;
  if (cd > 0) return `${l.name} is ready in ${cd} turn${cd === 1 ? '' : 's'}.`;
  if (enc && !l.combat) return `${l.name} can't be used in a fight.`;
  if (!enc && !l.field) return `${l.name} only works in a fight.`;
  if (!enc && h.pos.kind !== 'room') return 'Not while walking a tunnel.';
  if (l.target === 'room') {
    if (room === null) return PICK_A_ROOM;
    if (!world.dungeon.rooms[room] || !h.seen.includes(room)) return "You don't know that room.";
    if (id === 'waystep' && room === roomOf(h)) return 'You are already there.';
  }
  if (l.target === 'ally' || l.target === 'fallen') {
    const targets = legendTargets(world, h, id, enc);
    if (!targets.length) return l.target === 'fallen' ? 'Nobody lies fallen here.' : 'Nobody is here.';
    if (target !== null && !targets.includes(target)) return 'Pick someone it can reach.';
  }
  if (id === 'promise' && h.promise) return 'Your next fight is already promised.';
  if (id === 'howl' && wolvesOf(world, h) >= LEGEND_RULES.maxWolves) return `${LEGEND_RULES.maxWolves} wolves already run with you.`;
  if (id === 'bastion' && heroBlock(h) <= 0) return 'You have no Block to build on.';
  return null;
}

/**
 * Use it (checked by the caller). `enc`/`events`: in a fight, on the hero's turn; otherwise in the field, where
 * what happens is told as notices.
 */
export function useLegend(world: World, h: Hero, id: LegendId, target: string | null, room: number | null, enc: Encounter | null, events: CombatEvent[] | null) {
  const l = LEGENDS[id];
  const cd = cooldownFor(h, l.cooldown);
  if (cd > 0) h.cooldowns[id] = cd;
  h.cdClock = 0;
  const tell = (text: string, kind: CombatEvent['kind'] = 'status', who?: string, amount?: number) => {
    if (events) events.push({ actor: h.id, kind, text, target: who, amount });
    else notify(world, h, text);
  };
  const pick = () => {
    const targets = legendTargets(world, h, id, enc);
    return world.heroes[target && targets.includes(target) ? target : targets[0]];
  };
  switch (id) {
    case 'promise':
      h.promise = true;
      tell('You whisper a name into the dark. Whatever leads your next fight will not live to see it.');
      return;
    case 'quake': {
      if (!enc || !events) return;
      const base = abilitiesOf(h)[0].power + (h.cls === 'undertaker' ? h.spadeBonus : 0);
      events.push({ actor: h.id, kind: 'info', text: `${h.name} brings the earth itself down on every foe!` });
      for (const m of monstersIn(world, enc.room)) {
        heroHits(world, enc, h, m, base, events, l.name);
        if (world.monsters[m.id]) {
          m.st.stun = true;
          events.push({ actor: h.id, kind: 'status', target: m.id, text: `${ENEMIES[m.type].name} is stunned.` });
        }
      }
      return;
    }
    case 'unmake':
      if (room !== null) unmake(world, h, room);
      return;
    case 'redeem': {
      const t = pick();
      if (!t) return;
      const healed = t.maxHp - t.hp;
      t.hp = t.maxHp;
      t.stress = 0;
      t.light = 0;
      const who = events ? (t === h ? `${h.name} finds` : `${h.name} grants ${t.name}`) : t === h ? 'You find' : `You grant ${t.name}`;
      tell(`${who} redemption: whole again, untroubled, and in the dark.`, 'heal', t.id, healed);
      if (!events && t !== h) notify(world, t, `${h.name} redeems you: your wounds and your fears are gone, and so is your light.`);
      return;
    }
    case 'bastion': {
      const shield = Math.max(0, heroBlock(h)) * LEGEND_RULES.bastionPerBlock;
      h.st.shield = (h.st.shield ?? 0) + shield;
      tell(`${events ? `${h.name} sets their` : 'You set your'} feet like a wall. (+${shield} Shield)`, 'status', h.id);
      return;
    }
    case 'forgive': {
      const t = pick();
      if (t) forgive(world, h, t, tell);
      return;
    }
    case 'howl': {
      const wolf = summonWolf(world);
      if (enc) {
        (enc.legion ??= []).push({ ...wolf, id: `r${world.nextId++}`, by: h.id });
      } else h.legion.push(wolf);
      tell(`${events ? `${h.name} howls` : 'You howl'}, and a wolf answers. (${wolvesOf(world, h)}/${LEGEND_RULES.maxWolves})`);
      return;
    }
    case 'waystep':
      if (room !== null) waystep(world, h, room, enc, events);
      return;
  }
}

/** A wolf for Howl: middling Speed and HP, a weak bite, scaled with the dungeon like the monsters it fights. */
function summonWolf(world: World): Omit<Risen, 'id' | 'by'> {
  const scale = monsterScale(world, 'wolf', world.escalation);
  const hp = Math.round(ENEMIES.wolf.maxHp * scale);
  return { type: 'wolf', hp, maxHp: hp, dmgMult: scale, turns: 1, permanent: true };
}

/** Unmake: every monster, the loot and the event in `room` cease to be (a fight there just ends). */
function unmake(world: World, h: Hero, room: number) {
  const gone: string[] = [];
  const monsters = monstersIn(world, room);
  if (monsters.length) gone.push(`${monsters.length} monster${monsters.length === 1 ? '' : 's'}`);
  for (const m of monsters) delete world.monsters[m.id];
  world.risings = world.risings.filter((r) => r.room !== room);
  delete world.bounty[room];
  const pile = world.piles[room];
  if (pile && (pile.items.length || pile.gold || pile.dropped || pile.corpseGold)) gone.push('the loot');
  delete world.piles[room];
  const ev = world.events[room];
  if (ev) {
    gone.push('what was there to be done');
    delete world.events[room];
    for (const o of Object.values(world.heroes)) {
      if (o.channel?.kind === 'event' && o.channel.room === room) o.channel = null;
      if (o.pos.kind === 'room' && o.pos.room === room) o.queuedEvent = null;
    }
  }
  for (const v of Object.values(world.villagers)) {
    if (v.state !== 'captive' || v.room !== room) continue;
    delete world.villagers[v.id];
    if (!gone.includes('what was there to be done')) gone.push('the captive');
  }
  const where = theRoom(world.dungeon.rooms[room].name);
  const enc = world.encounters[room];
  if (enc) say(world, enc, `${h.name} unmakes ${where}. Every foe here is simply gone.`);
  const what = gone.length ? gone.join(', ') : 'nothing at all, as it turns out';
  notify(world, h, `You unmake ${where}: ${what}.`);
  for (const o of Object.values(world.heroes)) {
    if (o !== h && inDungeon(o) && o.pos.kind === 'room' && o.pos.room === room) notify(world, o, `${where} shivers and is suddenly emptier: ${h.name} has unmade it.`);
  }
  chronicle(world, `${h.name} unmade ${where} (${what}).`);
}

/** Forgive: a downed ally gets up whole; a dead one lives again, at full HP (with nothing: their things lie where they fell). */
function forgive(world: World, h: Hero, t: Hero, tell: (text: string, kind?: CombatEvent['kind'], who?: string, amount?: number) => void) {
  const where = bodyRoom(t);
  if (!t.dead) {
    reviveHero(t, 1, world, h);
    tell(`${h.encounter !== null ? `${h.name} calls` : 'You call'} ${t.name} back to their feet, whole.`, 'heal', t.id, t.hp);
    if (h.encounter === null) notify(world, t, `${h.name} calls you back to your feet, whole.`);
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
  tell(`${h.encounter !== null ? `${h.name} speaks` : 'You speak'} a word, and ${t.name} rises from death, whole!`, 'heal', t.id, t.hp);
  notify(world, t, `${h.name} calls you back from death. You breathe again.`);
  for (const o of Object.values(world.heroes)) if (o !== h && o !== t && inDungeon(o)) notify(world, o, `Somewhere, ${t.name} draws breath again.`);
  chronicle(world, `${h.name} brought ${t.name} back from the dead in ${theRoom(world.dungeon.rooms[where].name)}.`);
  onHeroInRoom(world, t, where);
}

/** Waystep: out of a fight (if in one) and into any known room, at once. */
function waystep(world: World, h: Hero, room: number, enc: Encounter | null, events: CombatEvent[] | null) {
  const from = roomOf(h);
  if (enc) {
    leaveEncounter(world, enc, h);
    events?.push({ actor: h.id, kind: 'flee', target: h.id, text: `${h.name} steps out of the world.` });
  }
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

/** Promise: as `h` walks into a fight, its strongest foe that isn't a Boss dies (highest tier, ties at random). */
export function keepPromise(world: World, enc: Encounter, h: Hero) {
  if (!h.promise || !isConscious(h)) return;
  const foes = monstersIn(world, enc.room).filter((m) => ENEMIES[m.type].tier < BOSS_TIER);
  if (!foes.length) return;
  const top = Math.max(...foes.map((m) => ENEMIES[m.type].tier));
  const m = world.rng.pick(foes.filter((x) => ENEMIES[x.type].tier === top));
  h.promise = false;
  const events: CombatEvent[] = [];
  applyMonsterDamage(world, m, m.hp, events);
  // Its death, told the Promise's way.
  const death = events.find((e) => e.kind === 'death' && e.target === m.id);
  if (death) death.text = `The ${ENEMIES[m.type].name} dies as faint laughter echoes.`;
  record(world, enc, events);
}
