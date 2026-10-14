import type { ClassId } from './classes';
import type { EnemyId } from './enemies';
import type { ItemId } from './items';

/**
 * Light and the mind (user, 2026-10-14; Stress, Insanity and heart attacks are gone). **Forgetting**: whenever a known
 * path drops out of a hero's sight, they forget it with a chance of (75 − light)% (none while Bright, above 75); a room
 * whose every path is forgotten is forgotten too (`forgetChance`, sim/mind.ts). What used to add stress takes light
 * instead ("your lamp gutters"), at the old stress numbers; what eased it gives light.
 */
export const FORGETTING_RULES = 'Below 75 light, every path that drops out of your sight may be forgotten: 1% for each point of light below 75 (75% in the Dark). A room whose every path is forgotten is forgotten too.';

/** Light lost or gained to the dungeon (the old stress numbers; user, 2026-10-14). */
export const LIGHT_LOSS = {
  /** Witnessing an ally go down / die in your room. */
  allyDown: 10,
  allyDeath: 17,
  /** Fleeing a fight. */
  flee: 3,
  /** Acolyte's Whisper. */
  whisper: 4,
  /** Whispering Well: the clear water's light. */
  wellLight: 27,
  /** Cursed Chest. */
  chest: 13,
  /** Every hero still inside when an altar is cleansed (a gain). */
  altarLight: 13,
};

export type EventKind =
  | 'altar' | 'villager' | 'idol' | 'stranger' | 'well' | 'vault' | 'chest' | 'crawlspace'
  | 'quicksilver' | 'satchel' | 'hourglass' | 'clockwork'
  | 'locks' | 'coffin' | 'anvil' | 'loom' | 'scrying' | 'crowned'
  | EliteEventKind
  /** How an Elite Event looks to every class but its own. */
  | 'veiled';

/** Class-specific Elite Events (user, 2026-10-10): one per class, only that class can carry it out. */
export type EliteEventKind = 'wanderers' | 'cant' | 'liturgy' | 'sacrament' | 'uprising' | 'barrage' | 'zenith' | 'alacrity';

export interface EventDef {
  kind: EventKind;
  name: string;
  glyph: string;
  text: string;
  /** Relative chance when seeding rooms (0: never seeded the usual way). */
  weight: number;
  /** Elite Events: the only class that can do it (everyone else sees it veiled). */
  elite?: ClassId;
}

