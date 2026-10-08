import { LIGHT_DIM } from '../content/constants';
import {
  AFFLICTIONS, channelTime, EVENT_SEEDING, EVENTS, STRESS, type AfflictionId, type EventKind,
} from '../content/events';
import { corridorBetween, neighbours, otherEnd } from '../dungeon/gen';
import { addStress, downHero, inDungeon, isConscious, monstersIn, onHeroInRoom, pickGroup, spawnGroup } from './combat';
import { collapseCorridor } from './escalation';
import { addToPile, rollItem, takeItem } from './loot';
import { notify } from './notify';
import { chronicle, explore, type Hero, type World } from './world';

/** A one-off feature of a room (villagers are tracked separately because they move). */
export interface RoomEvent {
  room: number;
  kind: Exclude<EventKind, 'villager'>;
  done: boolean;
  /** Channelled events (altar, vault): fraction complete, 0..1. Survives interruptions. */
  progress: number;
  /** Altar: the guardians have been summoned. */
  spawned: boolean;
}

export interface Villager {
  id: string;
  /** Where they are when nobody is leading them. */
  room: number;
  leader: string | null;
  hp: number;
  maxHp: number;
  state: 'captive' | 'following' | 'waiting' | 'saved' | 'dead';
}

export interface EventChoice {
  id: string;
  label: string;
  /** Why it can't be chosen right now. */
  disabled?: string;
}

// ---------------------------------------------------------------------------
// Seeding

export function spawnEvents(world: World) {
  const d = world.dungeon;
  const rng = world.rng;
  const safe = new Set([d.entrance, d.exit, ...neighbours(d, d.entrance)]);
  const kinds = Object.values(EVENTS);
  const total = kinds.reduce((s, k) => s + k.weight, 0);
  for (const room of d.rooms) {
    if (safe.has(room.id) || !rng.chance(EVENT_SEEDING.chance)) continue;
    let roll = rng.float(0, total);
    let kind: EventKind = kinds[0].kind;
    for (const k of kinds) {
      roll -= k.weight;
      if (roll <= 0) {
        kind = k.kind;
        break;
      }
    }
    if (kind === 'villager') {
      // Captives are always guarded.
      if (monstersIn(world, room.id).length === 0) spawnGroup(world, room.id, pickGroup(world, 0), 0);
      const v: Villager = {
        id: `v${world.nextId++}`, room: room.id, leader: null,
        hp: EVENT_SEEDING.villagerHp, maxHp: EVENT_SEEDING.villagerHp, state: 'captive',
      };
      world.villagers[v.id] = v;
    } else {
      world.events[room.id] = { room: room.id, kind, done: false, progress: 0, spawned: false };
    }
  }
}

// ---------------------------------------------------------------------------
// Queries

/** Events can be used once a room is quiet: no fight, no monsters. */
function quiet(world: World, room: number): boolean {
  return !world.encounters[room] && monstersIn(world, room).length === 0;
}

export function villagerHere(world: World, room: number): Villager | undefined {
  return Object.values(world.villagers).find((v) => (v.state === 'captive' || v.state === 'waiting') && v.room === room);
}

export function leadingVillager(world: World, h: Hero): Villager | undefined {
  return h.leading ? world.villagers[h.leading] : undefined;
}

