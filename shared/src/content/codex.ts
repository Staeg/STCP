import type { ClassId } from './classes';
import { CLASS_EVENTS, CROWNED, ELITE_EVENTS, EVENT_SEEDING, EVENTS, LIGHT_LOSS, MORE_EVENTS, SPEED_EVENTS, type EventKind } from './events';
import { ENEMIES, type EnemyId } from './enemies';
import { ITEMS, type ItemId } from './items';

/**
 * The Codex (user, 2026-10-11): what each player has come across in their runs, shown in the Village's Armory
 * (items), Bestiary (monsters) and Archive (events). Kept per player in the stash; nothing from before it existed.
 */
export interface Codex {
  items: ItemId[];
  enemies: EnemyId[];
  events: EventKind[];
  /** Class event twists (`TwistId`) found by meeting the event while playing that class (user, 2026-10-11). */
  twists: TwistId[];
}

export function emptyCodex(): Codex {
  return { items: [], enemies: [], events: [], twists: [] };
}

/**
 * Class event twists (see CLASS_EVENTS): each class does an event its own way. Never shown in the class picker; the
 * Archive lists one once a player has met that event while playing that class.
 */
export const TWISTS = {
  'sorceress-altar': { cls: 'sorceress', event: 'altar', text: 'Her rites keep its guardians asleep: none wake while she cleanses it.' },
  'cutthroat-idol': { cls: 'cutthroat', event: 'idol', text: 'Light fingers: the trap never springs, and nothing caves in.' },
  'lampbearer-stranger': { cls: 'lampbearer', event: 'stranger', text: 'Tends the wound with no bandage, and the stranger always repays it.' },
  'lampbearer-crawlspace': { cls: 'lampbearer', event: 'crawlspace', text: 'The lamp stays lit through the squeeze.' },
  'zealot-well': { cls: 'zealot', event: 'well', text: `The dark water feeds the fervour: always +${CLASS_EVENTS.zealotWellHp} HP, and the lamp goes out.` },
  'undertaker-chest': { cls: 'undertaker', event: 'chest', text: 'The dead hold no fear: the lamp holds steady as it opens.' },
  'warden-villager': { cls: 'warden', event: 'villager', text: `They hurry the Warden along: Speed −${Math.abs(CLASS_EVENTS.wardenEscortSpeed)}s while escorting, instead of slower.` },
  'bellwright-hourglass': { cls: 'bellwright', event: 'hourglass', text: 'The haste lasts the rest of the run, for everyone in the room.' },
  'alchemist-quicksilver': { cls: 'alchemist', event: 'quicksilver', text: `Drinks it safely: +${CLASS_EVENTS.alchemistQuicksilverMaxHp} max HP instead of losing some.` },
} as const satisfies Record<string, { cls: ClassId; event: EventKind; text: string }>;
export type TwistId = keyof typeof TWISTS;
export const TWIST_IDS = Object.keys(TWISTS) as TwistId[];

/** Everything the Armory can list, in the item catalogue's order. */
export const CODEX_ITEMS = Object.keys(ITEMS) as ItemId[];
/** Every monster the Bestiary can list (not Howl's wolves: they fight for you). */
export const CODEX_ENEMIES = (Object.keys(ENEMIES) as EnemyId[]).filter((e) => !ENEMIES[e].ally);
/** Every event the Archive can list (not the veil others see over an Elite Event). */
export const CODEX_EVENTS = (Object.keys(EVENTS) as EventKind[]).filter((k) => k !== 'veiled');

/** Adds what `found` holds that `into` lacks; true if anything was new. */
export function mergeCodex(into: Codex, found: Partial<Codex>): boolean {
  let added = false;
  const add = <T>(list: T[], more: readonly T[] | undefined, known: readonly T[]) => {
    for (const x of more ?? []) {
      if (known.includes(x) && !list.includes(x)) {
        list.push(x);
        added = true;
      }
    }
  };
  add(into.items, found.items, CODEX_ITEMS);
  add(into.enemies, found.enemies, CODEX_ENEMIES);
  add(into.events, found.events, CODEX_EVENTS);
  add((into.twists ??= []), found.twists, TWIST_IDS);
  return added;
}

/**
 * What each ordinary event does, for the Archive (Elite Events say it in their own text). Class twists stay out:
 * players find those by playing.
 */
export const EVENT_RULES: Partial<Record<EventKind, string>> = {
  altar: `Cleanse it (18s). Halfway through, its guardians wake, a step stronger than the dungeon. Cleansed: +${LIGHT_LOSS.altarLight} light for everyone still inside, and +${EVENT_SEEDING.altarBonus} gold to every hero who escapes.`,
  villager: `Free them and they follow you (+${EVENT_SEEDING.villagerSlow}s Speed each) until they reach the exit room: +${EVENT_SEEDING.villagerBonus} gold to every hero who escapes. Monsters may hit them.`,
  idol: 'Take it for a lot of gold, but the tunnel you came by caves in.',
  stranger: `Spend a Bandage on them: a reward, or (${Math.round(EVENT_SEEDING.strangerTrap * 100)}% of the time) an ambush. Walking out on a trap springs it too.`,
  well: `Drink: +${LIGHT_LOSS.wellLight} light, 15 HP, or whispers (your light goes out).`,
  vault: 'Pick the lock (24s) for fine loot.',
  chest: `Open it: loot, and −${LIGHT_LOSS.chest} light.`,
  crawlspace: 'Squeeze through (4 damage, your torch gutters) into a secret room you haven\'t found, or later a few rooms nearer the exit.',
  quicksilver: `Drink: Speed ${SPEED_EVENTS.quicksilverSpeed}s for the run, ${SPEED_EVENTS.quicksilverMaxHp} max HP.`,
  satchel: "Take the Courier's Satchel: worth 150 gold if you carry it out, +1.5s Speed while you do.",
  hourglass: `Turn it: everyone in the room is ${-SPEED_EVENTS.hourglassSpeed}s faster for ${SPEED_EVENTS.hourglassDuration}s.`,
  clockwork: `Wind it (${SPEED_EVENTS.clockworkWork}s ÷ your Speed: the quick take longer): Speed ${SPEED_EVENTS.clockworkSpeed}s for the run.`,
  locks: `Two heroes must turn the wheels together for ${MORE_EVENTS.locksTime}s: ${MORE_EVENTS.locksGold[0]}–${MORE_EVENTS.locksGold[1]} gold, a fine find and a Relic.`,
  coffin: 'Lie down: your light is rekindled to full, and you lie Downed until someone gets you up.',
  anvil: `Reforge a piece you wear (${MORE_EVENTS.anvilTime}s) into a better one of its kind. Not a Rare or a Legendary.`,
  loom: 'Weave worn-out Cloth whole again: every charge, cooldown and use back to fresh.',
  scrying: `Gaze (${MORE_EVENTS.scryTime}s): for ${MORE_EVENTS.scrySecs}s you see every ally and the room each is in.`,
  crowned: `Wake the Dead King: his procession of ${CROWNED.procession.length} sets out from far off for the exit, and holds it until killed. The last to fall drops ${CROWNED.lairs} Lairs' worth of treasure and a Legendary.`,
};

/** A line on the Elite Events' rules (their text already gives the details). */
export const ELITE_NOTE = `Elite: each hero adds a ${Math.round(ELITE_EVENTS.chancePerHero * 100)}% chance their class's is in the dungeon, and only that class can do it.`;
