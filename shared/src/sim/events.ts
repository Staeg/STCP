import { CLASSES, type ClassId } from '../content/classes';
import { CARDS } from '../content/cards';
import { unburn } from './deck';
import { LIGHT_DIM, LIGHT_MAX, lightStage } from '../content/constants';
import { ENEMIES, ESCALATION, type EnemyId } from '../content/enemies';
import {
  channelTime, CLASS_ELITE, CROWNED, CLASS_EVENTS, ELITE_EVENTS, EVENT_CHOICES, EVENT_SEEDING, EVENTS, LIGHT_LOSS, MORE_EVENTS, SPEED_EVENTS,
  type EventKind,
} from '../content/events';
import { Rng } from '../rng';
import { anvilInto, forgeable, reforged } from '../content/forge';
import { corridorBetween, neighbours, otherEnd, theRoom } from '../dungeon/gen';
import { afterBlock, downHero, gainLight, hurtHero, inDungeon, isConscious, loseLight, monstersIn, onHeroInRoom, pickGroup, spawnGroup } from './combat';
import { collapseCorridor, lureToward, makePack } from './escalation';
import { callReadyIn, hopsFrom } from './call';
import { addToPile, equip, giveItem, hasSpace, rollItem, rollResource, takeItem } from './loot';

import { notify } from './notify';
import { clothReady, freshCharge, spendCloth, wornCharge, type ItemCharge } from './gear';
import { CLOTH, GEAR_SLOTS, ITEMS, LOOT_TABLE, type GearSlot, type ItemId } from '../content/items';
import { openSecretEarly, openSecretFor } from './secrets';
import { toll } from './skills';
import { addSpeedMod, fmtSpeed, speedOf } from './speed';
import { chronicle, explore, scryRoom, type Hero, type World } from './world';

