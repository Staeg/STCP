import { CLASS_IDS, type ClassId } from './content/classes';
import { ENEMIES, type EnemyId } from './content/enemies';
import { ITEMS, type ItemId } from './content/items';
import { EVENTS, type EventKind } from './content/events';
import type { CombatAction } from './sim/combat';
import type { LeaderboardEntry } from './content/titles';
import type { PlayerView } from './sim/views';
import type { Intent } from './sim/world';
import { FIELD_SKILLS, type FieldSkill } from './sim/skills';
import { TALENTS, type TalentId } from './content/talents';
import type { VillageView, Treatment } from './stash';
import { emptyKit, type Character, type Kit } from './village';
import { GEAR_SLOTS, RESOURCE_IDS, type ResourceId } from './content/items';

export type LobbyState = 'lobby' | 'game';

export interface LobbyMemberView {
  id: string;
  name: string;
  cls: ClassId | null;
  ready: boolean;
  connected: boolean;
  /** Total gold extracted across all runs (bragging rights). */
  stash: number;
  title: string;
  /** The Village Character they bring (for the class they picked). */
  character: Pick<Character, 'name' | 'talent' | 'xp' | 'injuries' | 'affliction'> | null;
  /** What they're bringing from their Village Stash. */
  kit: Kit;
}

export interface LobbyView {
  code: string;
  youId: string;
  hostId: string;
  state: LobbyState;
  members: LobbyMemberView[];
  maxPlayers: number;
  /** Combined CR so far: the players' Talents, Gear and Rites (bots may add to it; a fraction is rolled at the start). */
  cr: number;
  /** Someone is bringing a Relic Rite: the run starts at Escalation 5. */
  relic: boolean;
}

export type ClientMsg =
  | { t: 'ping'; id: number }
  /** First message on every connection. `token` is a per-tab secret used to resume. */
  | { t: 'hello'; token: string; name: string }
  | { t: 'create' }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'setName'; name: string }
  | { t: 'pickClass'; cls: ClassId | null }
  | { t: 'ready'; ready: boolean }
  | { t: 'start' }
  | { t: 'toLobby' }
  | { t: 'intent'; intent: Intent }
  /** The Village (keyed by your name): ask for it, pick an earned Talent, or pay to treat a Character. */
  | { t: 'village' }
  | { t: 'chooseTalent'; charId: string; talent: TalentId }
  | { t: 'treat'; charId: string; what: Treatment }
  /** Choose the Gear, consumables and Rites to take from your Village Stash into the next run. */
  | { t: 'setKit'; kit: Kit }
  /** Dev-only (server started with --debug): fast-forward the game clock. */
  | { t: 'debugSkip'; seconds: number }
  /** Dev-only: spawn monsters in your room (starts a fight) and fully heal you. */
  | { t: 'debugSpawn'; enemies: EnemyId[] }
  /** Dev-only: drop items and gold in your room. */
  | { t: 'debugLoot'; items: ItemId[]; gold: number }
  /** Dev-only: run this lobby N× faster (for automated playtests). */
  | { t: 'debugSpeed'; speed: number }
  /** Dev-only: put an event (or a captive) in your room. */
  | { t: 'debugEvent'; kind: EventKind };

export type ServerMsg =
  | { t: 'pong'; id: number }
  | { t: 'lobby'; lobby: LobbyView | null }
  | { t: 'error'; msg: string }
  | { t: 'view'; view: PlayerView }
  /** The Hall of Fortune: top players by total gold extracted. */
  | { t: 'leaderboard'; entries: LeaderboardEntry[] }
  /** Your Village: purse, Characters, and what the last run did to them. */
  | { t: 'village'; village: VillageView };

const COMBAT_ACTIONS: CombatAction[] = ['a0', 'a1', 'a2', 'flee', 'revive', 'brace', 'item'];

export const MAX_PLAYERS = 4;
export const NAME_MAX = 16;

