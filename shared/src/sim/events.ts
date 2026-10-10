import { LIGHT_DIM } from '../content/constants';
import {
  AFFLICTIONS, channelTime, EVENT_SEEDING, EVENTS, SPEED_EVENTS, STRESS, type AfflictionId, type EventKind,
} from '../content/events';
import { corridorBetween, neighbours, otherEnd } from '../dungeon/gen';
import { addStress, armored, downHero, hurtHero, inDungeon, isConscious, monstersIn, onHeroInRoom, pickGroup, spawnGroup } from './combat';
import { collapseCorridor } from './escalation';
import { addToPile, rollItem, rollValuable, seesInDark, takeItem } from './loot';
import { notify } from './notify';
import { addSpeedMod, fmtSpeed } from './speed';
import { chronicle, crGold, explore, type Hero, type World } from './world';

/** A one-off feature of a room (villagers are tracked separately because they move). */
export interface RoomEvent {
  room: number;
  kind: Exclude<EventKind, 'villager'>;
  done: boolean;
  /** Fraction of the work done, 0..1. Lost if the hero stops before it's done. */
  progress: number;
  /** The hero who chose it first and is carrying it out; nobody else can while they are. */
  by: string | null;
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
      world.events[room.id] = { room: room.id, kind, done: false, progress: 0, by: null, spawned: false };
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
  // First come, first served: once someone has started, it's theirs.
  const taken = ev.by && ev.by !== h.id ? `${world.heroes[ev.by]?.name ?? 'Someone'} is already doing it.` : undefined;
  const secs = Math.ceil(channelTime(ev.kind, h.cls) * (1 - ev.progress));
  const c = (id: string, label: string, disabled?: string): EventChoice => ({ id, label: `${label} (${secs}s)`, disabled: taken ?? disabled });
  const progress = ev.progress;
  switch (ev.kind) {
    case 'altar':
      return { kind: ev.kind, progress, choices: [c('channel', 'Cleanse it')] };
    case 'vault':
      return { kind: ev.kind, progress, choices: [c('channel', 'Pick the lock')] };
    case 'idol':
      return { kind: ev.kind, progress, choices: [c('take', 'Take the idol: lots of gold, but the way back may cave in')] };
    case 'stranger':
      return { kind: ev.kind, progress, choices: [c('help', 'Give them a bandage', h.items.includes('bandage') ? undefined : 'You have no bandage.')] };
    case 'well':
      return { kind: ev.kind, progress, choices: [c('drink', 'Drink from the well')] };
    case 'chest':
      return { kind: ev.kind, progress, choices: [c('open', 'Open it (+20 stress)')] };
    case 'crawlspace':
      return {
        kind: ev.kind, progress,
        choices: [c('crawl', 'Squeeze through (4 damage, your torch gutters)', h.leading ? "The villager won't fit." : undefined)],
      };
    case 'quicksilver': {
      const { quicksilverSpeed: s, quicksilverMaxHp: hp } = SPEED_EVENTS;
      return { kind: ev.kind, progress, choices: [c('quaff', `Drink it (Speed ${signed(s)} for the rest of the run, ${hp} max HP)`)] };
    }
    case 'satchel':
      return {
        kind: ev.kind, progress,
        choices: [c('haul', `Haul it (+${SPEED_EVENTS.satchelGold} gold for you alone, Speed ${signed(SPEED_EVENTS.satchelSpeed)} for the rest of the run)`)],
      };
    case 'hourglass':
      return {
        kind: ev.kind, progress,
        choices: [c('turn', `Turn it over (everyone here: Speed ${signed(SPEED_EVENTS.hourglassSpeed)} for ${SPEED_EVENTS.hourglassDuration}s)`)],
      };
    case 'clockwork':
      return { kind: ev.kind, progress, choices: [c('wind', `Wind it (Speed ${signed(SPEED_EVENTS.clockworkSpeed)} for the rest of the run)`)] };
  }
}

/** "−1s" / "+1s" */
function signed(seconds: number): string {
  return `${seconds < 0 ? '−' : '+'}${fmtSpeed(Math.abs(seconds))}`;
}

/** "cleansing the altar" etc., for the event panel and for onlookers' notifications. */
export function choiceVerb(kind: EventKind, choice: string): string {
  if (choice === 'channel') return kind === 'altar' ? 'cleansing the altar' : 'picking the lock';
  const verbs: Record<string, string> = {
    take: 'taking the idol', help: 'bandaging the stranger', drink: 'drinking from the well',
    open: 'opening the chest', crawl: 'squeezing into the crawlspace',
    quaff: 'drinking the quicksilver', haul: 'shouldering the satchel', turn: 'turning the hourglass', wind: 'winding the shrine',
  };
  return verbs[choice] ?? 'busy';
}

// ---------------------------------------------------------------------------
// Choosing (first come, first served)

