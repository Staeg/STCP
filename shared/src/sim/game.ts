import { botThink, createBotMemory, type BotMemory } from '../bots/explorer';
import type { ClassId } from '../content/classes';
import { buildView } from './views';
import { addHero, applyIntent, createWorld, step, type Intent, type World } from './world';

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

  constructor(seed: number, slots: PlayerSlot[]) {
    this.world = createWorld(seed);
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

  intent(heroId: string, intent: Intent) {
    applyIntent(this.world, heroId, intent);
  }

  tick(dt: number) {
    for (const [id, mem] of this.bots) {
      // Cheap pre-check: building a view is the expensive part, and bots only decide when idle in a room.
      const hero = this.world.heroes[id];
      if (hero.pos.kind !== 'room' || hero.path.length > 0 || this.world.time < mem.thinkUntil) continue;
      const intent = botThink(buildView(this.world, id), mem);
      if (intent) applyIntent(this.world, id, intent);
    }
    step(this.world, dt);
  }
}
