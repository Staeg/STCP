import type { ClassId } from './classes';

export type AfflictionId = 'selfish' | 'fearful' | 'paranoid' | 'hopeless';

export interface AfflictionDef {
  id: AfflictionId;
  name: string;
  desc: string;
}

export const AFFLICTIONS: Record<AfflictionId, AfflictionDef> = {
  selfish: { id: 'selfish', name: 'Selfish', desc: 'Always votes to take loot for themself. After 10s, votes go ahead without them.' },
  fearful: { id: 'fearful', name: 'Fearful', desc: 'Each combat turn, 25% chance to try to flee (50% to escape, +5 stress) instead of the chosen action.' },
  paranoid: {
    id: 'paranoid', name: 'Paranoid',
    desc: "Refuses allies' Mend, Vigil, Guard, Blood Pact healing and items (Smelling Salts still work).",
  },
  hopeless: { id: 'hopeless', name: 'Hopeless', desc: 'Every hit they deal does 30% less damage (×0.7, before Shield).' },
};

/** Shown alongside an affliction's description. */
export const AFFLICTION_RULES = 'Afflictions last the rest of the run. Reaching 100 stress again stops your heart: you go down and stress resets to 80.';

export const STRESS = {
  /** Per second, always, just for being down here: about 100 in 10 minutes if nothing relieves it. */
  basePerSec: 0.16,
  /** Per second on top of that while Dim / in total darkness. */
  dimPerSec: 0.15,
  darkPerSec: 0.5,
  /** After the first break, stress resets here. */
  afterBreak: 60,
  /** Selfish voters are dropped from a vote after this long. */
  selfishGrace: 10,
};

export type EventKind =
  | 'altar' | 'villager' | 'idol' | 'stranger' | 'well' | 'vault' | 'chest' | 'crawlspace'
  | 'quicksilver' | 'satchel' | 'hourglass' | 'clockwork';

export interface EventDef {
  kind: EventKind;
  name: string;
  glyph: string;
  text: string;
  /** Relative chance when seeding rooms. */
  weight: number;
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
    text: 'A narrow crack in the wall. Cold air flows through it — from the direction of the rendezvous.',
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
};

/** What the Speed events do. Speed is in seconds (lower is faster). */
export const SPEED_EVENTS = {
  /** Quicksilver: faster for the rest of the run, but frailer. */
  quicksilverSpeed: -1,
  quicksilverMaxHp: -6,
  /** Courier's Satchel: gold for the hero who hauls it, who is slower for the rest of the run. */
  satchelGold: 45,
  satchelSpeed: 1,
  /** Hourglass: everyone in the room is faster for a while. */
  hourglassSpeed: -1.5,
  hourglassDuration: 90,
  /** Clockwork Shrine: a long wind for a small, lasting edge. */
  clockworkSpeed: -0.5,
};

/** Seconds an event choice takes to carry out, by class. */
export function channelTime(kind: EventKind, cls: ClassId): number {
  switch (kind) {
    case 'altar': return cls === 'witch' ? 12 : 18;
    case 'vault': return cls === 'cutthroat' ? 12 : 24;
    case 'quicksilver':
    case 'satchel':
    case 'hourglass': return 3;
    case 'clockwork': return 15;
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
  /** Leading a villager slows you to this fraction of normal speed. */
  villagerSpeed: 0.7,
};