export const EVENTS: Record<EventKind, EventDef> = {
  altar: {
    kind: 'altar', name: 'Defiled Altar', glyph: '⛧', weight: 3,
    text: 'Black candles gutter around a stained altar. Cleansing it will take time — and something will notice.',
  },
  villager: {
    kind: 'villager', name: 'Captive', glyph: '☺', weight: 3,
    text: 'A villager, bound and gagged, stares at you with wide eyes.',
  },
  idol: {
    kind: 'idol', name: 'Glittering Idol', glyph: '✧', weight: 2,
    text: 'A golden idol rests on a pressure plate. The ceiling above looks… loose.',
  },
  stranger: {
    kind: 'stranger', name: 'Wounded Stranger', glyph: '¿', weight: 2,
    text: 'A stranger slumps against the wall, clutching a wound. "Please… a bandage…"',
  },
  well: {
    kind: 'well', name: 'Whispering Well', glyph: '◯', weight: 2,
    text: 'Dark water murmurs your name. It smells faintly of iron.',
  },
  vault: {
    kind: 'vault', name: 'Locked Vault', glyph: '▣', weight: 2,
    text: 'A heavy strongbox with an old, complicated lock.',
  },
  chest: {
    kind: 'chest', name: 'Cursed Chest', glyph: '☐', weight: 2,
    text: 'A chest wrapped in chains of bone. Something inside is worth having. Something inside is wrong.',
  },
  crawlspace: {
    kind: 'crawlspace', name: 'Crawlspace', glyph: '↘', weight: 2,
    text: 'A narrow crack in the wall. Cold air flows through it from somewhere beyond.',
  },
  // ---- Events that play with Speed ----
  quicksilver: {
    kind: 'quicksilver', name: 'Quicksilver Pool', glyph: '☿', weight: 1,
    text: 'A shallow basin of liquid metal, perfectly still. Your reflection in it moves a moment before you do.',
  },
  satchel: {
    kind: 'satchel', name: "Courier's Satchel", glyph: '⚖', weight: 1,
    text: 'A dead courier still clutches a satchel bulging with coin. It is very, very heavy.',
  },
  hourglass: {
    kind: 'hourglass', name: 'Cracked Hourglass', glyph: '⧗', weight: 1,
    text: 'A tall hourglass stands on a plinth, its sand glowing faintly. It has never been turned.',
  },
  clockwork: {
    kind: 'clockwork', name: 'Clockwork Shrine', glyph: '⚙', weight: 1,
    text: 'A shrine of brass gears, wound down and silent. A crank juts from its side. Winding it would take a while.',
  },
  // ---- Twin Locks, Open Coffin, Smith's Anvil, Loom, Scrying Pool (user, 2026-10-11) ----
  locks: {
    kind: 'locks', name: 'Twin Locks', glyph: '⚿', weight: 1,
    text: 'An iron door with a wheel at either end, too far apart for one pair of hands. Both must turn at once.',
  },
  coffin: {
    kind: 'coffin', name: 'Open Coffin', glyph: '⚰', weight: 1,
    text: 'A plain coffin, lid off, lined with something soft. It looks restful. It looks like it would be hard to get out of alone.',
  },
  anvil: {
    kind: 'anvil', name: "Smith's Anvil", glyph: '⚒', weight: 1,
    text: 'A forge gone cold beside a scarred anvil, its tools still hung in order. There is heat left in the coals, if you are patient.',
  },
  loom: {
    kind: 'loom', name: 'The Loom', glyph: '⌗', weight: 1,
    text: 'A loom strung with grey thread that never seems to run out. Whatever is worn thin, it could weave whole again.',
  },
  scrying: {
    kind: 'scrying', name: 'Scrying Pool', glyph: '◎', weight: 1,
    text: 'A still pool that shows no reflection. Look long enough, and it shows you the others instead.',
  },
  crowned: {
    kind: 'crowned', name: 'Crowned in Dread', glyph: '♔', weight: 0.5,
    text: 'An empty throne of black iron, and above it, carved deep: HE WHO WAKES THE KING MAY TAKE WHAT HE CARRIES. '
      + 'Far off, something old is waiting to be woken, with riches beyond your wildest imagining.',
  },
  // ---- Elite Events: seeded per hero (see ELITE_EVENTS), not by weight ----
  veiled: {
    kind: 'veiled', name: 'Something Strange', glyph: '✦', weight: 0,
    text: 'Maybe someone else knows what to do with this…',
  },
  wanderers: {
    kind: 'wanderers', name: 'Wayward Wanderers', glyph: '✦', weight: 0, elite: 'warden',
    text: 'Two lost villagers huddle in the corner, too frightened to move. They would follow a shield, if it never left them. '
      + '(12s: they walk with you, Speed −1.5s each, for the rest of the run, and count as two villagers saved when you escape.)',
  },
  cant: {
    kind: 'cant', name: 'Cunning Cant', glyph: '✦', weight: 0, elite: 'cutthroat',
    text: 'Thieves’ marks cover the wall: a whole map of this place, in a cant only your kind can read. '
      + '(12s: reveals every room and tunnel, and opens every secret room to you alone until the others find them.)',
  },
  liturgy: {
    kind: 'liturgy', name: 'Luminous Liturgy', glyph: '✦', weight: 0, elite: 'lampbearer',
    text: 'A shrine to the old light, its wick still trimmed. Wherever your allies are, they would feel it burn. '
      + '(Pray as long as you like: every second, every ally in the dungeon, you included, gets +1 HP and +1 light.)',
  },
  sacrament: {
    kind: 'sacrament', name: 'Sinful Sacrament', glyph: '✦', weight: 0, elite: 'sorceress',
    text: 'A chalice of something dark and warm. Drink, and the whole dungeon will feel what it costs. '
      + '(12s: −17 light to every hero, you included; your Speed is the fastest there is (2s) for the rest of the run.)',
  },
  uprising: {
    kind: 'uprising', name: 'Unholy Uprising', glyph: '✦', weight: 0, elite: 'undertaker',
    text: 'A mass grave, shallow and restless. The dead here would answer a gravedigger. '
      + '(12s: three Risen follow you for good, into every fight, until they fall. Allies fighting beside them lose 5 light when each fight ends.)',
  },
  barrage: {
    kind: 'barrage', name: 'Booming Barrage', glyph: '✦', weight: 0, elite: 'bellwright',
    text: 'A great cracked bell hangs from the ceiling, its rope within reach. '
      + '(36s: you ring it, and it Tolls every 12s while you do.)',
  },
  zenith: {
    kind: 'zenith', name: 'Zen Zenith', glyph: '✦', weight: 0, elite: 'zealot',
    text: 'A bare stone seat facing a blank wall. Sit, and let it all in. '
      + '(12s: for the rest of the run your Fervour is doubled: +2% damage for every point of light below 100.)',
  },
  alacrity: {
    kind: 'alacrity', name: 'Artistic Alacrity', glyph: '✦', weight: 0, elite: 'alchemist',
    text: 'A forgotten laboratory, its glassware arranged just so. Your bottles could ride far lighter. '
      + '(12s: for the rest of the run, every consumable you carry gives Speed −0.5s.)',
  },
};

