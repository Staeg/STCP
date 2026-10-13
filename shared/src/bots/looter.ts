import { LIGHT_MAX } from '../content/constants';
import { STRESS_MAX } from '../sim/combat';
import { BOTS } from './tuning';
import { gearGain, isCursed, isArms, isGear, slotOf, type ItemId } from '../content/items';
import { CLASSES, type ClassId } from '../content/classes';
import { BOT_DEFER_AFTER, LEAVE } from '../sim/loot';
import type { LootItemView, PlayerView } from '../sim/views';
import type { Intent } from '../sim/world';

/**
 * Loot votes for bots, one floor item at a time (each has its own vote). A bot first backs whoever its heuristic
 * likes, then after a couple of seconds defers to the humans' majority. In an all-bot room every bot converges on
 * the lowest-id bot's choice, so votes can never deadlock. Alone, backing yourself just picks it up.
 * Returns an intent, null to wait, or undefined if there's nothing to vote on.
 */
export function botVote(view: PlayerView): Intent | null | undefined {
  const loot = view.loot;
  const me = view.you;
  if (!loot || loot.items.length === 0 || !loot.voters.includes(me.id)) return undefined;
  const isBot = (id: string) => (id === me.id ? me.isBot : view.allies.find((a) => a.id === id)?.isBot ?? false);
  for (const f of loot.items) {
    let choice = preferredRecipient(view, f);
    if (view.time - f.startedAt >= BOT_DEFER_AFTER) {
      const humanVotes = f.voters.filter((v) => !isBot(v)).map((v) => f.votes[v]).filter((v): v is string => !!v);
      if (humanVotes.length) {
        choice = majority(humanVotes);
      } else if (f.voters.every(isBot)) {
        const leader = [...f.voters].sort()[0];
        if (leader !== me.id && f.votes[leader]) choice = f.votes[leader];
      }
    }
    // Leaving takes it out of the vote for good, so not while someone's offering it to me.
    if (choice === LEAVE && Object.values(f.votes).includes(me.id)) choice = me.id;
    if (choice !== f.votes[me.id]) return { type: 'vote', item: f.id, choice };
  }
  return null;
}

function preferredRecipient(view: PlayerView, f: LootItemView): string {
  const me = view.you;
  const cands = f.candidates;
  if (cands.length === 0) return LEAVE;
  const meCand = cands.find((c) => c.id === me.id);
  const hpFrac = (id: string) => {
    if (id === me.id) return me.hp / me.maxHp;
    const a = view.allies.find((x) => x.id === id);
    return a ? a.hp / a.maxHp : 1;
  };
  if (isGear(f.item)) {
    // Whoever it's the biggest upgrade for (ties: me). Nobody gains → a player, whose Stash keeps it; else leave it.
    const best = cands
      .map((c) => ({ id: c.id, gain: wornGain(f.item, c.wearing ?? null, classOf(view, c.id)) }))
      .filter((c) => c.gain > 0)
      .sort((a, b) => b.gain - a.gain || Number(b.id === me.id) - Number(a.id === me.id))[0];
    return best ? best.id : cands.find((c) => !c.isBot)?.id ?? LEAVE;
  }
  switch (f.item) {
    case 'bandage':
      return [...cands].sort((a, b) => hpFrac(a.id) - hpFrac(b.id))[0].id;
    case 'torch':
      return meCand && me.light < 60 ? me.id : cands[0].id;
    default:
      // Mediocre and a bit selfish: keep it if there's room, else hand it to whoever has the most space.
      return meCand ? me.id : [...cands].sort((a, b) => b.free - a.free)[0].id;
  }
}

/**
 * How much better a piece is than what's worn: weapons and armor by their numbers; amulets and rings blessed beats
 * nothing beats cursed (bots don't trade health for haste).
 */
/** Classes that lean on Staves (heal, ease, hinder) more than on raw damage. */
const STAFF_CLASSES: ClassId[] = ['lampbearer', 'sorceress', 'alchemist', 'bellwright'];

function classOf(view: PlayerView, id: string): ClassId | undefined {
  return id === view.you.id ? view.you.cls : view.allies.find((a) => a.id === id)?.cls;
}

function wornGain(item: ItemId, wearing: ItemId | null, cls?: ClassId): number {
  if (isArms(item)) return gearGain(item, wearing, cls && { support: STAFF_CLASSES.includes(cls), speed: CLASSES[cls].speed });
  const worth = (id: ItemId | null) => (!id ? 0 : isCursed(id) ? -1 : 1);
  return worth(item) - worth(wearing);
}

function majority(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Use a consumable out of combat when it obviously helps. */
export function botUseItem(view: PlayerView): Intent | null {
  const me = view.you;
  const idx = (pred: (id: string) => boolean) => me.items.findIndex(pred);
  // Put on anything in the pack that beats what's worn (pickups only go on into an empty slot).
  const better = me.items.findIndex((x) => isGear(x) && wornGain(x, me[slotOf(x)!], me.cls) > 0);
  if (better >= 0) return { type: 'useItem', index: better };
  // Patch up once HP, sanity or light is a third gone (BOTS.consumeAt).
  const low = (frac: number) => frac <= 1 - BOTS.consumeAt;
  let i = idx((x) => x === 'bandage');
  if (i >= 0 && (low(me.hp / me.maxHp) || me.st.poison)) return { type: 'useItem', index: i };
  i = idx((x) => x === 'torch');
  if (i >= 0 && low(me.light / LIGHT_MAX)) return { type: 'useItem', index: i };
  i = idx((x) => x === 'tonic');
  if (i >= 0 && low(1 - me.stress / STRESS_MAX)) return { type: 'useItem', index: i };
  i = idx((x) => x === 'salts');
  const downed = view.allies.find((a) => a.live && a.downed && !a.dead);
  if (i >= 0 && downed) return { type: 'useItem', index: i, target: downed.id };
  return null;
}