/** A one-off feature of a room (villagers are tracked separately because they move). */
export interface RoomEvent {
  room: number;
  kind: Exclude<EventKind, 'villager'>;
  done: boolean;
  /** Fraction of the work done, 0..1. Lost if the hero stops before it's done. */
  progress: number;
  /** The hero who chose it first and is carrying it out; nobody else can while they are. */
  by: string | null;
  /** Twin Locks: the second hero, on the other wheel (it only turns while both are at it). */
  with?: string | null;
  /** Twin Locks: a Hastening Robe on either wheel was spent on it, so it turns in CLOTH.hastenSecs. */
  hasten?: boolean;
  /** Altar: the guardians have been summoned. */
  spawned: boolean;
  /** Altar: whoever woke the guardians picks the Cleanse back up once they're beaten, if still here and standing. */
  resumeFor?: string;
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
  /** fled: let go after showing the way (Captive, Ask the Way), never counted. */
  state: 'captive' | 'following' | 'waiting' | 'saved' | 'dead' | 'fled';
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

/** `noKing`: a Relic Rite wakes the Dead King itself, so Crowned in Dread isn't in the dungeon (user, 2026-10-11). */
export function spawnEvents(world: World, noKing = false) {
  const d = world.dungeon;
  const rng = world.rng;
  const safe = new Set([d.entrance, d.exit, ...neighbours(d, d.entrance)]);
  const kinds = Object.values(EVENTS).filter((k) => !(noKing && k.kind === 'crowned'));
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
    const lead: EventChoice = { id: 'lead', label: v.state === 'captive' ? 'Cut them loose and lead them out' : 'Lead them to the rendezvous' };
    if (h.leading.length) lead.label += ` (${h.leading.length + 1} in tow)`;
    if (h.cls === 'warden') lead.perk = { cls: 'warden', text: `They hurry you along: Speed ${signed(CLASS_EVENTS.wardenEscortSpeed)} while you escort them.` };
    // Or let them go, and they tell you the way first (user, 2026-10-16).
    const ask: EventChoice = { id: 'ask', label: 'Cut them loose and ask the way: the route to the rendezvous, and where a vault lies (they run off alone)' };
    return { kind: 'villager', choices: [lead, ask] };
  }
  const ev = world.events[room];
  if (!ev || ev.done) return null;
  const elite = EVENTS[ev.kind].elite;
  if (elite && elite !== h.cls) return { kind: 'veiled', choices: [], forCls: elite };
  if (!quiet(world, room)) return { kind: ev.kind, choices: [] };
  // First come, first served: once someone has started, it's theirs.
  const taken = ev.by && ev.by !== h.id ? `${world.heroes[ev.by]?.name ?? 'Someone'} is already doing it.` : undefined;
  const c = (id: string, label: string, disabled?: string): EventChoice => {
    const secs = Math.ceil(eventTime(world, h, ev.kind, id) * (1 - ev.progress));
    return { id, label: `${label} (${secs}s)`, disabled: taken ?? disabled };
  };
  /** The same choice, done this hero's class's way. */
  const perk = (choice: EventChoice, cls: ClassId, text: string): EventChoice => ({ ...choice, perk: { cls, text } });
  const progress = ev.progress;
  const one = (choice: EventChoice) => ({ kind: ev.kind, progress, choices: [choice] });
  /** Every shared event offers two choices (user, 2026-10-16): what it always did, and another trade. */
  const two = (a: EventChoice, b: EventChoice) => ({ kind: ev.kind, progress, choices: [a, b] });
  const X = EVENT_CHOICES;
  switch (ev.kind) {
    case 'altar':
      return two(
        h.cls === 'sorceress'
          ? perk(c('channel', 'Cleanse it'), 'sorceress', 'Your rites keep its guardians asleep.')
          : c('channel', 'Cleanse it'),
        c('desecrate', `Desecrate it: ${X.desecrateGold} gold now, but every hero in the dungeon feels it (−${X.desecrateLight} light each)`),
      );
    case 'vault':
      return two(c('channel', 'Pick the lock'), c('smash', 'Smash it open: loud, so monsters next door come, and one find breaks'));
    case 'idol': {
      const take = h.cls === 'cutthroat'
        ? perk(c('take', 'Take the idol: lots of gold'), 'cutthroat', 'Light fingers: the trap never springs.')
        : c('take', 'Take the idol: lots of gold, but the way back may cave in');
      const item = swapItem(h);
      return two(take, c('swap', item ? `Swap it for your ${ITEMS[item].name}: the gold, and no cave-in` : 'Swap it for something from your pack: no cave-in',
        item ? undefined : 'Nothing in your pack to leave in its place.'));
    }
    case 'stranger':
      return two(
        h.cls === 'lampbearer'
          ? perk(c('help', 'Tend their wound'), 'lampbearer', 'Your lamp shows them true: no bandage needed, and they repay you.')
          : c('help', 'Give them a bandage', h.items.includes('bandage') ? undefined : 'You have no bandage.'),
        c('search', `Search them instead: a sure consumable, but they die (−${X.searchLight} light)`),
      );
    case 'well':
      return two(
        h.cls === 'zealot'
          ? perk(c('drink', 'Drink from the well'), 'zealot',
              `The dark water feeds your fervour: always +${CLASS_EVENTS.zealotWellHp} HP, and your light goes out.`)
          : c('drink', 'Drink from the well'),
        c('wish', `Toss in ${X.wishGold} gold and make a wish: something good rises from the water`,
          h.gold >= X.wishGold ? undefined : `You need ${X.wishGold} gold.`),
      );
    case 'chest':
      return two(
        h.cls === 'undertaker'
          ? perk(c('open', 'Open it'), 'undertaker', 'The dead hold no fear for you: your lamp holds steady.')
          : c('open', `Open it (−${LIGHT_LOSS.chest} light)`),
        c('unbind', 'Unbind the chains carefully: the loot, and no curse'),
      );
    case 'crawlspace': {
      const full = h.leading.length ? (h.leading.length > 1 ? "The villagers won't fit." : "The villager won't fit.") : undefined;
      const hidden = world.dungeon.secrets.some((s) => !h.explored.includes(s.room));
      const cost = h.cls === 'lampbearer' ? '4 damage' : '4 damage, your torch gutters';
      const crawl = (id: string, where: string, disabled?: string) => h.cls === 'lampbearer'
        ? perk(c(id, `Squeeze through ${where} (${cost})`, disabled), 'lampbearer', 'Your lamp stays lit.')
        : c(id, `Squeeze through ${where} (${cost})`, disabled);
      return two(crawl('crawl', 'toward the rendezvous', full),
        crawl('crawl-secret', 'to whatever lies hidden beyond', full ?? (hidden ? undefined : 'Nothing hidden is left to find.')));
    }
    case 'quicksilver': {
      const s = SPEED_EVENTS.quicksilverSpeed;
      const bottle = c('bottle', `Bottle it: a Quicksilver Flask (Speed ${signed(X.flaskSpeed)} for ${X.flaskSecs}s when you drink it)`);
      if (h.cls === 'alchemist') {
        const hp = CLASS_EVENTS.alchemistQuicksilverMaxHp;
        return two(perk(c('quaff', `Drink it (Speed ${signed(s)} for the rest of the run, +${hp} max HP)`), 'alchemist',
          'You know the right dose: it hardens you, too.'), bottle);
      }
      return two(c('quaff', `Drink it (Speed ${signed(s)} for the rest of the run, ${SPEED_EVENTS.quicksilverMaxHp} max HP)`), bottle);
    }
    case 'satchel':
      return two(
        c('haul', `Take it (worth ${ITEMS.satchel.value} gold if you carry it out; Speed ${signed(ITEMS.satchel.speed!)} while you do)`,
          hasSpace(h, 'satchel') ? undefined : 'Your pack is full.'),
        c('pocket', `Pocket a handful: ${X.pocketGold} gold, no weight`),
      );
    case 'hourglass':
      return two(
        h.cls === 'bellwright'
          ? perk(c('turn', `Turn it over (everyone here: Speed ${signed(SPEED_EVENTS.hourglassSpeed)} for the rest of the run)`), 'bellwright',
              'You keep its time: the haste never runs out, for any of you.')
          : c('turn', `Turn it over (everyone here: Speed ${signed(SPEED_EVENTS.hourglassSpeed)} for ${SPEED_EVENTS.hourglassDuration}s)`),
        c('shatter', `Smash it (you alone: Speed ${signed(X.shatterSpeed)} for the rest of the run)`),
      );
    case 'clockwork':
      return two(
        c('wind', `Wind it (Speed ${signed(SPEED_EVENTS.clockworkSpeed)} for the rest of the run)`),
        c('overwind', `Overwind it: ${Math.round(X.overwindChance * 100)}% Speed ${signed(X.overwindSpeed)} for the rest of the run, else it jams (Speed ${signed(X.jamSpeed)} for ${X.jamSecs}s)`),
      );
    case 'locks': {
      // Two at once: the first takes a wheel and waits; the second takes the other, and only then does it turn.
      // Or one alone forces a wheel, for the gold only.
      const forcing = !!ev.by && isForcing(world, ev);
      const first = ev.by && ev.by !== h.id && !forcing ? world.heroes[ev.by] : undefined;
      const full = forcing && ev.by !== h.id ? taken : first && ev.with && ev.with !== h.id ? 'Both wheels are taken.' : undefined;
      const label = first ? `Take the other wheel, with ${first.name}` : 'Take hold of a wheel (someone must turn the other)';
      return two({ id: 'wheel', label: `${label} (${locksSecs(world, ev, h)}s together)`, disabled: full },
        c('force', 'Force one wheel alone: only the gold behind it', ev.by && !forcing ? 'Someone has a wheel: take the other.' : undefined));
    }
    case 'coffin':
      return two(
        c('lie', "Lie down (your light is rekindled to full, but you're down until someone revives you)",
          lightStage(h.light) === 'bright' ? 'Your lamp burns bright already.' : undefined),
        c('lining', `Search the lining: an amulet or a ring (−${X.liningLight} light)`),
      );
    case 'anvil': {
      const slots = GEAR_SLOTS.filter((s) => forgeable(h[s]));
      const temper = c('temper', `Quick temper: your weapon deals +${Math.round(X.temperPct * 100)}% damage for the rest of this run`,
        !h.weapon ? 'You carry no weapon.' : h.tempered ? 'Your weapon is already tempered.' : undefined);
      if (!slots.length) return two(c('forge', 'Reforge your Gear', 'Nothing you wear can be bettered (Rares can’t be).'), temper);
      return { kind: ev.kind, progress, choices: [...slots.map((s) => c(`forge-${s}`, `Reforge your ${ITEMS[h[s]!].name} into ${anvilInto(h[s]!)}`)), temper] };
    }
    case 'loom': {
      const worn = loomMends(world, h);
      const cloth = clothWorn(h);
      return two(
        c('weave', worn.length ? `Weave it whole again: ${worn.join(', ')}` : 'Weave', worn.length ? undefined : 'Nothing of yours is worn thin.'),
        c('unravel', cloth
          ? `Unravel your ${ITEMS[cloth].name} into it: it hurts (${X.unravelDamage} damage), and it weaves for every hero in the dungeon`
          : 'Unravel your Cloth into it, to weave for every hero in the dungeon', cloth ? undefined : 'You wear no Cloth.'),
      );
    }
    case 'scrying':
      return two(
        c('gaze', `Gaze into it (see every ally, and the room they're in, for ${MORE_EVENTS.scrySecs}s)`),
        c('deep', 'Look for the way (see every monster in the dungeon as it is now, and the way to the rendezvous)'),
      );
    case 'crowned':
      return two(
        c('rouse', 'Wake the king (his procession sets out for the exit; stop it to take his treasure)'),
        c('pry', 'Pry a jewel from the throne: a Relic, but something stirs'),
      );
    // ---- Elite Events: only their own class gets this far ----
    case 'wanderers':
      return one(perk(c('gather', 'Gather them up'), 'warden', 'They will not leave your side until you leave the dungeon.'));
    case 'cant':
      return one(perk(c('read', 'Read the marks'), 'cutthroat', 'Every room, every tunnel, every hidden way: yours alone.'));
    case 'liturgy':
      return one(perk({ id: 'pray', label: 'Pray (as long as you like)', disabled: taken }, 'lampbearer',
        `Every second: +${ELITE_EVENTS.liturgyHp} HP and +${ELITE_EVENTS.liturgyLight} light to every ally, wherever they are.`));
    case 'sacrament':
      return one(perk(c('partake', 'Drink from the chalice'), 'sorceress', `−${ELITE_EVENTS.sacramentLight} light to every hero; Speed 2s for the rest of the run.`));
    case 'uprising':
      return one(perk(c('raise', 'Wake the dead'), 'undertaker', `${ELITE_EVENTS.uprisingRisen} Risen follow you for good.`));
    case 'barrage':
      return one(perk(c('ring', 'Ring the great bell'), 'bellwright', `It Tolls every ${ELITE_EVENTS.barrageEvery}s while you ring.`));
    case 'zenith':
      return one(perk(c('sit', 'Sit and let it in'), 'zealot', `Your Fervour is doubled for the rest of the run.`));
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

/** Smith's Anvil: worn Gear below Rare can be reforged. */
/** Spent: on cooldown, used up this run, or already gone off this fight. */
function spent(item: ItemId, c: ItemCharge): boolean {
  return c.cdLeft > 0 || c.usedThisFight || (c.usesLeft ?? Infinity) < (freshCharge(item).usesLeft ?? Infinity);
}

/** The Loom: what it would make whole again for this hero (Cloth worn or carried, Call for Help, the Toll, burned cards). */
function loomMends(world: World, h: Hero): string[] {
  const out: string[] = [];
  for (const slot of GEAR_SLOTS) {
    const c = wornCharge(h, slot);
    if (c && spent(h[slot]!, c)) out.push(ITEMS[h[slot]!].name);
  }
  for (const p of h.packCharges) if (spent(p.item, p.charge)) out.push(ITEMS[p.item].name);
  if (callReadyIn(world, h) > 0) out.push('Call for Help');
  if (h.tolled) out.push('Toll');
  if (h.burned.length) out.push(`burned cards (${h.burned.map((c) => CARDS[c].name).join(', ')})`);
  return out;
}

/** Glittering Idol, Swap: what goes on the plate (the last thing in the pack that isn't a Valuable). */
function swapItem(h: Hero): ItemId | undefined {
  return [...h.items].reverse().find((it) => ITEMS[it].kind !== 'valuable');
}

/** Twin Locks: whoever has it is forcing a wheel alone, not waiting for a second pair of hands. */
function isForcing(world: World, ev: RoomEvent): boolean {
  const ch = ev.by ? world.heroes[ev.by]?.channel : null;
  return ch?.kind === 'event' && ch.room === ev.room && ch.choice === 'force';
}

/** The Loom, Unravel: the Cloth this hero wears, if any. */
function clothWorn(h: Hero): ItemId | null {
  return h.armor && ITEMS[h.armor].cloth ? h.armor : null;
}

/** "−1s" / "+1s" */
function signed(seconds: number): string {
  return `${seconds < 0 ? '−' : '+'}${fmtSpeed(Math.abs(seconds))}`;
}

/** "cleansing the altar" etc., for the event panel and for onlookers' notifications. */
/**
 * How long this event takes this hero: its usual time, or CLOTH.hastenSecs with a Hastening Robe (already working
 * on it with Swiftwork, or about to start with the robe ready).
 */
export function eventTime(world: World, h: Hero, kind: EventKind, choice?: string): number {
  // Each choice has its own time (user, 2026-10-16): the one asked about, else the one being carried out.
  const doing = choice ?? (h.channel?.kind === 'event' ? h.channel.choice : undefined);
  const usual = channelTime(kind, speedOf(h, world.time), doing);
  if (kind === 'locks' && doing !== 'force') {
    const ch = h.channel;
    const room = ch?.kind === 'event' ? ch.room : h.pos.kind === 'room' ? h.pos.room : -1;
    const ev = world.events[room];
    return ev?.kind === 'locks' ? locksSecs(world, ev, h) : usual;
  }
  if (!Number.isFinite(usual)) return usual;
  const ch = h.channel;
  if (ch?.kind === 'event') return ch.hasten ? CLOTH.hastenSecs : usual;
  return clothReady(h, 'hasten') ? CLOTH.hastenSecs : usual;
}

export function choiceVerb(kind: EventKind, choice: string): string {
  if (choice === 'channel') return kind === 'altar' ? 'cleansing the altar' : 'picking the lock';
  if (choice.startsWith('forge')) return 'working at the anvil';
  const verbs: Record<string, string> = {
    take: 'taking the idol', help: 'bandaging the stranger', drink: 'drinking from the well',
    open: 'opening the chest', crawl: 'squeezing into the crawlspace',
    quaff: 'drinking the quicksilver', haul: 'shouldering the satchel', turn: 'turning the hourglass', wind: 'winding the shrine',
    gather: 'gathering the wanderers', read: 'reading the marks', pray: 'praying at the shrine', partake: 'drinking from the chalice',
    raise: 'waking the dead', ring: 'ringing the great bell', sit: 'sitting in silence', rework: 'reworking their bottles',
    wheel: 'turning a wheel', rouse: 'waking the Dead King', lie: 'lying down in the coffin', weave: 'working the loom', gaze: 'gazing into the pool',
    desecrate: 'desecrating the altar', smash: 'smashing the vault open', swap: 'swapping something for the idol', search: 'searching the stranger',
    wish: 'making a wish at the well', unbind: 'unbinding the chest', 'crawl-secret': 'squeezing into the crawlspace',
    bottle: 'bottling the quicksilver', pocket: 'pocketing a handful of coin', shatter: 'smashing the hourglass', overwind: 'overwinding the shrine',
    force: 'forcing a wheel alone', lining: 'searching the coffin', temper: 'tempering their weapon', unravel: 'unravelling into the loom',
    deep: 'gazing into the pool', pry: 'prying at the throne',
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
    if (choiceId === 'ask') return askTheWay(world, h, v);
    if (v.state === 'captive') chronicle(world, `${h.name} freed a captive villager.`);
    v.state = 'following';
    v.leader = h.id;
    h.leading.push(v.id);
    notify(world, h, h.leading.length > 1
      ? `Another villager clings to you: ${h.leading.length} in tow. Get them to the rendezvous! (Each one slows you.)`
      : 'The villager clings to you. Get them to the rendezvous! (You move slower.)');
    for (const o of othersHere(world, h)) notify(world, o, `${h.name} cuts the villager loose and leads them away.`);
    return null;
  }

  // Everything else takes time, and only the hero who started it carries it out.
  const ev = world.events[room];
  if (h.channel?.kind === 'event' && h.channel.room === room) return null;
  h.path = [];
  if (ev.kind === 'locks' && choiceId === 'wheel') return takeWheel(world, ev, h);
  // A half-cleansed altar is only half done for the Cleanse; desecrating it starts from nothing.
  if (ev.kind === 'altar' && choiceId !== 'channel') ev.progress = 0;
  ev.by = h.id;
  // Hastening Robe: Swiftwork makes short work of it.
  const swift = Number.isFinite(channelTime(ev.kind, speedOf(h, world.time))) ? clothReady(h, 'hasten') : null;
  if (swift) spendCloth(h, swift);
  h.channel = { kind: 'event', room, choice: choiceId, until: Infinity, ...(swift ? { hasten: true } : {}) };
  const verb = choiceVerb(ev.kind, choiceId);
  const secs = eventTime(world, h, ev.kind) * (1 - ev.progress);
  notify(world, h, Number.isFinite(secs)
    ? `You start ${verb}… (${Math.ceil(secs)}s; moving away starts it over)`
    : `You start ${verb}. It lasts as long as you stay.`);
  for (const o of othersHere(world, h)) notify(world, o, `${h.name} starts ${verb}.`);
  return null;
}

/** Twin Locks: hastened if either pair of hands (or `h`, about to take one) has a Hastening Robe ready (user, 2026-10-11). */
function locksSecs(world: World, ev: RoomEvent, h?: Hero): number {
  if (ev.hasten) return CLOTH.hastenSecs;
  const hands = [ev.by, ev.with].map((id) => (id ? world.heroes[id] : undefined));
  return [...hands, h].some((x) => x && clothReady(x, 'hasten')) ? CLOTH.hastenSecs : MORE_EVENTS.locksTime;
}

/** Twin Locks: the first hero takes a wheel and waits; the second takes the other, and the door starts to turn. */
function takeWheel(world: World, ev: RoomEvent, h: Hero): null {
  h.channel = { kind: 'event', room: ev.room, choice: 'wheel', until: Infinity };
  const first = ev.by ? world.heroes[ev.by] : undefined;
  if (!first) {
    ev.by = h.id;
    ev.progress = 0;
    notify(world, h, "You take hold of a wheel. It won't turn alone: someone has to take the other. (Walk away to let go.)");
    for (const o of othersHere(world, h)) notify(world, o, `${h.name} takes hold of a wheel, waiting for a second pair of hands.`);
    return null;
  }
  ev.with = h.id;
  ev.progress = 0;
  // Swiftwork from either pair of hands is enough: one Hastening Robe is spent (the first hero's, if both).
  if (!ev.hasten) {
    const robe = [first, h].map((x) => [x, clothReady(x, 'hasten')] as const).find(([, c]) => c);
    if (robe) {
      spendCloth(robe[0], robe[1]!);
      ev.hasten = true;
    }
  }
  const secs = locksSecs(world, ev);
  notify(world, h, `You take the other wheel. Together with ${first.name}, it begins to turn… (${secs}s; if either of you stops, it starts over)`);
  notify(world, first, `${h.name} takes the other wheel. It begins to turn… (${secs}s; if either of you stops, it starts over)`);
  for (const o of othersHere(world, h)) if (o !== first) notify(world, o, `${h.name} and ${first.name} turn the twin locks together.`);
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
        const hp = CLASS_EVENTS.zealotWellHp;
        h.hp = Math.min(h.maxHp, h.hp + hp);
        h.light = 0;
        notify(world, h, `The dark water pours in, and you drink it down gladly. Your lamp goes out. (+${hp} HP)`);
        return;
      }
      const roll = rng.int(0, 2);
      if (roll === 0) {
        const got = Math.round(gainLight(h, LIGHT_LOSS.wellLight));
        notify(world, h, `The water is cold and clean, and it glows in your lamp. (+${got} light)`);
      } else if (roll === 1) {
        h.hp = Math.min(h.maxHp, h.hp + 15);
        notify(world, h, 'Warmth spreads through you. (+15 HP)');
      } else {
        h.light = 0;
        notify(world, h, 'Whispers rise from the water, and your lamp goes out.');
      }
      return;
    }
    case 'open':
      addToPile(world, room, 20, [rollItem(world, 2)]);
      if (h.cls === 'undertaker') {
        notify(world, h, 'Something cold brushes your mind as the lid opens. You have known worse company.');
      } else {
        const lost = Math.round(loseLight(h, LIGHT_LOSS.chest));
        notify(world, h, `Something cold brushes your mind as the lid opens, and your lamp gutters. (−${lost} light)`);
      }
      return;
    case 'crawl':
    case 'crawl-secret': {
      // Either way, whatever the Escalation (user, 2026-10-16; was hidden rooms before Escalation 5, the exit after).
      const dest = choice === 'crawl-secret' ? crawlToSecret(world, h) ?? crawlToward(world, room) : crawlToward(world, room);
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
      hurtHero(world, h, afterBlock(h, 4), null);
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
      // A Valuable (user, 2026-10-11; was gold and a lasting Speed cost): heavy while carried, gold once out.
      if (hasSpace(h, 'satchel')) giveItem(h, 'satchel');
      else addToPile(world, room, 0, ['satchel']);
      notify(world, h, `You shoulder the satchel. Your legs ache already. (Speed ${signed(ITEMS.satchel.speed!)} while you carry it)`);
      chronicle(world, `${h.name} took the dead courier's satchel.`);
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
    case 'wheel': {
      const other = ev.with ? world.heroes[ev.with] : undefined;
      ev.with = null;
      if (other?.channel?.kind === 'event' && other.channel.room === room) other.channel = null;
      addToPile(world, room, rng.int(...MORE_EVENTS.locksGold), [rollItem(world, 3), 'relic']);
      for (const x of [h, ...othersHere(world, h)]) notify(world, x, 'The wheels lock home, and the iron door grinds open.');
      chronicle(world, `${h.name}${other ? ` and ${other.name}` : ''} opened the Twin Locks.`);
      return;
    }
    case 'lie': {
      const got = Math.round(gainLight(h, LIGHT_MAX));
      downHero(world, h, null, undefined, true);
      notify(world, h, `You lie down in the dark, and a lamp kindles beside you. (+${got} light) Now someone has to get you up.`);
      for (const o of othersHere(world, h)) notify(world, o, `${h.name} lies down in the coffin and goes still. They won't get up without help.`);
      chronicle(world, `${h.name} lay down in an Open Coffin.`);
      return;
    }
    case 'weave': {
      const mended = loomMends(world, h);
      weave(h);
      notify(world, h, mended.length
        ? `The grey thread runs through your things, and they are whole again: ${mended.join(', ')}.`
        : 'The loom clacks, but nothing of yours needed it.');
      chronicle(world, `${h.name} worked the Loom.`);
      return;
    }
    case 'rouse':
      rouseTheKing(world, h, room);
      return;
    // ---- Second choices (user, 2026-10-16) ----
    case 'desecrate': {
      const X = EVENT_CHOICES;
      addToPile(world, room, X.desecrateGold, []);
      for (const x of Object.values(world.heroes)) {
        if (!inDungeon(x)) continue;
        const lost = Math.round(loseLight(x, X.desecrateLight));
        notify(world, x, x === h
          ? `You smash the candles and pry the gold from the altar. Somewhere, something laughs. (−${lost} light)`
          : `Far off, something laughs: ${h.name} has desecrated an altar. (−${lost} light)`, 'desecrate');
      }
      chronicle(world, `${h.name} desecrated the altar in ${world.dungeon.rooms[room].name}.`);
      return;
    }
    case 'smash':
      // Loud: the monsters next door come to see, and one of the finds breaks.
      addToPile(world, room, rng.int(30, 50), [rollItem(world, 3), rollResource(world)]);
      lureToward(world, room, 1);
      notify(world, h, 'The vault bursts open with a crash that echoes down the tunnels. Something inside broke.');
      for (const o of othersHere(world, h)) notify(world, o, `${h.name} smashes the vault open. Everything nearby heard that.`);
      chronicle(world, `${h.name} smashed open a vault.`);
      return;
    case 'swap': {
      const item = swapItem(h);
      if (!item) {
        // Dropped or used it in the meantime.
        ev.done = false;
        ev.progress = 0;
        world.stats.eventsUsed--;
        notify(world, h, 'You have nothing left to put in its place.');
        return;
      }
      takeItem(h, h.items.lastIndexOf(item));
      addToPile(world, room, rng.int(60, 90), []);
      notify(world, h, `You ease your ${ITEMS[item].name} onto the plate as the idol comes off. The ceiling holds.`);
      chronicle(world, `${h.name} swapped a ${ITEMS[item].name} for the Glittering Idol.`);
      return;
    }
    case 'search': {
      const lost = Math.round(loseLight(h, EVENT_CHOICES.searchLight));
      addToPile(world, room, 0, [randomConsumable(world)]);
      notify(world, h, `They don't fight you for it. They don't do anything, any more. (−${lost} light)`);
      chronicle(world, `${h.name} robbed a wounded stranger.`);
      return;
    }
    case 'wish':
      h.gold = Math.max(0, h.gold - EVENT_CHOICES.wishGold);
      addToPile(world, room, 0, [rollItem(world, 3)]);
      notify(world, h, `The coin sinks without a sound. A moment later, something rises in its place. (−${EVENT_CHOICES.wishGold} gold)`);
      chronicle(world, `${h.name} made a wish at the Whispering Well.`);
      return;
    case 'unbind':
      addToPile(world, room, 20, [rollItem(world, 2)]);
      notify(world, h, 'Bone by bone, the chains come loose, and the chest opens without a whisper.');
      return;
    case 'bottle':
      if (hasSpace(h, 'flask')) giveItem(h, 'flask');
      else addToPile(world, room, 0, ['flask']);
      notify(world, h, 'You stopper a flask of quicksilver. It shivers in the glass, impatient.');
      chronicle(world, `${h.name} bottled the Quicksilver Pool.`);
      return;
    case 'pocket':
      addToPile(world, room, EVENT_CHOICES.pocketGold, []);
      notify(world, h, 'You take what you can carry easily and leave the rest to the courier.');
      chronicle(world, `${h.name} took a handful from the dead courier's satchel.`);
      return;
    case 'shatter':
      addSpeedMod(h, world.time, EVENT_CHOICES.shatterSpeed, null, 'Hourglass shard');
      notify(world, h, `The glass bursts, and the glowing sand settles on you alone. (Speed ${signed(EVENT_CHOICES.shatterSpeed)} for the rest of the run)`);
      chronicle(world, `${h.name} smashed the Cracked Hourglass.`);
      return;
    case 'overwind': {
      const X = EVENT_CHOICES;
      if (rng.chance(X.overwindChance)) {
        addSpeedMod(h, world.time, X.overwindSpeed, null, 'Clockwork Shrine');
        notify(world, h, `The spring screams, and holds. Your heart races to keep up. (Speed ${signed(X.overwindSpeed)})`);
        chronicle(world, `${h.name} overwound the Clockwork Shrine, and it held.`);
      } else {
        addSpeedMod(h, world.time, X.jamSpeed, X.jamSecs, 'Jammed clockwork');
        notify(world, h, `Something snaps inside, and the gears grind to a halt. So, for a while, do you. (Speed ${signed(X.jamSpeed)} for ${X.jamSecs}s)`);
        chronicle(world, `${h.name} overwound the Clockwork Shrine, and it jammed.`);
      }
      return;
    }
    case 'force':
      addToPile(world, room, rng.int(...MORE_EVENTS.locksGold), []);
      notify(world, h, 'You lean on one wheel until something gives. The door shifts just far enough to reach the gold.');
      chronicle(world, `${h.name} forced the Twin Locks alone.`);
      return;
    case 'lining': {
      const lost = Math.round(loseLight(h, EVENT_CHOICES.liningLight));
      const jewels = LOOT_TABLE.filter((e) => ITEMS[e.item].kind === 'amulet' || ITEMS[e.item].kind === 'ring');
      addToPile(world, room, 0, [rng.pick(jewels).item]);
      notify(world, h, `Your fingers find something cold sewn into the lining. Whoever lay here wore it. (−${lost} light)`);
      return;
    }
    case 'temper':
      h.tempered = true;
      notify(world, h, `Quench and hone: your ${h.weapon ? ITEMS[h.weapon].name : 'weapon'} bites deeper for the rest of this run. (+${Math.round(EVENT_CHOICES.temperPct * 100)}% damage)`);
      return;
    case 'unravel':
      unravel(world, ev, h);
      return;
    case 'deep':
      lookForTheWay(world, h, room);
      return;
    case 'pry': {
      addToPile(world, room, 0, ['relic']);
      spawnGroup(world, room, ['giant'], world.escalation);
      notify(world, h, 'The jewel comes free, and something in the dark gets up to take it back.');
      for (const o of othersHere(world, h)) notify(world, o, `${h.name} pries a jewel from the throne, and something wakes.`);
      chronicle(world, `${h.name} pried a jewel from the black iron throne.`);
      for (const x of [h, ...othersHere(world, h)]) if (isConscious(x)) onHeroInRoom(world, x, room);
      return;
    }
    case 'gaze':
      h.scryUntil = world.time + MORE_EVENTS.scrySecs;
      notify(world, h, `The water clouds, then clears, and there they are, wherever they are. (${MORE_EVENTS.scrySecs}s)`);
      chronicle(world, `${h.name} looked into the Scrying Pool.`);
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
        const lost = Math.round(loseLight(x, ELITE_EVENTS.sacramentLight));
        notify(world, x, x === h
          ? `It tastes of every sin in this place. Every lamp gutters, and you are quicker than anything down here. (−${lost} light, Speed 2s)`
          : `A cold shudder runs through you and your lamp gutters: somewhere, ${h.name} has drunk something terrible. (−${lost} light)`);
      }
      chronicle(world, `${h.name} partook of the Sinful Sacrament.`);
      return;
    }
    case 'raise': {
      const scale = 1 + ESCALATION.escalationScaling * world.escalation;
      const kinds: EnemyId[] = ['ghoul', 'crawler', 'acolyte', 'giant'];
      for (let i = 0; i < ELITE_EVENTS.uprisingRisen; i++) {
        const type = rng.pick(kinds);
        const hp = Math.round(ENEMIES[type].maxHp * scale);
        h.legion.push({ type, hp, maxHp: hp, dmgMult: scale, turns: 1, permanent: true, uprising: true });
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
      notify(world, h, `You let it all in, and the dark becomes yours. (Fervour ×${ELITE_EVENTS.zenithFervour} for the rest of the run)`);
      chronicle(world, `${h.name} reached the Zen Zenith.`);
      return;
    case 'rework':
      h.elite.alacrity = true;
      notify(world, h, `Thinner glass, tighter stoppers. Every consumable you carry quickens you. (Speed ${signed(ELITE_EVENTS.alacrityPerItem)} each)`);
      chronicle(world, `${h.name} reworked their bottles.`);
      return;
  }
  if (choice.startsWith('forge-')) forge(world, ev, h, choice.slice('forge-'.length) as GearSlot);
}

