import { CLASSES, type ClassId } from '../content/classes';
import { LIGHT_DIM, LIGHT_MAX } from '../content/constants';
import { ENEMIES, ESCALATION, type EnemyId } from '../content/enemies';
import {
  AFFLICTIONS, channelTime, CLASS_ELITE, CLASS_EVENTS, ELITE_EVENTS, EVENT_SEEDING, EVENTS, SPEED_EVENTS, STRESS,
  type AfflictionId, type EventKind,
} from '../content/events';
import { Rng } from '../rng';
import { corridorBetween, neighbours, otherEnd } from '../dungeon/gen';
import { addStress, armored, downHero, hurtHero, inDungeon, isConscious, monstersIn, onHeroInRoom, pickGroup, spawnGroup } from './combat';
import { collapseCorridor } from './escalation';
import { addToPile, rollItem, rollResource, seesInDark, takeItem } from './loot';
import { notify } from './notify';
import { openSecretEarly, openSecretFor } from './secrets';
import { toll } from './skills';
import { addSpeedMod, fmtSpeed, speedOf } from './speed';
import { chronicle, crGold, explore, type Hero, type World } from './world';

/** Before this Escalation the Crawlspace leads into a secret room; from it on, toward the exit. */
const CRAWL_TO_EXIT_ESCALATION = 5;

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
  /** Wounded Stranger: a trap or not, decided the first time it matters. */
  trap?: boolean;
  /** Luminous Liturgy: seconds of prayer not yet turned into a blessing. Booming Barrage: Tolls rung so far. */
  pulse?: number;
  rung?: number;
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
  /** This hero's class does it differently: shown with the class icon, saying only what's special. */
  perk?: { cls: ClassId; text: string };
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
    if (room.kind === 'secret' || safe.has(room.id) || !rng.chance(EVENT_SEEDING.chance)) continue;
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

/**
 * Elite Events (user, 2026-10-10): every hero brings a 20% chance that their class's Elite Event is somewhere in the
 * dungeon. Two of a class add up (40%), but there is never more than one of each. Rolled as each hero joins, on
 * odds that make the total come out right: with k of a class, the k-th one's roll is 0.2 / (1 − 0.2·(k−1)).
 * Its own RNG, so the rest of the run is the same with or without it.
 */