/** What a hero standing here could do. Empty if nothing (or not yet safe). */
export function eventChoices(world: World, h: Hero): { kind: EventKind; choices: EventChoice[]; progress?: number } | null {
  if (h.pos.kind !== 'room') return null;
  const room = h.pos.room;
  const v = villagerHere(world, room);
  if (v) {
    if (!quiet(world, room)) return { kind: 'villager', choices: [] };
    const busy = h.leading ? 'You are already leading someone.' : undefined;
    return {
      kind: 'villager',
      choices: [{ id: 'lead', label: v.state === 'captive' ? 'Cut them loose and lead them out' : 'Lead them to the rendezvous', disabled: busy }],
    };
  }
  const ev = world.events[room];
  if (!ev || ev.done) return null;
  if (!quiet(world, room)) return { kind: ev.kind, choices: [] };
  const c = (id: string, label: string, disabled?: string): EventChoice => ({ id, label, disabled });
  switch (ev.kind) {
    case 'altar': {
      const t = channelTime('altar', h.cls);
      return { kind: ev.kind, progress: ev.progress, choices: [c('channel', `Cleanse it (${Math.ceil(t * (1 - ev.progress))}s)`)] };
    }
    case 'vault': {
      const t = channelTime('vault', h.cls);
      return { kind: ev.kind, progress: ev.progress, choices: [c('channel', `Pick the lock (${Math.ceil(t * (1 - ev.progress))}s)`)] };
    }
    case 'idol':
      return { kind: ev.kind, choices: [c('take', 'Take the idol (lots of gold — the way back may cave in)')] };
    case 'stranger':
      return { kind: ev.kind, choices: [c('help', 'Give them a bandage', h.items.includes('bandage') ? undefined : 'You have no bandage.')] };
    case 'well':
      return { kind: ev.kind, choices: [c('drink', 'Drink from the well')] };
    case 'chest':
      return { kind: ev.kind, choices: [c('open', 'Open it (+20 stress)')] };
    case 'crawlspace':
      return {
        kind: ev.kind,
        choices: [c('crawl', 'Squeeze through (4 damage, your torch gutters)', h.leading ? "The villager won't fit." : undefined)],
      };
  }
}

// ---------------------------------------------------------------------------
// Choosing (first come, first served)

export function chooseEvent(world: World, h: Hero, choiceId: string): string | null {
  if (!isConscious(h) || h.encounter !== null || h.pos.kind !== 'room') return 'Not now.';
  const room = h.pos.room;
  const options = eventChoices(world, h);
  const choice = options?.choices.find((c) => c.id === choiceId);
  if (!options || !choice) return 'Nothing to do here.';
  if (choice.disabled) return choice.disabled;
  const rng = world.rng;
  world.stats.eventsUsed++;

  if (options.kind === 'villager') {
    const v = villagerHere(world, room)!;
    if (v.state === 'captive') chronicle(world, `${h.name} freed a captive villager.`);
    v.state = 'following';
    v.leader = h.id;
    h.leading = v.id;
    notify(world, h, 'The villager clings to you. Get them to the rendezvous! (You move slower.)');
    return null;
  }

  const ev = world.events[room];
  switch (choiceId) {
    case 'channel':
      h.path = [];
      h.channel = { kind: 'event', room, until: Infinity };
      return null;
    case 'take': {
      ev.done = true;
      addToPile(world, room, rng.int(60, 90), []);
      chronicle(world, `${h.name} took the Glittering Idol.`);
      // The way you came in caves in (or another way out of here, if you came by crawlspace).
      const back = h.prevRoom !== null ? corridorBetween(world.dungeon, room, h.prevRoom) : undefined;
      const exits = world.dungeon.rooms[room].corridors.filter((cid) => !world.collapsed.includes(cid));
      const cid = back && !world.collapsed.includes(back.id) ? back.id : exits.length ? rng.pick(exits) : null;
      if (cid !== null) collapseCorridor(world, cid, 'The idol\'s trap brings down a tunnel');
      return null;
    }
    case 'help': {
      takeItem(h, h.items.indexOf('bandage'));
      ev.done = true;
      if (rng.chance(0.6)) {
        addToPile(world, room, 20, [rollItem(world)]);
        notify(world, h, 'The stranger presses something into your hands, and is gone.');
        chronicle(world, `${h.name} helped a wounded stranger, and was rewarded.`);
      } else {
        notify(world, h, 'The stranger smiles. It was a trap!');
        chronicle(world, `${h.name} helped a wounded stranger. It was an ambush.`);
        spawnGroup(world, room, pickGroup(world, world.tier), world.tier);
        onHeroInRoom(world, h, room);
      }
      return null;
    }
    case 'drink': {
      ev.done = true;
      const roll = rng.int(0, 2);
      if (roll === 0) {
        addStress(h, -40);
        notify(world, h, 'The water is cold and clean. Your mind clears. (−40 stress)');
      } else if (roll === 1) {
        h.hp = Math.min(h.maxHp, h.hp + 15);
        notify(world, h, 'Warmth spreads through you. (+15 HP)');
      } else if (h.cls === 'hexer') {
        notify(world, h, 'The whispers try to take hold, but you know their tricks.');
      } else {
        afflict(world, h, rng.pick(Object.keys(AFFLICTIONS) as AfflictionId[]), 'the well');
      }
      return null;
    }
    case 'open':
      ev.done = true;
      addToPile(world, room, 20, [rollItem(world)]);
      addStress(h, 20);
      notify(world, h, 'Something cold brushes your mind as the lid opens. (+20 stress)');
      return null;
    case 'crawl': {
      const dest = crawlTarget(world, room);
      if (dest === null) return 'The crack leads nowhere useful.';
      h.pos = { kind: 'room', room: dest };
      h.path = [];
      h.prevRoom = null;
      h.light = Math.min(h.light, LIGHT_DIM - 1);
      notify(world, h, `You scrape through the dark and tumble out in ${world.dungeon.rooms[dest].name}.`);
      explore(world, h, dest);
      h.hp -= 4;
      if (h.hp <= 0) downHero(world, h, null);
      else onHeroInRoom(world, h, dest);
      return null;
    }
  }
  return 'Nothing happens.';
}