/**
 * Crowned in Dread: the Dead King and his court rise in one of the rooms farthest from the exit (nobody in it, no
 * fight, if possible) and march straight for the exit, where they hold. Everyone hears who woke him and from where.
 * `rite`: a Relic Rite woke him as the run began (user, 2026-10-11), not `h` at the event.
 */
export function rouseTheKing(world: World, h: Hero, from: number, rite = false) {
  const d = world.dungeon;
  const hops = hopsFrom(world, d.exit, true);
  const someoneIn = (r: number) => Object.values(world.heroes).some((o) => inDungeon(o) && o.pos.kind === 'room' && o.pos.room === r);
  const open = [...hops.keys()].filter((r) => d.rooms[r].kind === 'normal' && r !== from);
  const quietRooms = open.filter((r) => !someoneIn(r) && !world.encounters[r] && monstersIn(world, r).length === 0);
  const pool = quietRooms.length ? quietRooms : open.length ? open : [from];
  const far = Math.max(...pool.map((r) => hops.get(r) ?? 0));
  const room = world.rng.pick(pool.filter((r) => (hops.get(r) ?? 0) === far));
  const court = spawnGroup(world, room, CROWNED.procession, world.escalation);
  for (const m of court) m.procession = true;
  const pack = makePack(world, court, room, d.exit);
  pack.restUntil = world.time + 2;
  const where = theRoom(d.rooms[room].name);
  for (const o of Object.values(world.heroes)) {
    if (!inDungeon(o)) continue;
    if (!o.seen.includes(room)) o.seen.push(room);
    notify(world, o, rite
      ? `The Relic Rite has woken the Dead King! His procession sets out from ${where} for the exit, carrying his treasure.`
      : o === h
      ? `Far away, something answers. The Dead King's procession sets out from ${where} for the exit. Stop it, and his treasure is yours.`
      : `${h.name} has woken the Dead King! His procession sets out from ${where} for the exit, carrying his treasure.`, 'king');
  }
  chronicle(world, rite ? `${h.name}'s Relic Rite woke the Dead King. His procession set out from ${where}.` : `${h.name} woke the Dead King. His procession set out from ${where}.`);
  if (someoneIn(room)) for (const o of Object.values(world.heroes)) if (inDungeon(o) && o.pos.kind === 'room' && o.pos.room === room) onHeroInRoom(world, o, room);
}