export function seedEliteEvent(world: World, h: Hero) {
  const kind = CLASS_ELITE[h.cls];
  if (Object.values(world.events).some((e) => e.kind === kind)) return;
  const heroes = Object.values(world.heroes);
  const k = heroes.filter((x) => x.cls === h.cls).length;
  const p = ELITE_EVENTS.chancePerHero;
  const rng = new Rng(world.seed ^ 0x2545f491 ^ (heroes.length * 0x9e3779b1));
  if (rng.next() >= Math.min(1, p / Math.max(p, 1 - p * (k - 1)))) return;
  const d = world.dungeon;
  const safe = new Set([d.entrance, d.exit, ...neighbours(d, d.entrance)]);
  const free = d.rooms.filter((r) => r.kind === 'normal' && !safe.has(r.id) && !world.events[r.id] && !villagerHere(world, r.id));
  if (!free.length) return;
  const room = rng.pick(free).id;
  world.events[room] = { room, kind, done: false, progress: 0, by: null, spawned: false };
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

/**
 * What a hero standing here could do. Empty if nothing (or not yet safe). Another class's Elite Event comes back
 * as `veiled`, with the class that could do it in `forCls`.
 */
export function eventChoices(world: World, h: Hero): { kind: EventKind; choices: EventChoice[]; progress?: number; forCls?: ClassId } | null {
  if (h.pos.kind !== 'room') return null;
  const room = h.pos.room;
  const v = villagerHere(world, room);
  if (v) {
    if (!quiet(world, room)) return { kind: 'villager', choices: [] };
    const busy = h.leading ? 'You are already leading someone.' : undefined;
    const lead: EventChoice = { id: 'lead', label: v.state === 'captive' ? 'Cut them loose and lead them out' : 'Lead them to the rendezvous', disabled: busy };
    if (h.cls === 'warden') lead.perk = { cls: 'warden', text: `They hurry you along: Speed ${signed(CLASS_EVENTS.wardenEscortSpeed)} while you escort them.` };
    return { kind: 'villager', choices: [lead] };
  }
  const ev = world.events[room];
  if (!ev || ev.done) return null;
  const elite = EVENTS[ev.kind].elite;
  if (elite && elite !== h.cls) return { kind: 'veiled', choices: [], forCls: elite };
  if (!quiet(world, room)) return { kind: ev.kind, choices: [] };
  // First come, first served: once someone has started, it's theirs.
  const taken = ev.by && ev.by !== h.id ? `${world.heroes[ev.by]?.name ?? 'Someone'} is already doing it.` : undefined;
  const secs = Math.ceil(channelTime(ev.kind, speedOf(h, world.time)) * (1 - ev.progress));
  const c = (id: string, label: string, disabled?: string): EventChoice => ({ id, label: `${label} (${secs}s)`, disabled: taken ?? disabled });
  /** The same choice, done this hero's class's way. */
  const perk = (choice: EventChoice, cls: ClassId, text: string): EventChoice => ({ ...choice, perk: { cls, text } });
  const progress = ev.progress;
  const one = (choice: EventChoice) => ({ kind: ev.kind, progress, choices: [choice] });
  switch (ev.kind) {
    case 'altar':
      return one(h.cls === 'sorceress'
        ? perk(c('channel', 'Cleanse it'), 'sorceress', 'Your rites keep its guardians asleep.')
        : c('channel', 'Cleanse it'));
    case 'vault':
      return one(c('channel', 'Pick the lock'));
    case 'idol':
      return one(h.cls === 'cutthroat'
        ? perk(c('take', 'Take the idol: lots of gold'), 'cutthroat', 'Light fingers: the trap never springs.')
        : c('take', 'Take the idol: lots of gold, but the way back may cave in'));
    case 'stranger':
      return one(h.cls === 'lampbearer'
        ? perk(c('help', 'Tend their wound'), 'lampbearer', 'Your lamp shows them true: no bandage needed, and they repay you.')
        : c('help', 'Give them a bandage', h.items.includes('bandage') ? undefined : 'You have no bandage.'));
    case 'well':
      return one(h.cls === 'zealot'
        ? perk(c('drink', 'Drink from the well'), 'zealot',
            `The whispers feed your fervour: always +${CLASS_EVENTS.zealotWellStress} stress and +${CLASS_EVENTS.zealotWellHp} HP.`)
        : c('drink', 'Drink from the well'));
    case 'chest':
      return one(h.cls === 'undertaker'
        ? perk(c('open', 'Open it'), 'undertaker', 'The dead hold no fear for you: no stress.')
        : c('open', 'Open it (+20 stress)'));
    case 'crawlspace': {
      const where = world.escalation >= CRAWL_TO_EXIT_ESCALATION ? 'toward the rendezvous' : 'to whatever lies hidden beyond';
      const full = h.leading ? "The villager won't fit." : undefined;
      return one(h.cls === 'lampbearer'
        ? perk(c('crawl', `Squeeze through ${where} (4 damage)`, full), 'lampbearer', 'Your lamp stays lit.')
        : c('crawl', `Squeeze through ${where} (4 damage, your torch gutters)`, full));
    }
    case 'quicksilver': {
      const s = SPEED_EVENTS.quicksilverSpeed;
      if (h.cls === 'alchemist') {
        const hp = CLASS_EVENTS.alchemistQuicksilverMaxHp;
        return one(perk(c('quaff', `Drink it (Speed ${signed(s)} for the rest of the run, +${hp} max HP)`), 'alchemist',
          'You know the right dose: it hardens you, too.'));
      }
      return one(c('quaff', `Drink it (Speed ${signed(s)} for the rest of the run, ${SPEED_EVENTS.quicksilverMaxHp} max HP)`));
    }
    case 'satchel':
      return one(c('haul', `Haul it (+${SPEED_EVENTS.satchelGold} gold for you alone, Speed ${signed(SPEED_EVENTS.satchelSpeed)} for the rest of the run)`));
    case 'hourglass':
      return one(h.cls === 'bellwright'
        ? perk(c('turn', `Turn it over (everyone here: Speed ${signed(SPEED_EVENTS.hourglassSpeed)} for the rest of the run)`), 'bellwright',
            'You keep its time: the haste never runs out, for any of you.')
        : c('turn', `Turn it over (everyone here: Speed ${signed(SPEED_EVENTS.hourglassSpeed)} for ${SPEED_EVENTS.hourglassDuration}s)`));
    case 'clockwork':
      return one(c('wind', `Wind it (Speed ${signed(SPEED_EVENTS.clockworkSpeed)} for the rest of the run)`));
    // ---- Elite Events: only their own class gets this far ----
    case 'wanderers':
      return one(perk(c('gather', 'Gather them up'), 'warden', 'They will not leave your side until you leave the dungeon.'));
    case 'cant':
      return one(perk(c('read', 'Read the marks'), 'cutthroat', 'Every room, every tunnel, every hidden way: yours alone.'));
    case 'liturgy':
      return one(perk({ id: 'pray', label: 'Pray (as long as you like)', disabled: taken }, 'lampbearer',
        `Every second: +${ELITE_EVENTS.liturgyHp} HP, +${ELITE_EVENTS.liturgyLight} light and −${ELITE_EVENTS.liturgyStress} stress to every ally, wherever they are.`));
    case 'sacrament':
      return one(perk(c('partake', 'Drink from the chalice'), 'sorceress', `+${ELITE_EVENTS.sacramentStress} stress to every hero; Speed 2s for the rest of the run.`));
    case 'uprising':
      return one(perk(c('raise', 'Wake the dead'), 'undertaker', `${ELITE_EVENTS.uprisingRisen} Risen follow you for good.`));
    case 'barrage':
      return one(perk(c('ring', 'Ring the great bell'), 'bellwright', `It Tolls every ${ELITE_EVENTS.barrageEvery}s while you ring.`));
    case 'zenith':
      return one(perk(c('sit', 'Sit and let it in'), 'zealot', `Your stress can rise to ${ELITE_EVENTS.zenithStressMax}.`));
    case 'alacrity':
      return one(perk(c('rework', 'Rework your bottles'), 'alchemist', `Every consumable you carry: Speed ${signed(ELITE_EVENTS.alacrityPerItem)}.`));
    case 'veiled':
      return null;
  }
}

/** What another class sees at an Elite Event. */
export function veiledText(cls: ClassId): string {
  return `Maybe ${CLASSES[cls].name} knows what to do with this…`;
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
    gather: 'gathering the wanderers', read: 'reading the marks', pray: 'praying at the shrine', partake: 'drinking from the chalice',
    raise: 'waking the dead', ring: 'ringing the great bell', sit: 'sitting in silence', rework: 'reworking their bottles',
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
  const secs = channelTime(ev.kind, speedOf(h, world.time)) * (1 - ev.progress);
  notify(world, h, Number.isFinite(secs)
    ? `You start ${verb}… (${Math.ceil(secs)}s; moving away starts it over)`
    : `You start ${verb}. It lasts as long as you stay.`);
  for (const o of othersHere(world, h)) notify(world, o, `${h.name} starts ${verb}.`);
  return null;
}

function othersHere(world: World, h: Hero): Hero[] {
  return Object.values(world.heroes).filter(
    (o) => o !== h && inDungeon(o) && o.pos.kind === 'room' && h.pos.kind === 'room' && o.pos.room === h.pos.room,
  );
}

/** Whether this Wounded Stranger is a trap: rolled the first time it matters, then fixed. */
function strangerIsTrap(world: World, ev: RoomEvent): boolean {
  ev.trap ??= world.rng.chance(EVENT_SEEDING.strangerTrap);
  return ev.trap;
}

/** The stranger's friends spring out (at the dungeon's strength) and the hero is caught in the fight. */
function ambush(world: World, h: Hero, room: number) {
  spawnGroup(world, room, pickGroup(world, world.escalation), world.escalation);
  onHeroInRoom(world, h, room);
}

/**
 * A hero is about to walk out of a room. Turning your back on a Wounded Stranger that's a trap springs it
 * (user, 2026-10-10): the hero is caught before they can go. Returns true if they were.
 */
export function leaveStranger(world: World, h: Hero, room: number): boolean {
  const ev = world.events[room];
  if (ev?.kind !== 'stranger' || ev.done || !isConscious(h) || h.encounter !== null || !quiet(world, room)) return false;
  if (!strangerIsTrap(world, ev)) return false;
  ev.done = true;
  ev.by = null;
  notify(world, h, 'As you turn to go, the stranger is suddenly on their feet. It was a trap!');
  chronicle(world, `${h.name} walked away from a wounded stranger. It was an ambush.`);
  ambush(world, h, room);
  return true;
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
      // A Cutthroat lifts it without springing the trap.
      if (h.cls === 'cutthroat') {
        notify(world, h, 'You ease the idol off the plate, and the ceiling holds.');
        return;
      }
      // The way you came in caves in (or another way out of here, if you came by crawlspace).
      const back = h.prevRoom !== null ? corridorBetween(world.dungeon, room, h.prevRoom) : undefined;
      const exits = world.dungeon.rooms[room].corridors.filter((cid) => !world.collapsed.includes(cid));
      const cid = back && !world.collapsed.includes(back.id) ? back.id : exits.length ? rng.pick(exits) : null;
      if (cid !== null) collapseCorridor(world, cid, 'The idol\'s trap brings down a tunnel');
      return;
    }
    case 'help': {
      // A Lampbearer tends them with lamplight alone, and sees them for what they are.
      const lamp = h.cls === 'lampbearer';
      if (!lamp) {
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
      }
      if (lamp || !strangerIsTrap(world, ev)) {
        addToPile(world, room, 20, [rollItem(world, 2)]);
        notify(world, h, 'The stranger presses something into your hands, and is gone.');
        chronicle(world, `${h.name} helped a wounded stranger, and was rewarded.`);
      } else {
        notify(world, h, 'The stranger smiles. It was a trap!');
        chronicle(world, `${h.name} helped a wounded stranger. It was an ambush.`);
        ambush(world, h, room);
      }
      return;
    }
    case 'drink': {
      if (h.cls === 'zealot') {
        const { zealotWellStress: stress, zealotWellHp: hp } = CLASS_EVENTS;
        addStress(h, stress);
        h.hp = Math.min(h.maxHp, h.hp + hp);
        notify(world, h, `The whispers pour in, and you drink them down gladly. (+${stress} stress, +${hp} HP)`);
        return;
      }
      const roll = rng.int(0, 2);
      if (roll === 0) {
        addStress(h, -40);
        notify(world, h, 'The water is cold and clean. Your mind clears. (−40 stress)');
      } else if (roll === 1) {
        h.hp = Math.min(h.maxHp, h.hp + 15);
        notify(world, h, 'Warmth spreads through you. (+15 HP)');
      } else {
        afflict(world, h, rng.pick(Object.keys(AFFLICTIONS) as AfflictionId[]), 'the well');
      }
      return;
    }
    case 'open':
      addToPile(world, room, 20, [rollItem(world, 2)]);
      if (h.cls === 'undertaker') {
        notify(world, h, 'Something cold brushes your mind as the lid opens. You have known worse company.');
      } else {
        addStress(h, 20);
        notify(world, h, 'Something cold brushes your mind as the lid opens. (+20 stress)');
      }
      return;
    case 'crawl': {
      const dest = crawlTarget(world, h, room);
      if (dest === null) {
        notify(world, h, 'The crack leads nowhere useful.');
        return;
      }
      h.pos = { kind: 'room', room: dest };
      h.path = [];
      h.prevRoom = null;
      // A Lampbearer keeps their lamp lit through the squeeze.
      if (h.cls !== 'lampbearer') h.light = Math.min(h.light, LIGHT_DIM - 1);
      notify(world, h, `You scrape through the dark and tumble out in ${world.dungeon.rooms[dest].name}.`);
      explore(world, h, dest);
      hurtHero(world, h, armored(h, 4), null);
      if (isConscious(h)) onHeroInRoom(world, h, dest);
      return;
    }
    case 'quaff': {
      const speed = SPEED_EVENTS.quicksilverSpeed;
      const maxHp = h.cls === 'alchemist' ? CLASS_EVENTS.alchemistQuicksilverMaxHp : SPEED_EVENTS.quicksilverMaxHp;
      addSpeedMod(h, world.time, speed, null, 'Quicksilver');
      h.maxHp = Math.max(1, h.maxHp + maxHp);
      h.hp = Math.max(1, Math.min(h.maxHp, h.hp + Math.max(0, maxHp)));
      const hpText = `${maxHp > 0 ? '+' : ''}${maxHp} max HP`;
      notify(world, h, h.cls === 'alchemist'
        ? `You measure out just enough. The world slows around you, and your skin sets like metal. (Speed ${signed(speed)}, ${hpText})`
        : `It burns going down. The world slows around you. (Speed ${signed(speed)}, ${hpText})`);
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
      // Turned by a Bellwright, it keeps their time: the haste never wears off.
      const duration = h.cls === 'bellwright' ? null : SPEED_EVENTS.hourglassDuration;
      const lasts = duration === null ? 'for the rest of the run' : `for ${duration}s`;
      for (const x of party) {
        addSpeedMod(x, world.time, SPEED_EVENTS.hourglassSpeed, duration, 'Hourglass');
        notify(world, x, `${x === h ? 'You turn the hourglass.' : `${h.name} turns the hourglass.`} The sand runs upward, and so do you. (Speed ${signed(SPEED_EVENTS.hourglassSpeed)} ${lasts})`);
      }
      chronicle(world, `${h.name} turned the Cracked Hourglass${party.length > 1 ? ` for ${party.length} heroes` : ''}.`);
      return;
    }
    case 'wind':
      addSpeedMod(h, world.time, SPEED_EVENTS.clockworkSpeed, null, 'Clockwork Shrine');
      notify(world, h, `The gears catch and begin to tick, and your heart keeps time with them. (Speed ${signed(SPEED_EVENTS.clockworkSpeed)})`);
      chronicle(world, `${h.name} wound the Clockwork Shrine.`);
      return;
    // ---- Elite Events ----
    case 'gather': {
      const n = ELITE_EVENTS.wanderers;
      h.wanderers += n;
      notify(world, h, `${n} villagers fall in behind your shield. They won't leave until you do. (Speed ${signed(n * CLASS_EVENTS.wardenEscortSpeed)}; +${n * EVENT_SEEDING.villagerBonus} gold each for those who escape, if you do)`);
      chronicle(world, `${h.name} gathered ${n} wayward villagers.`);
      return;
    }
    case 'read':
      readTheCant(world, h);
      return;
    case 'partake': {
      h.elite.sacrament = true;
      for (const x of Object.values(world.heroes)) {
        if (!inDungeon(x)) continue;
        const added = Math.round(addStress(x, ELITE_EVENTS.sacramentStress));
        notify(world, x, x === h
          ? `It tastes of every sin in this place. Everyone feels it, and you are quicker than anything down here. (+${added} stress, Speed 2s)`
          : `A cold shudder runs through you: somewhere, ${h.name} has drunk something terrible. (+${added} stress)`);
      }
      chronicle(world, `${h.name} partook of the Sinful Sacrament.`);
      return;
    }
    case 'raise': {
      const scale = 1 + ESCALATION.escalationScaling * world.escalation;
      const kinds: EnemyId[] = ['ghoul', 'crawler', 'acolyte', 'brute'];
      for (let i = 0; i < ELITE_EVENTS.uprisingRisen; i++) {
        const type = rng.pick(kinds);
        const hp = Math.round(ENEMIES[type].maxHp * scale);
        h.legion.push({ type, hp, maxHp: hp, dmgMult: scale, turns: 1, permanent: true });
      }
      const names = h.legion.filter((r) => r.type).map((r) => ENEMIES[r.type!].name).join(', ');
      notify(world, h, `The grave heaves. Your dead rise to follow you: ${names}.`);
      for (const o of othersHere(world, h)) notify(world, o, `${h.name} wakes the dead. They follow the Undertaker now.`);
      chronicle(world, `${h.name} raised an Unholy Uprising (${names}).`);
      return;
    }
    case 'ring':
      notify(world, h, 'The great bell falls silent at last.');
      chronicle(world, `${h.name} rang the great bell.`);
      return;
    case 'sit':
      h.elite.zenith = true;
      notify(world, h, `You let it all in, and there is room for more. (Stress can rise to ${ELITE_EVENTS.zenithStressMax})`);
      chronicle(world, `${h.name} reached the Zen Zenith.`);
      return;
    case 'rework':
      h.elite.alacrity = true;
      notify(world, h, `Thinner glass, tighter stoppers. Every consumable you carry quickens you. (Speed ${signed(ELITE_EVENTS.alacrityPerItem)} each)`);
      chronicle(world, `${h.name} reworked their bottles.`);
      return;
  }
}

