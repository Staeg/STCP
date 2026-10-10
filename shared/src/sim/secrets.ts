import { SECRET_GUARDS } from '../content/enemies';
import { LOOT } from '../content/items';
import { openSecret, openSecrets, theRoom, type SecretPassage } from '../dungeon/gen';
import { crUnits, inDungeon, spawnGroup } from './combat';
import { addToPile, rollItem, rollResource } from './loot';
import { notify } from './notify';
import { chronicle, explore, type World } from './world';

/**
 * Secret rooms (user, 2026-10-10): sealed from the start and invisible, two open at Escalation 4 and four more at Escalation 5,
 * each off a single ordinary room by a golden tunnel. Inside: a lair's worth of loot behind a small guard.
 */
export function openDueSecrets(world: World) {
  const opened = openSecrets(world.dungeon, world.escalation);
  for (const s of opened) stockSecret(world, s);
  // Passages a Cutthroat already had to themself (Cunning Cant) open for everyone now.
  const unveiled = world.dungeon.secrets.filter((s) => s.open && s.corridor.privy && s.escalation <= world.escalation);
  for (const s of unveiled) unveil(world, s);
  if (opened.length || unveiled.length) {
    for (const h of Object.values(world.heroes)) {
      if (inDungeon(h)) notify(world, h, 'Somewhere in the dark, stone grinds on stone. Hidden ways have opened.');
    }
  }
}

/** Break one secret room open ahead of its Escalation (the Crawlspace), with its loot and guards. */
export function openSecretEarly(world: World, s: SecretPassage) {
  if (s.open) return unveil(world, s);
  openSecret(world.dungeon, s);
  stockSecret(world, s);
}

/**
 * Cunning Cant: open a sealed passage for these heroes only. It's stocked and guarded as usual, but nobody else can
 * see or use it until it opens for real (its Escalation, or a Crawlspace).
 */
export function openSecretFor(world: World, s: SecretPassage, heroIds: string[]) {
  if (s.open) {
    if (s.corridor.privy) for (const id of heroIds) if (!s.corridor.privy.includes(id)) s.corridor.privy.push(id);
    return;
  }
  s.corridor.privy = [...heroIds];
  openSecret(world.dungeon, s);
  stockSecret(world, s);
}

/** A passage known only to a few is now open to all. Whoever stands at its mouth sees it. */
function unveil(world: World, s: SecretPassage) {
  if (!s.corridor.privy) return;
  delete s.corridor.privy;
  for (const h of Object.values(world.heroes)) {
    if (inDungeon(h) && h.pos.kind === 'room' && h.pos.room === s.host) explore(world, h, s.host);
  }
}

/** A passage has just opened: fill the room behind it, and show anyone at its mouth. */
function stockSecret(world: World, s: SecretPassage) {
  const d = world.dungeon;
  const rng = world.rng;
  const items = [rollItem(world, 3), rollResource(world)];
  if (rng.chance(LOOT.relicChance)) items.push('relic');
  addToPile(world, s.room, rng.int(...LOOT.lairGold), items);
  const total = SECRET_GUARDS.reduce((t, g) => t + g.weight, 0);
  let roll = rng.float(0, total);
  const group = SECRET_GUARDS.find((g) => (roll -= g.weight) <= 0) ?? SECRET_GUARDS[0];
  spawnGroup(world, s.room, crUnits(world, group.units, 'room', s.room), world.escalation);
  // Like a lair: the guards' fall drops more, and better, than they're worth on their own.
  world.bounty[s.room] = (world.bounty[s.room] ?? 0) + LOOT.lairBounty;
  chronicle(world, `A hidden passage opened from ${theRoom(d.rooms[s.host].name)} into ${d.rooms[s.room].name}.`);
  // Anyone standing at its mouth sees it open (and, with light, what's beyond); a privy passage, only those it's open to.
  for (const h of Object.values(world.heroes)) {
    if (s.corridor.privy && !s.corridor.privy.includes(h.id)) continue;
    if (inDungeon(h) && h.pos.kind === 'room' && h.pos.room === s.host) {
      explore(world, h, s.host);
      notify(world, h, 'The wall grinds aside: a passage glints with gold!');
    }
  }
}