/** Three hops along the real shortest open route toward the exit (stopping short of it). */
function crawlTarget(world: World, from: number): number | null {
  const d = world.dungeon;
  const prev = new Map<number, number>([[from, -1]]);
  const q = [from];
  while (q.length) {
    const cur = q.shift()!;
    if (cur === d.exit) break;
    for (const cid of d.rooms[cur].corridors) {
      if (world.collapsed.includes(cid)) continue;
      const n = otherEnd(d.corridors[cid], cur);
      if (!prev.has(n)) (prev.set(n, cur), q.push(n));
    }
  }
  if (!prev.has(d.exit)) return null;
  const path: number[] = [];
  for (let cur = d.exit; cur !== from; cur = prev.get(cur)!) path.unshift(cur);
  const hops = Math.min(3, path.length - 1);
  return hops >= 1 ? path[hops - 1] : null;
}

// ---------------------------------------------------------------------------
// Ticking: channels, villagers, stress

export function tickEvents(world: World, dt: number) {
  for (const h of Object.values(world.heroes)) {
    const ch = h.channel;
    if (ch?.kind !== 'event') continue;
    const ev = world.events[ch.room];
    if (!ev || ev.done || !isConscious(h) || h.encounter !== null || h.pos.kind !== 'room' || h.pos.room !== ch.room || !quiet(world, ch.room)) {
      h.channel = null;
      continue;
    }
    const kind = ev.kind as 'altar' | 'vault';
    ev.progress = Math.min(1, ev.progress + dt / channelTime(kind, h.cls));
    if (kind === 'altar' && ev.progress >= 0.5 && !ev.spawned) {
      ev.spawned = true;
      notify(world, h, 'The altar shrieks. Its guardians come!');
      // Guardians are a notch weaker than the dungeon around them.
      const t = Math.max(0, world.tier - 1);
      spawnGroup(world, ev.room, pickGroup(world, t), t);
      onHeroInRoom(world, h, ev.room);
      continue;
    }
    if (ev.progress >= 1) completeChannel(world, ev, h);
  }
  tickVillagers(world);
}