/** Smith's Anvil: the worn piece in that slot comes off the anvil one step better. */
function forge(world: World, ev: RoomEvent, h: Hero, slot: GearSlot) {
  const item = h[slot];
  if (!forgeable(item)) {
    // Took it off (or swapped it for a Rare) while the coals heated: the anvil waits for the next smith.
    ev.done = false;
    ev.progress = 0;
    world.stats.eventsUsed--;
    notify(world, h, 'You have nothing on the anvil to reforge.');
    return;
  }
  const into = reforged(world.rng, item);
  // The old piece is melted down, charge and all; the new one comes out fresh.
  const keep = h.packCharges.length;
  equip(h, slot, null);
  h.packCharges.splice(keep);
  if (ITEMS[into].auto) h.packCharges.unshift({ item: into, charge: freshCharge(into) });
  equip(h, slot, into);
  notify(world, h, `Hammer, quench, hammer. Your ${ITEMS[item].name} comes off the anvil as ${ITEMS[into].name}.`);
  chronicle(world, `${h.name} reforged a ${ITEMS[item].name} into ${ITEMS[into].name} at a Smith's Anvil.`);
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
  }
}

/** The Loom's weave for one hero: Cloth charges, Call for Help, the Toll and burned cards, all fresh. */
function weave(h: Hero) {
  for (const slot of GEAR_SLOTS) {
    const c = wornCharge(h, slot);
    if (c) Object.assign(c, freshCharge(h[slot]!), { disabled: c.disabled });
  }
  for (const p of h.packCharges) p.charge = freshCharge(p.item);
  h.calledAt = null;
  h.tolled = false;
  unburn(h);
}