/** Start an event choice. With `check`, only says whether it could be started (null) or why not. */
export function chooseEvent(world: World, h: Hero, choiceId: string, check = false): string | null {
  if (!isConscious(h) || h.encounter !== null || h.pos.kind !== 'room') return 'Not now.';
  const room = h.pos.room;
  const options = eventChoices(world, h);
  const choice = options?.choices.find((c) => c.id === choiceId);
  if (!options || !choice) return 'Nothing to do here.';
  if (choice.disabled) return choice.disabled;
  if (check) return null;
  if (options.kind === 'villager') {
    const v = villagerHere(world, room)!;
    world.stats.eventsUsed++;
    if (v.state === 'captive') chronicle(world, `${h.name} freed a captive villager.`);
    v.state = 'following';
    v.leader = h.id;
    h.leading = v.id;
    notify(world, h, 'The villager clings to you. Get them to the rendezvous! (You move slower.)');
    for (const o of othersHere(world, h)) notify(world, o, `${h.name} cuts the villager loose and leads them away.`);
    return null;
  }

  // Everything else takes time, and only the hero who started it carries it out.
  const ev = world.events[room];
  if (h.channel?.kind === 'event' && h.channel.room === room) return null;
  ev.by = h.id;
  h.path = [];
  h.channel = { kind: 'event', room, choice: choiceId, until: Infinity };
  const verb = choiceVerb(ev.kind, choiceId);
  notify(world, h, `You start ${verb}… (${Math.ceil(channelTime(ev.kind, h.cls) * (1 - ev.progress))}s; moving away starts it over)`);
  for (const o of othersHere(world, h)) notify(world, o, `${h.name} starts ${verb}.`);
  return null;
}

function othersHere(world: World, h: Hero): Hero[] {
  return Object.values(world.heroes).filter(
    (o) => o !== h && inDungeon(o) && o.pos.kind === 'room' && h.pos.kind === 'room' && o.pos.room === h.pos.room,
  );
}

