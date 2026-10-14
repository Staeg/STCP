import { CLASS_IDS, type ClassId } from './content/classes';
import { ENEMIES, type EnemyId } from './content/enemies';
import { ITEMS, type ItemId } from './content/items';
import { EVENTS, type EventKind } from './content/events';
import type { CombatAction } from './sim/combat';
import type { LeaderboardEntry } from './content/titles';
import type { PlayerView } from './sim/views';
import type { Intent } from './sim/world';
import { FIELD_SKILLS, type FieldSkill } from './sim/skills';
import { isCardId, type CardId } from './content/cards';
import { TALENTS, type TalentId } from './content/talents';
import { SPECS, type SpecId } from './content/regalia';
import type { FateChoice, ServiceRequest, VillageView } from './stash';
import { EMERGENCIES, type EmergencyId } from './content/emergencies';
import { BUILDINGS, emptyKit, SERVICES, type BuildingId, type Character, type Kit, type ServiceId } from './village';
import { GEAR_SLOTS, RESOURCE_IDS, type GearSlot, type ResourceId } from './content/items';

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
  character: (Pick<Character, 'name' | 'talent' | 'xp' | 'injuries' | 'blessed'> & { spec: SpecId | null }) | null;
  /** What they're bringing from their Village Stash. */
  kit: Kit;
  /** Their Village's Emergency for this run (M13), if picked. */
  emergency: EmergencyId | null;
}