/** The Loom, Unravel: the worn Cloth is gone, it hurts, and the Loom weaves for every hero in the dungeon. */
function unravel(world: World, ev: RoomEvent, h: Hero) {
  const cloth = clothWorn(h);
  if (!cloth) {
    // Took it off while the loom was threaded.
    ev.done = false;
    ev.progress = 0;
    world.stats.eventsUsed--;
    notify(world, h, 'You have no Cloth left to unravel.');
    return;
  }
  const keep = h.packCharges.length;
  equip(h, 'armor', null);
  h.packCharges.splice(keep);
  const dmg = EVENT_CHOICES.unravelDamage;
  h.hp = Math.max(1, h.hp - dmg);
  for (const x of Object.values(world.heroes)) {
    if (!inDungeon(x)) continue;
    weave(x);
    notify(world, x, x === h
      ? `The loom pulls your ${ITEMS[cloth].name} apart, thread by thread, and some of you with it. Its grey thread runs out to every one of you. (−${dmg} HP)`
      : `A grey thread brushes past you in the dark, and your things are whole again: ${h.name} has unravelled something into the Loom.`, 'weave');
  }
  chronicle(world, `${h.name} unravelled a ${ITEMS[cloth].name} into the Loom, for everyone.`);
}

/** Scrying Pool, Look for the Way: every monster in the dungeon as it is now, and the way to the rendezvous. */
function lookForTheWay(world: World, h: Hero, from: number) {
  const rooms = new Set(Object.values(world.monsters).map((m) => m.room).filter((r) => r >= 0));
  for (const r of rooms) scryRoom(world, h, r);
  for (const r of routeToExit(world, from)) if (!h.seen.includes(r)) h.seen.push(r);
  notify(world, h, 'The water shows you the dark from above: every monster down here, and the way out.');
  chronicle(world, `${h.name} looked into the Scrying Pool for the way.`);
}

