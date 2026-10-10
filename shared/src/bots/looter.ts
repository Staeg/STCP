import { LIGHT_DIM, LIGHT_MAX } from '../content/constants';
import { STRESS_MAX } from '../sim/combat';
import { BOTS } from './tuning';
import { gearGain, isCursed, isGear, isJewel, type ItemId } from '../content/items';
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
      const humanVotes = loot.voters.filter((v) => !isBot(v)).map((v) => f.votes[v]).filter((v): v is string => !!v);
      if (humanVotes.length) {
        choice = majority(humanVotes);
      } else if (loot.voters.every(isBot)) {
        const leader = [...loot.voters].sort()[0];
        if (leader !== me.id && f.votes[leader]) choice = f.votes[leader];
      }
    }
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
    // Whoever it's the biggest upgrade for (ties: me). Nobody gains → leave it, so swaps can't ping-pong.
    const best = cands
      .map((c) => ({ id: c.id, gain: gearGain(f.item, c.wearing ?? null) }))
      .filter((c) => c.gain > 0)
      .sort((a, b) => b.gain - a.gain || Number(b.id === me.id) - Number(a.id === me.id))[0];
    return best ? best.id : LEAVE;
  }
  if (isJewel(f.item)) {
    // Blessed beats nothing beats cursed (bots don't trade health for haste). Nobody gains → leave it.
    const worth = (id: ItemId | null | undefined) => (!id ? 0 : isCursed(id) ? -1 : 1);
    const best = cands
      .map((c) => ({ id: c.id, gain: worth(f.item) - worth(c.wearing) }))
      .filter((c) => c.gain > 0)
      .sort((a, b) => b.gain - a.gain || Number(b.id === me.id) - Number(a.id === me.id))[0];
    return best ? best.id : LEAVE;
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

function majority(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Use a consumable out of combat when it obviously helps. */
export function botUseItem(view: PlayerView): Intent | null {
  const me = view.you;
  const skill = botSkill(view);
  if (skill) return skill;
  const idx = (pred: (id: string) => boolean) => me.items.findIndex(pred);
  // Patch up once HP, sanity or light is a third gone (BOTS.consumeAt).
  const low = (frac: number) => frac <= 1 - BOTS.consumeAt;
  let i = idx((x) => x === 'bandage');
  if (i >= 0 && (low(me.hp / me.maxHp) || me.st.bleed)) return { type: 'useItem', index: i };
  i = idx((x) => x === 'torch');
  if (i >= 0 && low(me.light / LIGHT_MAX)) return { type: 'useItem', index: i };
  i = idx((x) => x === 'tonic');
  if (i >= 0 && low(1 - me.stress / STRESS_MAX)) return { type: 'useItem', index: i };
  i = idx((x) => x === 'salts');
  const downed = view.allies.find((a) => a.live && a.downed && !a.dead);
  if (i >= 0 && downed) return { type: 'useItem', index: i, target: downed.id };
  return null;
}


/**
 * Out-of-combat class skills: the Zealot lifts a burdened ally's stress; the Alchemist primes a Bandage when hurt;
 * the Lampbearer mends a hurt ally, eases their own stress, and lights a flare when the dark closes in.
 */
function botSkill(view: PlayerView): Intent | null {
  const me = view.you;
  if (me.pos.kind !== 'room' || me.queuedSkill) return null;
  const ready = (id: string) => (me.cooldowns[id] ?? 0) <= 0;
  const here = me.pos.room;
  const near = view.allies.filter((a) => a.live && !a.downed && !a.dead && a.pos.kind === 'room' && a.pos.room === here && a.affliction !== 'paranoid');
  if (me.cls === 'zealot' && me.stress < 90 && ready('sins')) {
    const burdened = near.filter((a) => (a.stress ?? 0) >= 40).sort((a, b) => (b.stress ?? 0) - (a.stress ?? 0))[0];
    if (burdened) return { type: 'skill', skill: 'sins', target: burdened.id };
  }
  if (me.cls === 'alchemist' && ready('elixir') && !me.elixir && me.hp / me.maxHp < 0.5 && me.items.includes('bandage')) {
    return { type: 'skill', skill: 'elixir', target: me.id };
  }
  if (me.cls === 'lampbearer') {
    const hurt = near.filter((a) => a.hp / a.maxHp < 0.75).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    if (hurt && ready('mend')) return { type: 'skill', skill: 'mend', target: hurt.id };
    if (me.stress > 30 && ready('vigil')) return { type: 'skill', skill: 'vigil', target: me.id };
    if (me.light < LIGHT_DIM + 5 && ready('flare')) return { type: 'skill', skill: 'flare' };
  }
  return null;
}