function completeChannel(world: World, ev: RoomEvent, h: Hero) {
  ev.done = true;
  for (const x of Object.values(world.heroes)) if (x.channel?.kind === 'event' && x.channel.room === ev.room) x.channel = null;
  if (ev.kind === 'altar') {
    world.objectives.altars++;
    chronicle(world, `${h.name} cleansed the altar in ${world.dungeon.rooms[ev.room].name}.`);
    for (const x of Object.values(world.heroes)) {
      if (!inDungeon(x)) continue;
      addStress(x, -20);
      notify(world, x, `An altar has been cleansed. You feel lighter. (−20 stress; +${EVENT_SEEDING.altarBonus} gold each when you escape)`);
    }
  } else {
    addToPile(world, ev.room, world.rng.int(30, 50), [rollItem(world), rollItem(world)]);
    notify(world, h, 'The lock clicks open!');
    chronicle(world, `${h.name} cracked open a vault.`);
  }
}

function tickVillagers(world: World) {
  for (const v of Object.values(world.villagers)) {
    if (v.state !== 'following' || !v.leader) continue;
    const leader = world.heroes[v.leader];
    const atRendezvous = leader.pos.kind === 'room' && leader.pos.room === world.dungeon.exit;
    if (leader.extracted || (atRendezvous && isConscious(leader))) {
      // Delivered: they slip out on their own, and you're free to go back in.
      v.state = 'saved';
      v.room = world.dungeon.exit;
      leader.leading = null;
      world.objectives.villagers++;
      notify(world, leader, `The villager squeezes out through a crack in the wall. Saved! (+${EVENT_SEEDING.villagerBonus} gold each for those who escape)`);
      chronicle(world, `${leader.name} brought a villager to safety.`);
    } else if (!isConscious(leader)) {
      v.state = 'waiting';
      v.room = leader.pos.kind === 'room' ? leader.pos.room : leader.pos.from;
      v.leader = null;
      leader.leading = null;
      chronicle(world, `A villager was left alone in ${world.dungeon.rooms[v.room].name}.`);
    } else if (leader.pos.kind === 'room') {
      v.room = leader.pos.room;
    }
  }
}

/** Monsters sometimes strike the villager you're escorting. Returns the event text, or null. */
export function maybeHitVillager(world: World, room: number, dmg: number, attacker: string): string | null {
  const v = Object.values(world.villagers).find((x) => x.state === 'following' && x.room === room);
  if (!v || !world.rng.chance(0.15)) return null;
  v.hp -= dmg;
  if (v.hp > 0) return `${attacker} strikes the villager! (${v.hp}/${v.maxHp})`;
  v.state = 'dead';
  const leader = v.leader ? world.heroes[v.leader] : undefined;
  if (leader) leader.leading = null;
  v.leader = null;
  chronicle(world, `A villager was killed in ${world.dungeon.rooms[room].name}.`);
  return `${attacker} kills the villager!`;
}

/** Darkness wears on the mind; at 100 stress something breaks. Called every tick. */
export function tickStress(world: World, dt: number) {
  for (const h of Object.values(world.heroes)) {
    if (!isConscious(h)) continue;
    if (h.light <= 0) addStress(h, STRESS.darkPerSec * dt);
    else if (h.light < LIGHT_DIM && !h.items.includes('catseye')) addStress(h, STRESS.dimPerSec * dt);
    if (h.stress < 100) continue;
    if (!h.affliction) {
      afflict(world, h, world.rng.pick(Object.keys(AFFLICTIONS) as AfflictionId[]), 'stress');
      h.stress = STRESS.afterBreak;
    } else {
      h.stress = 80;
      world.stats.heartAttacks++;
      chronicle(world, `${h.name}'s heart gave out under the strain.`);
      notify(world, h, 'Your heart seizes!');
      const enc = h.encounter !== null ? world.encounters[h.encounter] : undefined;
      downHero(world, h, null, enc);
    }
  }
}

function afflict(world: World, h: Hero, id: AfflictionId, cause: string) {
  h.affliction = id;
  world.stats.afflictions++;
  const def = AFFLICTIONS[id];
  chronicle(world, `${h.name} became ${def.name} (${cause}).`);
  notify(world, h, `You have become ${def.name.toUpperCase()}: ${def.desc}`);
}

export function eventName(kind: EventKind): string {
  return EVENTS[kind].name;
}