export function cleanName(name: string): string {
  return name.replace(/[^\p{L}\p{N} _'-]/gu, '').trim().slice(0, NAME_MAX);
}

/** Validate untrusted client input. Returns null if malformed. */
export function parseClientMsg(raw: string): ClientMsg | null {
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  const msg = m as Record<string, unknown>;
  const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
  const slot = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 16;
  /** A floor item id. */
  const id = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
  switch (msg.t) {
    case 'ping':
      return typeof msg.id === 'number' ? { t: 'ping', id: msg.id } : null;
    case 'hello':
      return str(msg.token, 64) && /^[A-Za-z0-9]{8,64}$/.test(msg.token as string) && str(msg.name, 64)
        ? { t: 'hello', token: msg.token as string, name: cleanName(msg.name as string) }
        : null;
    case 'join':
      return str(msg.code, 8) ? { t: 'join', code: (msg.code as string).toUpperCase() } : null;
    case 'setName':
      return str(msg.name, 64) ? { t: 'setName', name: cleanName(msg.name as string) } : null;
    case 'pickClass':
      return msg.cls === null || CLASS_IDS.includes(msg.cls as ClassId) ? { t: 'pickClass', cls: msg.cls as ClassId | null } : null;
    case 'ready':
      return typeof msg.ready === 'boolean' ? { t: 'ready', ready: msg.ready } : null;
    case 'create':
    case 'leave':
    case 'start':
    case 'toLobby':
    case 'village':
      return { t: msg.t };
    case 'chooseTalent':
      return str(msg.charId, 16) && typeof msg.talent === 'string' && msg.talent in TALENTS
        ? { t: 'chooseTalent', charId: msg.charId as string, talent: msg.talent as TalentId }
        : null;
    case 'treat':
      return str(msg.charId, 16) && (msg.what === 'minor' || msg.what === 'major' || msg.what === 'affliction')
        ? { t: 'treat', charId: msg.charId as string, what: msg.what }
        : null;
    case 'setKit': {
      const k = msg.kit as Record<string, unknown> | undefined;
      if (!k || typeof k !== 'object' || !k.gear || typeof k.gear !== 'object' || !Array.isArray(k.consumables) || !Array.isArray(k.rites)) return null;
      const kit = emptyKit();
      for (const [slot, it] of Object.entries(k.gear as Record<string, unknown>)) {
        if (!GEAR_SLOTS.includes(slot as never) || !(typeof it === 'string' && it in ITEMS)) return null;
        kit.gear[slot as keyof Kit['gear']] = it as ItemId;
      }
      if (k.consumables.length > 4 || !k.consumables.every((x) => typeof x === 'string' && x in ITEMS)) return null;
      if (k.rites.length > 4 || !k.rites.every((x) => RESOURCE_IDS.includes(x as ResourceId))) return null;
      kit.consumables = k.consumables as ItemId[];
      kit.rites = k.rites as ResourceId[];
      return { t: 'setKit', kit };
    }
    case 'debugSkip':
      return typeof msg.seconds === 'number' && msg.seconds > 0 && msg.seconds <= 900 ? { t: 'debugSkip', seconds: msg.seconds } : null;
    case 'debugSpeed':
      return typeof msg.speed === 'number' && msg.speed >= 1 && msg.speed <= 50 ? { t: 'debugSpeed', speed: msg.speed } : null;
    case 'debugEvent':
      return typeof msg.kind === 'string' && msg.kind in EVENTS ? { t: 'debugEvent', kind: msg.kind as EventKind } : null;
    case 'debugLoot':
      return Array.isArray(msg.items) && msg.items.length <= 8 && msg.items.every((e) => e in ITEMS) && Number.isInteger(msg.gold)
        ? { t: 'debugLoot', items: msg.items as ItemId[], gold: msg.gold as number }
        : null;
    case 'debugSpawn':
      return Array.isArray(msg.enemies) && msg.enemies.length <= 4 && msg.enemies.every((e) => e in ENEMIES)
        ? { t: 'debugSpawn', enemies: msg.enemies as EnemyId[] }
        : null;
    case 'intent': {
      const i = msg.intent as Record<string, unknown> | undefined;
      if (!i || typeof i !== 'object') return null;
      if (i.type === 'goto' && Number.isInteger(i.room)) {
        return { t: 'intent', intent: { type: 'goto', room: i.room as number, ...(i.step === true ? { step: true } : {}) } };
      }
      if (i.type === 'turnBack' || i.type === 'stop' || i.type === 'extract' || i.type === 'autopilot' || i.type === 'call') return { t: 'intent', intent: { type: i.type } };
      if (i.type === 'ready') return { t: 'intent', intent: typeof i.on === 'boolean' ? { type: 'ready', on: i.on } : { type: 'ready' } };
      if (i.type === 'revive' && str(i.target, 32)) return { t: 'intent', intent: { type: 'revive', target: i.target as string } };
      if (i.type === 'skill') {
        if (i.skill !== undefined && !(typeof i.skill === 'string' && i.skill in FIELD_SKILLS)) return null;
        return {
          t: 'intent',
          intent: {
            type: 'skill',
            ...(i.skill !== undefined ? { skill: i.skill as FieldSkill } : {}),
            ...(str(i.target, 32) ? { target: i.target as string } : {}),
          },
        };
      }
      if (i.type === 'event' && str(i.choice, 16)) return { t: 'intent', intent: { type: 'event', choice: i.choice as string } };
      if (i.type === 'vote' && id(i.item) && str(i.choice, 32)) return { t: 'intent', intent: { type: 'vote', item: i.item as number, choice: i.choice as string } };
      if (i.type === 'claim' && id(i.item)) return { t: 'intent', intent: { type: 'claim', item: i.item as number } };
      if (i.type === 'drop' && slot(i.index)) return { t: 'intent', intent: { type: 'drop', index: i.index as number } };
      if (i.type === 'unequip' && (i.slot === 'weapon' || i.slot === 'armor' || i.slot === 'amulet' || i.slot === 'ring')) return { t: 'intent', intent: { type: 'unequip', slot: i.slot } };
      if (i.type === 'useItem' && slot(i.index) && (i.target === undefined || str(i.target, 32))) {
        return { t: 'intent', intent: { type: 'useItem', index: i.index as number, target: i.target as string | undefined } };
      }
      if (i.type === 'combat' && i.choice && typeof i.choice === 'object') {
        const c = i.choice as Record<string, unknown>;
        if (!COMBAT_ACTIONS.includes(c.action as CombatAction)) return null;
        if (c.target !== undefined && !str(c.target, 32)) return null;
        if (c.item !== undefined && !slot(c.item)) return null;
        return {
          t: 'intent',
          intent: { type: 'combat', choice: { action: c.action as CombatAction, target: c.target as string | undefined, item: c.item as number | undefined } },
        };
      }
      return null;
    }
  }
  return null;
}
