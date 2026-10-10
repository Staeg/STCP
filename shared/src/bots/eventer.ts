import type { BotMemory } from './explorer';
import { BOTS } from './tuning';
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
  // Already decided here (but keep channelling an altar/vault/Elite Event we chose to work on, or praying).
  if (mem.decided.includes(room) && !(mem.channelling === room && (ev.progress !== undefined || ev.kind === 'liturgy'))) return undefined;
  mem.decided.push(room);
  const rng = mem.rng;
  const timeLeft = mem.returnAt - view.time;
  // Risky events only when healthy.
  const healthy = you.hp / you.maxHp > 0.6;
  const pick = (id: string): Intent | undefined => {
    const c = ev.choices.find((x) => x.id === id);
    return c && !c.disabled ? { type: 'event', choice: id } : undefined;
  };
  /** Start (or keep at) a channel here. */
  const work = (id: string): Intent | undefined => {
    mem.channelling = room;
    return pick(id);
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
      // A Sorceress wakes no guardians, so she needs neither the health nor the luck.
      if (timeLeft > 40 && (you.cls === 'sorceress' || (healthy && rng.chance(0.4)))) {
        mem.channelling = room;
        return pick('channel');
      }
      return undefined;
    case 'vault':
      if (timeLeft > 30 && rng.chance(0.5)) {
        mem.channelling = room;
        return pick('channel');
      }
      return undefined;
    case 'idol':
      return you.cls === 'cutthroat' || mem.greed > 0.5 ? pick('take') : undefined;
    case 'stranger':
      return you.cls === 'lampbearer' || (healthy && rng.chance(0.35)) ? pick('help') : undefined;
    case 'well':
      if (you.cls === 'zealot') return you.hp < you.maxHp ? pick('drink') : undefined;
      return you.stress > 40 || rng.chance(0.3) ? pick('drink') : undefined;
    case 'chest':
      return you.cls === 'undertaker' || (healthy && you.stress < 40 && rng.chance(0.6)) ? pick('open') : undefined;
    case 'crawlspace':
      return view.time >= mem.returnAt && you.hp > 20 && you.items.includes('torch') ? pick('crawl') : undefined;
    case 'quicksilver':
      return you.cls === 'alchemist' || (healthy && rng.chance(0.5)) ? pick('quaff') : undefined;
    case 'satchel':
      // Greedy bots take the money; it's heavy, so mostly early, while there's time to carry it.
      return mem.greed > 0.45 && timeLeft > 60 ? pick('haul') : undefined;
    case 'hourglass':
      // Better with company: wait for nobody, but always turn it when someone else is here.
      return view.allies.some((a) => a.live && a.pos.kind === 'room' && a.pos.room === room) || rng.chance(0.6) ? pick('turn') : undefined;
    case 'clockwork':
      return timeLeft > 120 && rng.chance(0.5) ? pick('wind') : undefined;
    // ---- Elite Events (only their own class gets choices; the rest see it veiled) ----
    case 'wanderers':
    case 'uprising':
    case 'zenith':
    case 'alacrity':
      return timeLeft > 20 ? work(ev.choices[0]?.id ?? '') : undefined;
    case 'cant':
      // A map is worth most early.
      return timeLeft > 60 ? work('read') : undefined;
    case 'sacrament':
      // Everyone pays for the Sorceress's speed: only sometimes, and only with time to use it.
      return timeLeft > 90 && (mem.sacrament ??= rng.chance(0.5)) ? work('partake') : undefined;
    case 'barrage':
      // Draws every monster near: only when healthy, and only sometimes.
      return timeLeft > 60 && healthy && (mem.barrage ??= rng.chance(0.5)) ? work('ring') : undefined;
    case 'liturgy': {
      // Pray for a while, as long as somebody (you included) still needs it.
      mem.prayUntil ??= view.time + BOTS.liturgyPray;
      const needed = you.stress > 15 || you.hp < you.maxHp || view.allies.some((a) => !a.dead && !a.extracted && a.hp < a.maxHp);
      return view.time < mem.prayUntil && timeLeft > 20 && needed ? work('pray') : undefined;
    }
  }
  return undefined;
}