/** Captive, Ask the Way: the route to the rendezvous and the nearest Locked Vault go on your map; they run off. */
function askTheWay(world: World, h: Hero, v: Villager): null {
  const room = v.room;
  v.state = 'fled';
  for (const r of routeToExit(world, room)) if (!h.seen.includes(r)) h.seen.push(r);
  const hops = hopsFrom(world, room, true);
  const vault = Object.values(world.events)
    .filter((e) => e.kind === 'vault' && !e.done && hops.has(e.room))
    .sort((a, b) => hops.get(a.room)! - hops.get(b.room)!)[0];
  if (vault) {
    if (!h.seen.includes(vault.room)) h.seen.push(vault.room);
    h.knownEvents[vault.room] = 'vault';
  }
  notify(world, h, `"That way, then left, then down." They point out the way to the rendezvous${vault ? `, and a vault in ${theRoom(world.dungeon.rooms[vault.room].name)}` : ''}, and they're gone.`);
  for (const o of othersHere(world, h)) notify(world, o, `${h.name} cuts the villager loose. They whisper something and run off alone.`);
  chronicle(world, `${h.name} let a captive go, for directions.`);
  return null;
}

/** The rooms along the shortest open route from `from` to the exit (the exit included, `from` not). */
function routeToExit(world: World, from: number): number[] {
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
  if (!prev.has(d.exit)) return [];
  const path: number[] = [];
  for (let cur = d.exit; cur !== from; cur = prev.get(cur)!) path.unshift(cur);
  return path;
}

