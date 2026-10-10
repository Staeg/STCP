import { botThink, createBotMemory, type BotMemory } from '../bots/explorer';
import { chooseCombatAction } from '../bots/fighter';
import type { ClassId } from '../content/classes';
import { heroCr, KIT_RULES, rollCr, type Loadout } from '../village';
import { Rng } from '../rng';
import { buildView } from './views';
import { isConscious } from './combat';
import { addHero, applyIntent, createWorld, step, type Hero, type Intent, type World, type WorldOptions } from './world';

export interface PlayerSlot {
  id: string;
  name: string;
  cls: ClassId;
  isBot: boolean;
  /** The Village Character this hero is, if any (its Talent, injuries and affliction come with it). */
  loadout?: Loadout;
}

/** The party's combined CR before the roll: a point per Talent, plus each player's Gear and Rites. */
export function combinedCr(slots: PlayerSlot[]): number {
  return Math.round(slots.reduce((s, x) => s + heroCr(x.loadout?.talent, x.loadout?.kit), 0) * 100) / 100;
}

/** A running expedition: the world plus the bots that inhabit it. Shared by the server and the headless sim. */
export class Game {
  readonly world: World;
  readonly bots = new Map<string, BotMemory>();

  constructor(seed: number, slots: PlayerSlot[], opts: WorldOptions = {}) {
    // Challenge Rating: rolled from the heroes' combined CR (Talents, Gear, Rites), unless the caller fixes it.
    const cr = opts.cr ?? rollCr(combinedCr(slots), new Rng(seed ^ 0x2545f491));
    // Relic Rite: anyone's makes it the whole party's run.
    const relic = slots.some((s) => s.loadout?.kit?.rites.includes('relic'));
    // The players' Emergencies decide what the dungeon must hold (M13).
    const emergencies = opts.emergencies ?? slots.flatMap((s) => (!s.isBot && s.loadout?.emergency ? [s.loadout.emergency] : []));
    this.world = createWorld(seed, { ...opts, cr, emergencies, startEscalation: opts.startEscalation ?? (relic ? KIT_RULES.relicEscalation : 0) });
    slots.forEach((slot, i) => {
      addHero(this.world, slot);
      if (slot.isBot) this.bots.set(slot.id, createBotMemory((seed ^ 0x9e3779b9) + i * 7919, this.world.startTime));
    });
  }

  /** Hand a hero over to a bot (e.g. a player left mid-run). */
  makeBot(heroId: string) {
    const hero = this.world.heroes[heroId];
    if (!hero) return;
    hero.isBot = true;
    hero.autopilot = false;
    if (!this.bots.has(heroId)) this.bots.set(heroId, createBotMemory(this.world.seed + this.bots.size * 104729, this.world.startTime));
  }

  /** O: a bot takes the wheel for this player, or hands it back. Others can't tell (the hero isn't marked a bot). */
  toggleAutopilot(heroId: string) {
    const hero = this.world.heroes[heroId];
    if (!hero || hero.isBot) return;
    hero.autopilot = !hero.autopilot;
    if (hero.autopilot) this.bots.set(heroId, createBotMemory(this.world.seed ^ (Math.floor(this.world.time * 10) + 7919), this.world.startTime));
    else this.bots.delete(heroId);
  }

  /** Bots take 1–3s after each turn to pick the next one (less if their turn comes sooner), like a human reading the situation. */
  private botFight(id: string, mem: BotMemory) {
    const w = this.world;
    const enc = w.encounters[this.world.heroes[id].encounter!];
    const next = enc?.next[id];
    if (!enc || next === undefined || enc.choices[id] || !enc.heroes.includes(id)) return;
    const key = `${enc.room}:${next}`;
    if (mem.combatKey !== key) {
      mem.combatKey = key;
      mem.decideAt = Math.min(w.time + mem.rng.float(1, 3), next - 0.3);
    }
    if (w.time < mem.decideAt) return;
    const choice = chooseCombatAction(buildView(w, id), mem.rng);
    if (choice) applyIntent(w, id, { type: 'combat', choice });
  }

  intent(heroId: string, intent: Intent) {
    if (intent.type === 'autopilot') return this.toggleAutopilot(heroId);
    applyIntent(this.world, heroId, intent);
  }

  tick(dt: number) {
    const w = this.world;
    for (const [id, mem] of this.bots) {
      const hero = w.heroes[id];
      if (hero.dead || hero.extracted) continue;
      if (hero.downedAt !== null) {
        // Down with nobody standing here to get them up: cry out.
        if (!hero.called && !allyStandingWith(w, hero)) applyIntent(w, id, { type: 'call' });
        continue;
      }
      if (hero.encounter !== null) {
        this.botFight(id, mem);
        continue;
      }
      // Cheap pre-check: building a view is the expensive part, and bots only decide when idle in a room.
      if (hero.pos.kind !== 'room' || hero.path.length > 0 || hero.channel || hero.queuedEvent || hero.queuedItem || w.time < mem.thinkUntil) continue;
      const intent = botThink(buildView(w, id), mem);
      if (intent) applyIntent(w, id, intent);
      // Bots walk their plan a hop at a time; show allies where the whole plan leads.
      if (intent?.type === 'goto' && mem.route.length && hero.pos.kind === 'room' && hero.path.length) {
        hero.heading = mem.route[mem.route.length - 1];
      }
    }
    step(this.world, dt);
  }
}

/** Is a conscious ally in the same room as `hero`? */
function allyStandingWith(w: World, hero: Hero): boolean {
  const pos = hero.pos;
  return pos.kind === 'room' && Object.values(w.heroes).some((o) => o !== hero && isConscious(o) && o.pos.kind === 'room' && o.pos.room === pos.room);
}
