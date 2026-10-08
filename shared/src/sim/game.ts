import { botThink, createBotMemory, type BotMemory } from '../bots/explorer';
import { chooseCombatAction } from '../bots/fighter';
import type { ClassId } from '../content/classes';
import { buildView } from './views';
import { addHero, applyIntent, createWorld, step, type Intent, type World, type WorldOptions } from './world';

export interface PlayerSlot {
  id: string;
  name: string;
  cls: ClassId;
  isBot: boolean;
}

/** A running expedition: the world plus the bots that inhabit it. Shared by the server and the headless sim. */
export class Game {
  readonly world: World;
  readonly bots = new Map<string, BotMemory>();

  constructor(seed: number, slots: PlayerSlot[], opts: WorldOptions = {}) {
    this.world = createWorld(seed, opts);
    slots.forEach((slot, i) => {
      addHero(this.world, slot);
      if (slot.isBot) this.bots.set(slot.id, createBotMemory((seed ^ 0x9e3779b9) + i * 7919));
    });
  }

  /** Hand a hero over to a bot (e.g. a player left mid-run). */
  makeBot(heroId: string) {
    const hero = this.world.heroes[heroId];
    if (!hero || this.bots.has(heroId)) return;
    hero.isBot = true;
    this.bots.set(heroId, createBotMemory(this.world.seed + this.bots.size * 104729));
  }

  /** Bots take 1–3s to pick, like a human reading the situation. */
  private botFight(id: string, mem: BotMemory) {
    const w = this.world;
    const enc = w.encounters[this.world.heroes[id].encounter!];
    if (!enc || enc.phase !== 'choosing' || enc.choices[id] || !enc.heroes.includes(id)) return;
    const key = `${enc.room}:${enc.round}`;
    if (mem.combatKey !== key) {
      mem.combatKey = key;
      mem.decideAt = w.time + mem.rng.float(1, 3);
    }
    if (w.time < mem.decideAt) return;
    const choice = chooseCombatAction(buildView(w, id), mem.rng);
    if (choice) applyIntent(w, id, { type: 'combat', choice });
  }

  intent(heroId: string, intent: Intent) {
    applyIntent(this.world, heroId, intent);
  }

  tick(dt: number) {
    const w = this.world;
    for (const [id, mem] of this.bots) {
      const hero = w.heroes[id];
      if (hero.dead || hero.downedAt !== null) continue;
      if (hero.encounter !== null) {
        this.botFight(id, mem);
        continue;
      }
      // Cheap pre-check: building a view is the expensive part, and bots only decide when idle in a room.
      if (hero.pos.kind !== 'room' || hero.path.length > 0 || hero.channel || w.time < mem.thinkUntil) continue;
      const intent = botThink(buildView(w, id), mem);
      if (intent) applyIntent(w, id, intent);
    }
    step(this.world, dt);
  }
}