/** Cunning Cant: the whole map, and every secret room opened to this Cutthroat alone until it opens for everyone. */
function readTheCant(world: World, h: Hero) {
  const d = world.dungeon;
  h.elite.cant = true;
  for (const s of d.secrets) if (!s.open || s.corridor.privy) openSecretFor(world, s, [h.id]);
  for (const r of d.rooms) if (r.corridors.length && !h.seen.includes(r.id)) h.seen.push(r.id);
  notify(world, h, 'The marks unfold into a map: every room, every tunnel, and the hidden ways only your kind knows.');
  chronicle(world, `${h.name} read the thieves' cant.`);
}

/** Luminous Liturgy: one second of prayer, felt by every ally in the dungeon. */
function bless(world: World) {
  for (const x of Object.values(world.heroes)) {
    if (!inDungeon(x) || !isConscious(x)) continue;
    x.hp = Math.min(x.maxHp, x.hp + ELITE_EVENTS.liturgyHp);
    x.light = Math.min(LIGHT_MAX, x.light + ELITE_EVENTS.liturgyLight);
    addStress(x, -ELITE_EVENTS.liturgyStress);
  }
}

/**
 * Before Escalation 5: a random secret room this hero hasn't been in, broken open early if it's still sealed
 * (user, 2026-10-10). From Escalation 5, or with none left: three hops toward the exit.
 */