/** Elite Event of each class. */
export const CLASS_ELITE: Record<ClassId, EliteEventKind> = {
  warden: 'wanderers', cutthroat: 'cant', lampbearer: 'liturgy', sorceress: 'sacrament',
  undertaker: 'uprising', bellwright: 'barrage', zealot: 'zenith', alchemist: 'alacrity',
};

export function isElite(kind: EventKind): kind is EliteEventKind {
  return !!EVENTS[kind].elite;
}

/** Numbers for the Elite Events. */
export const ELITE_EVENTS = {
  /** Each hero in the run adds this chance that their class's Elite Event is in the dungeon (two of a class: twice). */
  chancePerHero: 0.2,
  /** Seconds to carry one out (Liturgy: as long as you like; Barrage: below). */
  channel: 12,
  /** Wayward Wanderers: villagers that walk with the Warden (each one hurries them as an escort does). */
  wanderers: 2,
  /** Luminous Liturgy, per second of prayer, for every ally in the dungeon. */
  liturgyHp: 1,
  liturgyLight: 1,
  /** Sinful Sacrament: light every hero in the dungeon loses (was stress). */
  sacramentLight: 17,
  /** Unholy Uprising: how many Risen, and the light each ally in a fight with them loses when it ends (was stress). */
  uprisingRisen: 3,
  uprisingLight: 5,
  /** Booming Barrage: ringing takes this long, Tolling every `barrageEvery` seconds of it. */
  barrageTime: 36,
  barrageEvery: 12,
  /** Zen Zenith: the Zealot's Fervour is multiplied by this for the rest of the run (was: stress past 100). */
  zenithFervour: 2,
  /** Artistic Alacrity: Speed per carried consumable. */
  alacrityPerItem: -0.5,
};

/** What the Speed events do. Speed is in seconds (lower is faster). */
export const SPEED_EVENTS = {
  /** Quicksilver: faster for the rest of the run, but frailer. (−1.5 from 2026-10-10 to 2026-10-11: too strong.) */
  quicksilverSpeed: -1,
  quicksilverMaxHp: -6,
  /** Hourglass: everyone in the room is faster for a while. */
  hourglassSpeed: -1.5,
  hourglassDuration: 90,
  /** Clockwork Shrine: a long wind for a small, lasting edge. Winding takes this ÷ your Speed seconds: the quick fumble it. */
  clockworkSpeed: -0.5,
  clockworkWork: 20,
};

/** Twin Locks, Open Coffin, Smith's Anvil, the Loom and the Scrying Pool (user, 2026-10-11). */
export const MORE_EVENTS = {
  /** Twin Locks: both wheels must turn together this long; if either hero stops, it starts over. */
  locksTime: 12,
  /** Twin Locks: gold behind the door (a quality-3 find and a Relic too). Doubled 2026-10-11 (user; was 20–40). */
  locksGold: [40, 80] as const,
  /** Open Coffin: lying down. */
  coffinTime: 3,
  /** Smith's Anvil: reforging. */
  anvilTime: 18,
  /** Scrying Pool: gazing, then how long you see every ally and the room they're in. */
  scryTime: 3,
  scrySecs: 10,
};

