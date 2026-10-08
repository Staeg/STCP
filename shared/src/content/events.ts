import type { ClassId } from './classes';

export type AfflictionId = 'selfish' | 'fearful' | 'paranoid' | 'hopeless';

export interface AfflictionDef {
  id: AfflictionId;
  name: string;
  desc: string;
}

export const AFFLICTIONS: Record<AfflictionId, AfflictionDef> = {
  selfish: { id: 'selfish', name: 'Selfish', desc: 'Always votes to keep loot. Votes go ahead without them after 10s.' },
  fearful: { id: 'fearful', name: 'Fearful', desc: '25% chance to flee instead of acting in a fight.' },
  paranoid: { id: 'paranoid', name: 'Paranoid', desc: "Refuses allies' healing and protection." },
  hopeless: { id: 'hopeless', name: 'Hopeless', desc: 'Deals 30% less damage.' },
};

export const STRESS = {
  /** Per second while Dim / in total darkness. */
  dimPerSec: 0.15,
  darkPerSec: 0.5,
  /** After the first break, stress resets here. */
  afterBreak: 60,
  /** Selfish voters are dropped from a vote after this long. */
  selfishGrace: 10,
};

export type EventKind = 'altar' | 'villager' | 'idol' | 'stranger' | 'well' | 'vault' | 'chest' | 'crawlspace';

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
};

/** Seconds for channelled events, by class. */
export function channelTime(kind: 'altar' | 'vault', cls: ClassId): number {
  if (kind === 'altar') return cls === 'hexer' ? 7 : 15;
  return cls === 'cutthroat' ? 7 : 20;
}

export const EVENT_SEEDING = {
  /** Chance a normal room (not entrance/exit/next to the entrance) gets an event. */
  chance: 0.28,
  /** Bonus gold to every hero who escapes, per objective. */
  altarBonus: 15,
  villagerBonus: 25,
  villagerHp: 10,
  /** Leading a villager slows you to this fraction of normal speed. */
  villagerSpeed: 0.7,
};