function crawlTarget(world: World, h: Hero, from: number): number | null {
  if (world.escalation < CRAWL_TO_EXIT_ESCALATION) {
    const hidden = world.dungeon.secrets.filter((s) => !h.explored.includes(s.room));
    if (hidden.length) {
      const s = world.rng.pick(hidden);
      openSecretEarly(world, s);
      return s.room;
    }
  }
  return crawlToward(world, from);
}

/** Three hops along the real shortest open route toward the exit (stopping short of it). */
function crawlToward(world: World, from: number): number | null {
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
    // Luminous Liturgy never finishes: it blesses every ally each second the Lampbearer keeps praying.
    if (kind === 'liturgy') {
      if (ev.pulse === undefined) {
        world.stats.eventsUsed++;
        chronicle(world, `${h.name} began the Luminous Liturgy.`);
        for (const x of Object.values(world.heroes)) if (x !== h && inDungeon(x)) notify(world, x, `A warm light reaches you from far away: ${h.name} is praying.`);
      }
      ev.pulse = (ev.pulse ?? 0) + dt;
      for (; ev.pulse >= 1; ev.pulse -= 1) bless(world);
      continue;
    }
    ev.progress = Math.min(1, ev.progress + dt / channelTime(kind, speedOf(h, world.time)));
    // Booming Barrage: a Toll every so often while the bell swings.
    if (kind === 'barrage') {
      const due = Math.floor((ev.progress * ELITE_EVENTS.barrageTime) / ELITE_EVENTS.barrageEvery + 1e-9);
      for (; (ev.rung ?? 0) < due; ev.rung = (ev.rung ?? 0) + 1) toll(world, h);
    }
    // The Sorceress's rites keep the guardians asleep.
    if (kind === 'altar' && ev.progress >= 0.5 && !ev.spawned && h.cls !== 'sorceress') {
      ev.spawned = true;
      notify(world, h, 'The altar shrieks. Its guardians come!');
      // Guardians are a notch stronger than the dungeon around them (user, 2026-10-10; were a notch weaker).
      const t = world.escalation + EVENT_SEEDING.guardianEscalations;
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
  ev.rung = 0;
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
    addToPile(world, ev.room, world.rng.int(30, 50), [rollItem(world, 3), rollItem(world, 3), rollResource(world)]);
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
    // The Zealot never breaks: stress just stays at its cap (and makes them hit harder).
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