/**
 * Crowned in Dread (user, 2026-10-11): waking the Dead King sends his procession out from one of the rooms farthest
 * from the exit, straight for it, where it holds until killed. They carry his treasure (`lairs` Lairs' worth and a
 * Legendary); the last of them to fall drops it. Two Liches march with him (user, 2026-10-12; was one), so Night of
 * the Liches can be done below CR 5 by waking him.
 */
export const CROWNED = {
  procession: ['king', 'lich', 'lich', 'queen', 'giant', 'giant', 'giant', 'giant'] as EnemyId[],
  /** His treasure: this many Lairs' worth, plus one random Legendary (user, 2026-10-11; was 3 Lairs). */
  lairs: 2,
  legendaries: 1,
};

/**
 * Smith's Anvil: the next piece up of the same kind (user, 2026-10-11). Daggers, Hammers, Leather and Mail climb
 * their lists; anything else (Staves, Cloth, amulets, rings) becomes a random piece one rarity up, of the same kind.
 * Rares can't be reforged.
 */
export const ANVIL_UPGRADES: Partial<Record<ItemId, ItemId>> = {
  dirk: 'knife', knife: 'stiletto', stiletto: 'kris', kris: 'misericorde',
  cudgel: 'sledge', sledge: 'warhammer', warhammer: 'ironmaul', ironmaul: 'bonebreaker',
  jerkin: 'studded', studded: 'drakehide',
  ringmail: 'scaleshirt', scaleshirt: 'hauberk', hauberk: 'brigandine', brigandine: 'wardmail',
};

/**
 * Class twists on events (user, 2026-10-10). Deliberately absent from the class picker: a hero learns theirs at the
 * event itself, where the button wears the class icon and says what's different. (The Undertaker's quick digging and
 * the Sorceress's Anima are class perks, not event twists.)
 * - Sorceress: cleanses the Altar without waking its guardians.
 * - Lampbearer: helps the Wounded Stranger without a bandage, and is always rewarded; keeps their light in the Crawlspace.
 * - Cutthroat: takes the Glittering Idol without the cave-in.
 * - Bellwright: the Cracked Hourglass's haste lasts the rest of the run, for everyone it touches.
 * - Alchemist: Quicksilver gives max HP instead of costing it.
 * - Undertaker: no light lost to the Cursed Chest.
 * - Zealot: the Whispering Well always heals and puts their light out, and they welcome it.
 * - Warden: escorting a villager speeds them up instead of slowing them down.
 */
export const CLASS_EVENTS = {
  alchemistQuicksilverMaxHp: 12,
  zealotWellHp: 15,
  wardenEscortSpeed: -1.5,
};

/** Seconds an event choice takes to carry out. `speed` is the hero's current Speed. */
export function channelTime(kind: EventKind, speed: number): number {
  switch (kind) {
    case 'liturgy': return Infinity;
    case 'barrage': return ELITE_EVENTS.barrageTime;
    case 'wanderers':
    case 'cant':
    case 'sacrament':
    case 'uprising':
    case 'zenith':
    case 'alacrity': return ELITE_EVENTS.channel;
    case 'locks': return MORE_EVENTS.locksTime;
    case 'coffin': return MORE_EVENTS.coffinTime;
    case 'anvil': return MORE_EVENTS.anvilTime;
    case 'scrying': return MORE_EVENTS.scryTime;
    case 'altar': return 18;
    case 'vault': return 24;
    case 'quicksilver':
    case 'satchel':
    case 'hourglass': return 3;
    case 'clockwork': return SPEED_EVENTS.clockworkWork / speed;
    default: return 6;
  }
}

export const EVENT_SEEDING = {
  /** Chance a normal room (not entrance/exit/next to the entrance) gets an event. */
  chance: 0.34,
  /** Bonus gold to every hero who escapes, per objective. */
  altarBonus: 15,
  villagerBonus: 25,
  villagerHp: 10,
  /** Wounded Stranger: chance it's a trap (an ambush if helped by anyone but a Lampbearer, or walked away from). */
  strangerTrap: 0.4,
  /** Altar guardians are this many Escalations stronger than the dungeon around them. */
  guardianEscalations: 1,
  /** Each villager you lead adds this to your Speed (seconds) until they're saved; several stack. */
  villagerSlow: 1.5,
};
