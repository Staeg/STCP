import type { BotMemory } from './explorer';
import type { PlayerView } from '../sim/views';
import type { Intent } from '../sim/world';

/**
 * Bots and room events: decide once per room, with mediocre-but-plausible judgement.
 * Returns an intent, or undefined if there's nothing to decide here.
 */
export function botEvent(view: PlayerView, mem: BotMemory): Intent | undefined {
  const ev = view.event;
  const you = view.you;
  if (!ev || ev.blocked || you.pos.kind !== 'room') return undefined;
  const room = you.pos.room;
  // Already decided here (but keep channelling an altar/vault we chose to work on).
  if (mem.decided.includes(room) && !(mem.channelling === room && ev.progress !== undefined)) return undefined;
  mem.decided.push(room);
  const rng = mem.rng;
  const timeLeft = mem.returnAt - view.time;
  // Risky events only when healthy.
  const healthy = you.hp / you.maxHp > 0.6;
  const pick = (id: string): Intent | undefined => {
    const c = ev.choices.find((x) => x.id === id);
    return c && !c.disabled ? { type: 'event', choice: id } : undefined;
  };
  switch (ev.kind) {
    case 'villager': {
      // Deliver them to the rendezvous, then carry on exploring.
      const go = pick('lead');
      if (go) {
        mem.escortReturnAt = mem.returnAt;
        mem.returnAt = view.time;
      }
      return go;
    }
    case 'altar':
      if (healthy && timeLeft > 40 && (you.cls === 'witch' || rng.chance(0.4))) {
        mem.channelling = room;
        return pick('channel');
      }
      return undefined;
    case 'vault':
      if (timeLeft > 30 && (you.cls === 'cutthroat' || rng.chance(0.5))) {
        mem.channelling = room;
        return pick('channel');
      }
      return undefined;
    case 'idol':
      return mem.greed > 0.5 ? pick('take') : undefined;
    case 'stranger':
      return healthy && rng.chance(0.35) ? pick('help') : undefined;
    case 'well':
      return you.stress > 40 || rng.chance(0.3) ? pick('drink') : undefined;
    case 'chest':
      return healthy && you.stress < 40 && rng.chance(0.6) ? pick('open') : undefined;
    case 'crawlspace':
      return view.time >= mem.returnAt && you.hp > 20 && you.items.includes('torch') ? pick('crawl') : undefined;
    case 'quicksilver':
      return healthy && rng.chance(0.5) ? pick('quaff') : undefined;
    case 'satchel':
      // Greedy bots take the money; it's heavy, so mostly early, while there's time to carry it.
      return mem.greed > 0.45 && timeLeft > 60 ? pick('haul') : undefined;
    case 'hourglass':
      // Better with company: wait for nobody, but always turn it when someone else is here.
      return view.allies.some((a) => a.live && a.pos.kind === 'room' && a.pos.room === room) || rng.chance(0.6) ? pick('turn') : undefined;
    case 'clockwork':
      return timeLeft > 120 && rng.chance(0.5) ? pick('wind') : undefined;
  }
  return undefined;
}