export interface LobbyView {
  code: string;
  youId: string;
  hostId: string;
  state: LobbyState;
  members: LobbyMemberView[];
  /** The bots filling the empty slots (none until every player has picked a class). */
  bots: { name: string; cls: ClassId; owner: string; character: LobbyMemberView['character'] }[];
  maxPlayers: number;
  /** Combined CR so far: the players' Talents, Gear and Rites and the bots' borrowed Talents (a fraction is rolled at the start). */
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
  /** The Village (keyed by your name): ask for it, pick an earned Talent. */
  | { t: 'village' }
  | { t: 'chooseTalent'; charId: string; talent: TalentId }
  /** Give a Character a Specialization (once the Village's Shards unlock it). */
  | { t: 'chooseSpec'; charId: string; spec: SpecId }
  /** Build a building's next level, or tear its top level down. */
  | { t: 'build'; building: BuildingId }
  | { t: 'demolish'; building: BuildingId }
  /** Use a building's service (once between runs). */
  | { t: 'service'; req: ServiceRequest }
  /** Choose the Gear, consumables and Rites to take from your Village Stash into the next run. */
  | { t: 'setKit'; kit: Kit }
  /** Pick the Village's Emergency for the next run (one of the two of its Wellbeing). */
  | { t: 'chooseEmergency'; id: EmergencyId }
  /** After the Village's game is won or lost: Wellbeing back to 3, or start over altogether. */
  | { t: 'chooseFate'; choice: FateChoice }
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

const COMBAT_ACTIONS: CombatAction[] = ['card', 'flee', 'revive', 'brace', 'item'];

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
    case 'chooseSpec':
      return str(msg.charId, 16) && typeof msg.spec === 'string' && msg.spec in SPECS
        ? { t: 'chooseSpec', charId: msg.charId as string, spec: msg.spec as SpecId }
        : null;
    case 'build':
    case 'demolish':
      return typeof msg.building === 'string' && msg.building in BUILDINGS ? { t: msg.t, building: msg.building as BuildingId } : null;
    case 'service': {
      const r = msg.req as Record<string, unknown> | undefined;
      if (!r || typeof r !== 'object' || typeof r.service !== 'string' || !(r.service in SERVICES)) return null;
      if (r.charId !== undefined && !str(r.charId, 16)) return null;
      if (r.injury !== undefined && r.injury !== 'minor' && r.injury !== 'major') return null;
      if (r.item !== undefined && !(typeof r.item === 'string' && r.item in ITEMS)) return null;
      if (r.pick !== undefined && !str(r.pick, 32)) return null;
      return {
        t: 'service',
        req: {
          service: r.service as ServiceId,
          ...(r.charId !== undefined ? { charId: r.charId as string } : {}),
          ...(r.injury !== undefined ? { injury: r.injury as 'minor' | 'major' } : {}),
          ...(r.item !== undefined ? { item: r.item as ItemId } : {}),
          ...(r.pick !== undefined ? { pick: r.pick as string } : {}),
        },
      };
    }
    case 'chooseEmergency':
      return typeof msg.id === 'string' && msg.id in EMERGENCIES ? { t: 'chooseEmergency', id: msg.id as EmergencyId } : null;
    case 'chooseFate':
      return msg.choice === 'reset' || msg.choice === 'restart' ? { t: 'chooseFate', choice: msg.choice } : null;
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
      if (k.bare !== undefined) {
        if (!Array.isArray(k.bare) || !k.bare.every((x) => GEAR_SLOTS.includes(x as never))) return null;
        kit.bare = [...new Set(k.bare as GearSlot[])];
      }
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
      if (i.type === 'turnBack' || i.type === 'stop' || i.type === 'extract' || i.type === 'autopilot' || i.type === 'pause' || i.type === 'call' || i.type === 'revealMap' || i.type === 'killBots') return { t: 'intent', intent: { type: i.type } };
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
            ...(Number.isInteger(i.room) ? { room: i.room as number } : {}),
          },
        };
      }
      if (i.type === 'event' && str(i.choice, 16)) return { t: 'intent', intent: { type: 'event', choice: i.choice as string } };
      if (i.type === 'vote' && id(i.item) && str(i.choice, 32)) return { t: 'intent', intent: { type: 'vote', item: i.item as number, choice: i.choice as string } };
      if (i.type === 'claim' && id(i.item)) return { t: 'intent', intent: { type: 'claim', item: i.item as number } };
      if (i.type === 'drop' && slot(i.index)) return { t: 'intent', intent: { type: 'drop', index: i.index as number } };
      if (i.type === 'dropGold' && typeof i.amount === 'number' && i.amount > 0 && i.amount <= 1000) return { t: 'intent', intent: { type: 'dropGold', amount: i.amount } };
      if (i.type === 'unequip' && (i.slot === 'weapon' || i.slot === 'armor' || i.slot === 'amulet' || i.slot === 'ring')) return { t: 'intent', intent: { type: 'unequip', slot: i.slot } };
      if (i.type === 'toggleAuto' && (i.slot === 'weapon' || i.slot === 'armor' || i.slot === 'amulet' || i.slot === 'ring')) return { t: 'intent', intent: { type: 'toggleAuto', slot: i.slot } };
      if (i.type === 'useItem' && slot(i.index) && (i.target === undefined || str(i.target, 32))) {
        return { t: 'intent', intent: { type: 'useItem', index: i.index as number, target: i.target as string | undefined } };
      }
      if (i.type === 'stepTo' && (i.to === 'front' || i.to === 'back')) return { t: 'intent', intent: { type: 'stepTo', to: i.to } };
      if (i.type === 'combat' && i.choice && typeof i.choice === 'object') {
        const c = i.choice as Record<string, unknown>;
        if (!COMBAT_ACTIONS.includes(c.action as CombatAction)) return null;
        if (c.target !== undefined && !str(c.target, 32)) return null;
        if (c.item !== undefined && !slot(c.item)) return null;
        if (c.card !== undefined && !isCardId(c.card)) return null;
        if (c.room !== undefined && !Number.isInteger(c.room)) return null;
        return {
          t: 'intent',
          intent: {
            type: 'combat',
            choice: {
              action: c.action as CombatAction, target: c.target as string | undefined, item: c.item as number | undefined,
              ...(c.card !== undefined ? { card: c.card as CardId } : {}), ...(c.room !== undefined ? { room: c.room as number } : {}),
            },
          },
        };
      }
      return null;
    }
  }
  return null;
}