/** A random consumable, as the loot table weighs them. */
function randomConsumable(world: World): ItemId {
  const pool = LOOT_TABLE.filter((e) => ITEMS[e.item].kind === 'consumable');
  let roll = world.rng.float(0, pool.reduce((s, e) => s + e.weight, 0));
  for (const e of pool) if ((roll -= e.weight) <= 0) return e.item;
  return pool[0].item;
}

/** A random secret room this hero hasn't been in, broken open early if it's still sealed (user, 2026-10-10). */
function crawlToSecret(world: World, h: Hero): number | null {
  const hidden = world.dungeon.secrets.filter((s) => !h.explored.includes(s.room));
  if (!hidden.length) return null;
  const s = world.rng.pick(hidden);
  openSecretEarly(world, s);
  return s.room;
}

/** Three hops along the real shortest open route toward the exit (stopping short of it). */
function crawlToward(world: World, from: number): number | null {
  const path = routeToExit(world, from);
  const hops = Math.min(3, path.length - 1);
  return hops >= 1 ? path[hops - 1] : null;
}

// ---------------------------------------------------------------------------
// Ticking: channels and villagers

export function tickEvents(world: World, dt: number) {
  resumeCleanses(world);
  // A claim lasts only as long as its hero keeps at it (walking off, a fight or going down all end it).
  const at = (id: string | null | undefined, room: number) => {
    const ch = id ? world.heroes[id]?.channel : null;
    return ch?.kind === 'event' && ch.room === room;
  };
  for (const ev of Object.values(world.events)) {
    // Twin Locks: the second pair of hands let go, so it starts over (the first keeps hold of their wheel).
    if (ev.with && !at(ev.with, ev.room)) letGo(ev);
    if (ev.by && !at(ev.by, ev.room)) abandon(ev);
  }
  for (const h of Object.values(world.heroes)) {
    const ch = h.channel;
    if (ch?.kind !== 'event') continue;
    const ev = world.events[ch.room];
    if (
      !ev || ev.done || (ev.by !== h.id && ev.with !== h.id) || !isConscious(h) || h.encounter !== null || h.pos.kind !== 'room' ||
      h.pos.room !== ch.room || !quiet(world, ch.room)
    ) {
      h.channel = null;
      if (ev?.by === h.id) abandon(ev);
      else if (ev?.with === h.id) letGo(ev);
      continue;
    }
    const kind = ev.kind;
    // Twin Locks only turn while both wheels are held (counted once, on the first hero's turn).
    if (kind === 'locks' && ch.choice === 'wheel' && (ev.by !== h.id || !ev.with)) continue;
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
    ev.progress = Math.min(1, ev.progress + dt / eventTime(world, h, kind));
    // Booming Barrage: a Toll every so often while the bell swings.
    if (kind === 'barrage') {
      const due = Math.floor((ev.progress * ELITE_EVENTS.barrageTime) / ELITE_EVENTS.barrageEvery + 1e-9);
      for (; (ev.rung ?? 0) < due; ev.rung = (ev.rung ?? 0) + 1) toll(world, h);
    }
    // The Sorceress's rites keep the guardians asleep.
    if (kind === 'altar' && ch.choice === 'channel' && ev.progress >= 0.5 && !ev.spawned && h.cls !== 'sorceress') {
      ev.spawned = true;
      ev.resumeFor = h.id;
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

/**
 * Altar guardians beaten: the hero who woke them goes straight back to cleansing (user, 2026-10-11). Leaving the
 * room or going down forfeits that; they can still start it again by hand.
 */
function resumeCleanses(world: World) {
  for (const ev of Object.values(world.events)) {
    if (!ev.resumeFor) continue;
    const h = world.heroes[ev.resumeFor];
    if (ev.done || (ev.by && ev.by !== h?.id) || !h || !inDungeon(h) || h.pos.kind !== 'room' || h.pos.room !== ev.room) {
      delete ev.resumeFor;
      continue;
    }
    if (h.encounter !== null || !quiet(world, ev.room)) continue;
    delete ev.resumeFor;
    if (isConscious(h) && !h.channel && !h.path.length) chooseEvent(world, h, 'channel');
  }
}

/** Stopped before it was done: the work is lost (an altar whose guardians came stays half-cleansed). */
function abandon(ev: RoomEvent) {
  // Twin Locks: whoever is on the other wheel keeps hold of it, and waits for someone new.
  if (ev.with) {
    ev.by = ev.with;
    letGo(ev);
    return;
  }
  ev.by = null;
  ev.progress = ev.spawned ? 0.5 : 0;
  ev.rung = 0;
}

/** Twin Locks: the second hero let go, and the door starts over. */
function letGo(ev: RoomEvent) {
  ev.with = null;
  ev.progress = 0;
}

function completeChannel(world: World, ev: RoomEvent, h: Hero) {
  if (ev.kind === 'altar') {
    world.objectives.altars++;
    chronicle(world, `${h.name} cleansed the altar in ${world.dungeon.rooms[ev.room].name}.`);
    for (const x of Object.values(world.heroes)) {
      if (!inDungeon(x)) continue;
      const got = Math.round(gainLight(x, LIGHT_LOSS.altarLight));
      notify(world, x, `An altar has been cleansed. Your lamp burns brighter. (+${got} light; +${EVENT_SEEDING.altarBonus} gold each when you escape)`);
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
      leader.leading = leader.leading.filter((id) => id !== v.id);
      world.objectives.villagers++;
      notify(world, leader, `The villager squeezes out through a crack in the wall. Saved! (+${EVENT_SEEDING.villagerBonus} gold each for those who escape)`);
      chronicle(world, `${leader.name} brought a villager to safety.`);
    } else if (!isConscious(leader)) {
      v.state = 'waiting';
      v.room = leader.pos.kind === 'room' ? leader.pos.room : leader.pos.from;
      v.leader = null;
      leader.leading = leader.leading.filter((id) => id !== v.id);
      chronicle(world, `A villager was left alone in ${world.dungeon.rooms[v.room].name}.`);
    } else if (leader.pos.kind === 'room') {
      v.room = leader.pos.room;
    }
  }
}

/** Monsters sometimes strike the villager you're escorting. Returns the event text, or null. */
export function maybeHitVillager(world: World, room: number, dmg: number, attacker: string): string | null {
  const here = Object.values(world.villagers).filter((x) => x.state === 'following' && x.room === room);
  if (!here.length || !world.rng.chance(0.15)) return null;
  const v = here.length > 1 ? here[world.rng.int(0, here.length - 1)] : here[0];
  v.hp -= dmg;
  if (v.hp > 0) return `${attacker} strikes the villager! (${v.hp}/${v.maxHp})`;
  v.state = 'dead';
  const leader = v.leader ? world.heroes[v.leader] : undefined;
  if (leader) leader.leading = leader.leading.filter((id) => id !== v.id);
  v.leader = null;
  chronicle(world, `A villager was killed in ${world.dungeon.rooms[room].name}.`);
  return `${attacker} kills the villager!`;
}


export function eventName(kind: EventKind): string {
  return EVENTS[kind].name;
}
