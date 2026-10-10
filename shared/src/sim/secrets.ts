import { SECRET_GUARDS } from '../content/enemies';
import { LOOT } from '../content/items';
import { openSecret, openSecrets, theRoom, type SecretPassage } from '../dungeon/gen';
import { crUnits, inDungeon, spawnGroup } from './combat';
import { addToPile, rollItem, rollValuable } from './loot';
import { notify } from './notify';
import { chronicle, explore, type World } from './world';

/**
 * Secret rooms (user, 2026-10-10): sealed from the start and invisible, two open at tier 4 and four more at tier 5,
 * each off a single ordinary room by a golden tunnel. Inside: a lair's worth of loot behind a small guard.
 */
export function openDueSecrets(world: World) {
  const opened = openSecrets(world.dungeon, world.tier);
  for (const s of opened) stockSecret(world, s);
  if (opened.length) {
    for (const h of Object.values(world.heroes)) {
      if (inDungeon(h)) notify(world, h, 'Somewhere in the dark, stone grinds on stone. Hidden ways have opened.');
    }
  }
}

/** Break one secret room open ahead of its tier (the Crawlspace), with its loot and guards. */
export function openSecretEarly(world: World, s: SecretPassage) {
  if (s.open) return;
  openSecret(world.dungeon, s);
  stockSecret(world, s);
}

/** A passage has just opened: fill the room behind it, and show anyone at its mouth. */
function stockSecret(world: World, s: SecretPassage) {
  const d = world.dungeon;
  const rng = world.rng;
  const items = [rollItem(world, 3), rollValuable(world)];
  if (rng.chance(LOOT.relicChance)) items.push('relic');
  addToPile(world, s.room, rng.int(...LOOT.lairGold), items);
  const total = SECRET_GUARDS.reduce((t, g) => t + g.weight, 0);
  let roll = rng.float(0, total);
  const group = SECRET_GUARDS.find((g) => (roll -= g.weight) <= 0) ?? SECRET_GUARDS[0];
  spawnGroup(world, s.room, crUnits(world, group.units, 'room', s.room), world.tier);
  // Like a lair: the guards' fall drops more, and better, than they're worth on their own.
  world.bounty[s.room] = (world.bounty[s.room] ?? 0) + LOOT.lairBounty;
  chronicle(world, `A hidden passage opened from ${theRoom(d.rooms[s.host].name)} into ${d.rooms[s.room].name}.`);
  // Anyone standing at its mouth sees it open (and, with light, what's beyond).
  for (const h of Object.values(world.heroes)) {
    if (inDungeon(h) && h.pos.kind === 'room' && h.pos.room === s.host) {
      explore(world, h, s.host);
      notify(world, h, 'The wall grinds aside: a passage glints with gold!');
    }
  }
}