/** The work is done: the event's outcome goes to the hero who did it. */
function finishEvent(world: World, ev: RoomEvent, h: Hero, choice: string) {
  const rng = world.rng;
  const room = ev.room;
  ev.done = true;
  ev.by = null;
  h.channel = null;
  world.stats.eventsUsed++;
  switch (choice) {
    case 'channel':
      completeChannel(world, ev, h);
      return;
    case 'take': {
      addToPile(world, room, rng.int(60, 90), []);
      chronicle(world, `${h.name} took the Glittering Idol.`);
      // The way you came in caves in (or another way out of here, if you came by crawlspace).
      const back = h.prevRoom !== null ? corridorBetween(world.dungeon, room, h.prevRoom) : undefined;
      const exits = world.dungeon.rooms[room].corridors.filter((cid) => !world.collapsed.includes(cid));
      const cid = back && !world.collapsed.includes(back.id) ? back.id : exits.length ? rng.pick(exits) : null;
      if (cid !== null) collapseCorridor(world, cid, 'The idol\'s trap brings down a tunnel');
      return;
    }
    case 'help': {
      const idx = h.items.indexOf('bandage');
      if (idx < 0) {
        // Used it on someone else in the meantime.
        ev.done = false;
        ev.progress = 0;
        world.stats.eventsUsed--;
        notify(world, h, 'You have no bandage left to give.');
        return;
      }
      takeItem(h, idx);
      if (rng.chance(0.6)) {
        addToPile(world, room, 20, [rollItem(world, 2)]);
        notify(world, h, 'The stranger presses something into your hands, and is gone.');
        chronicle(world, `${h.name} helped a wounded stranger, and was rewarded.`);
      } else {
        notify(world, h, 'The stranger smiles. It was a trap!');
        chronicle(world, `${h.name} helped a wounded stranger. It was an ambush.`);
        spawnGroup(world, room, pickGroup(world, world.tier), world.tier);
        onHeroInRoom(world, h, room);
      }
      return;
    }
    case 'drink': {
      const roll = rng.int(0, 2);
      if (roll === 0) {
        addStress(h, -40);
        notify(world, h, 'The water is cold and clean. Your mind clears. (−40 stress)');
      } else if (roll === 1) {
        h.hp = Math.min(h.maxHp, h.hp + 15);
        notify(world, h, 'Warmth spreads through you. (+15 HP)');
      } else if (h.cls === 'witch') {
        notify(world, h, 'The whispers try to take hold, but you know their tricks.');
      } else if (h.cls === 'zealot') {
        notify(world, h, 'The whispers find nothing in you they can break.');
      } else {
        afflict(world, h, rng.pick(Object.keys(AFFLICTIONS) as AfflictionId[]), 'the well');
      }
      return;
    }
    case 'open':
      addToPile(world, room, 20, [rollItem(world, 2)]);
      addStress(h, 20);
      notify(world, h, 'Something cold brushes your mind as the lid opens. (+20 stress)');
      return;
    case 'crawl': {
      const dest = crawlTarget(world, room);
      if (dest === null) {
        notify(world, h, 'The crack leads nowhere useful.');
        return;
      }
      h.pos = { kind: 'room', room: dest };
      h.path = [];
      h.prevRoom = null;
      h.light = Math.min(h.light, LIGHT_DIM - 1);
      notify(world, h, `You scrape through the dark and tumble out in ${world.dungeon.rooms[dest].name}.`);
      explore(world, h, dest);
      hurtHero(world, h, armored(h, 4), null);
      if (isConscious(h)) onHeroInRoom(world, h, dest);
      return;
    }
    case 'quaff': {
      const { quicksilverSpeed, quicksilverMaxHp } = SPEED_EVENTS;
      addSpeedMod(h, world.time, quicksilverSpeed, null, 'Quicksilver');
      h.maxHp = Math.max(1, h.maxHp + quicksilverMaxHp);
      h.hp = Math.min(h.hp, h.maxHp);
      notify(world, h, `It burns going down. The world slows around you. (Speed ${signed(quicksilverSpeed)}, ${quicksilverMaxHp} max HP)`);
      chronicle(world, `${h.name} drank from the Quicksilver Pool.`);
      return;
    }
    case 'haul':
      h.gold += crGold(world, SPEED_EVENTS.satchelGold);
      addSpeedMod(h, world.time, SPEED_EVENTS.satchelSpeed, null, "Courier's Satchel");
      notify(world, h, `+${crGold(world, SPEED_EVENTS.satchelGold)} gold, all yours. Your shoulders ache already. (Speed ${signed(SPEED_EVENTS.satchelSpeed)})`);
      chronicle(world, `${h.name} took the dead courier's satchel (+${crGold(world, SPEED_EVENTS.satchelGold)} gold).`);
      return;
    case 'turn': {
      const party = [h, ...othersHere(world, h).filter(isConscious)];
      for (const x of party) {
        addSpeedMod(x, world.time, SPEED_EVENTS.hourglassSpeed, SPEED_EVENTS.hourglassDuration, 'Hourglass');
        notify(world, x, `${x === h ? 'You turn the hourglass.' : `${h.name} turns the hourglass.`} The sand runs upward, and so do you. (Speed ${signed(SPEED_EVENTS.hourglassSpeed)} for ${SPEED_EVENTS.hourglassDuration}s)`);
      }
      chronicle(world, `${h.name} turned the Cracked Hourglass${party.length > 1 ? ` for ${party.length} heroes` : ''}.`);
      return;
    }
    case 'wind':
      addSpeedMod(h, world.time, SPEED_EVENTS.clockworkSpeed, null, 'Clockwork Shrine');
      notify(world, h, `The gears catch and begin to tick, and your heart keeps time with them. (Speed ${signed(SPEED_EVENTS.clockworkSpeed)})`);
      chronicle(world, `${h.name} wound the Clockwork Shrine.`);
      return;
  }
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
  // A claim lasts only as long as its hero keeps at it (walking off, a fight or going down all end it).
  for (const ev of Object.values(world.events)) {
    const ch = ev.by ? world.heroes[ev.by]?.channel : null;
    if (ev.by && !(ch?.kind === 'event' && ch.room === ev.room)) abandon(ev);
  }
  for (const h of Object.values(world.heroes)) {
    const ch = h.channel;
    if (ch?.kind !== 'event') continue;
    const ev = world.events[ch.room];
    if (
      !ev || ev.done || ev.by !== h.id || !isConscious(h) || h.encounter !== null || h.pos.kind !== 'room' || h.pos.room !== ch.room ||
      !quiet(world, ch.room)
    ) {
      h.channel = null;
      if (ev?.by === h.id) abandon(ev);
      continue;
    }
    const kind = ev.kind;
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
    if (ev.progress >= 1) finishEvent(world, ev, h, ch.choice);
  }
  tickVillagers(world);
}

/** Stopped before it was done: the work is lost (an altar whose guardians came stays half-cleansed). */
function abandon(ev: RoomEvent) {
  ev.by = null;
  ev.progress = ev.spawned ? 0.5 : 0;
}

function completeChannel(world: World, ev: RoomEvent, h: Hero) {
  if (ev.kind === 'altar') {
    world.objectives.altars++;
    chronicle(world, `${h.name} cleansed the altar in ${world.dungeon.rooms[ev.room].name}.`);
    for (const x of Object.values(world.heroes)) {
      if (!inDungeon(x)) continue;
      addStress(x, -20);
      notify(world, x, `An altar has been cleansed. You feel lighter. (−20 stress; +${EVENT_SEEDING.altarBonus} gold each when you escape)`);
    }
  } else {
    addToPile(world, ev.room, world.rng.int(30, 50), [rollItem(world, 3), rollItem(world, 3), rollValuable(world)]);
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

/** The dungeon wears on the mind, darkness most of all; at 100 stress something breaks. Called every tick. */
export function tickStress(world: World, dt: number) {
  for (const h of Object.values(world.heroes)) {
    if (!isConscious(h)) continue;
    addStress(h, STRESS.basePerSec * dt);
    if (h.light <= 0) addStress(h, STRESS.darkPerSec * dt);
    else if (h.light < LIGHT_DIM && !seesInDark(h)) addStress(h, STRESS.dimPerSec * dt);
    // The Zealot never breaks: stress just stays at 100 (and makes them hit harder).
    if (h.stress < 100 || h.cls === 'zealot') continue;
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
