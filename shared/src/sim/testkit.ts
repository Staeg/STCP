import { neighbours } from '../dungeon/gen';
import type { CardId } from '../content/cards';
import type { ClassId } from '../content/classes';
import type { EnemyId } from '../content/enemies';
import { spawnGroup, submitChoice, type Encounter } from './combat';
import { addHero, applyIntent, createWorld, step, type Hero, type World } from './world';

/**
 * Test helpers for fights (M15): an arena next to the entrance, walking in, and putting particular cards in hand.
 * Only tests import this.
 */

export function run(world: World, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); i++) step(world, 0.1);
}

/** Heroes at the entrance, a monster group in the next room. */
export function arena(classes: ClassId[], enemies: EnemyId[], seed = 777) {
  const world = createWorld(seed, { monsters: false });
  const d = world.dungeon;
  const ids = classes.map((cls, i) => addHero(world, { id: `h${i}`, name: `H${i}`, cls }).id);
  const room = neighbours(d, d.entrance)[0];
  const monsters = spawnGroup(world, room, enemies, 0);
  return { world, d, ids, room, monsters };
}

export function walkIn(world: World, ids: string[], room: number) {
  for (const id of ids) applyIntent(world, id, { type: 'goto', room });
  for (let i = 0; i < 100 && ids.some((id) => world.heroes[id].encounter === null); i++) step(world, 0.1);
}

/** Step until this unit has taken its next turn (or the fight is over). */
export function untilTurn(world: World, room: number, id: string) {
  const enc = world.encounters[room];
  if (!enc) return;
  const due = enc.next[id];
  for (let i = 0; i < 300 && world.encounters[room] === enc && enc.next[id] === due; i++) step(world, 0.1);
}

/** Put exactly these cards in the hero's hand (the rest of their deck stays to draw from). */
export function setHand(h: Hero, cards: CardId[]) {
  if (!h.deck) throw new Error(`${h.name} is not in a fight`);
  h.deck.hand = [...cards];
}

/**
 * Put the card in hand if it isn't, lock it in, and have the hero play it at once, with every other unit in the fight
 * held back so nothing else happens meanwhile. Returns the fight.
 */
export function play(world: World, h: Hero, card: CardId, target?: string, room?: number): Encounter {
  const enc = world.encounters[h.encounter!];
  if (!h.deck?.hand.includes(card)) setHand(h, [card, ...(h.deck?.hand ?? []).slice(0, 2)]);
  const err = submitChoice(world, h, { action: 'card', card, target, room });
  if (err) throw new Error(err);
  for (const id of Object.keys(enc.next)) if (id !== h.id && enc.next[id] < world.time + 500) enc.next[id] = world.time + 999;
  enc.next[h.id] = world.time;
  untilTurn(world, enc.room, h.id);
  return enc;
}

/** Make every monster in the fight wait (so they don't act while a test looks at a hero). */
export function holdMonsters(world: World, enc: Encounter, seconds = 999) {
  for (const id of Object.keys(enc.next)) if (world.monsters[id]) enc.next[id] = world.time + seconds;
}
