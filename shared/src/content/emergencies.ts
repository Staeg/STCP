import { ENEMIES, type EnemyId } from './enemies';
import { ITEMS, RESOURCE_IDS, type ItemId, type ResourceId } from './items';

/**
 * Wellbeing & Emergencies (M13, user 2026-10-10). Every player's Village has a Wellbeing from 1 to 5 (it starts at
 * 3); 0 loses the game and 6 wins it. Before each run the Village has an Emergency, picked from the two of its
 * Wellbeing level: doing it is +1 Wellbeing, failing it −1.
 *
 * - **Party-wide** Emergencies are about killing monsters or doing Events: anything anyone in the run does counts
 *   (other players, bots), even if your own hero dies.
 * - **Personal** Emergencies are about carrying things out: only your own hero counts, and only if they escape, or
 *   if an Undertaker carries it home for them.
 *
 * Rule for every Emergency that asks for something to be carried out (user): **what has to be carried out can't be
 * carried in.** Its `carry` items are refused in the kit (see `emergencyBans`).
 */
export type EmergencyId = 'larders' | 'lamps' | 'fever' | 'shadows' | 'patrol' | 'wells' | 'envoy' | 'tithe' | 'liches' | 'exodus';

export type EmergencyKind = 'party' | 'personal';

/** Carry out `n` of any of `items`. */
export interface CarryGoal {
  items: readonly ItemId[];
  n: number;
  label: string;
}

export interface EmergencyDef {
  id: EmergencyId;
  name: string;
  /** The Wellbeing level it belongs to. */
  wellbeing: number;
  kind: EmergencyKind;
  /** The goal, as the Village tells it. */
  desc: string;
  /** Party-wide goals. A kill target is guaranteed by Quarry: placed at the start and made a default unit. */
  kill?: { enemy: EnemyId; n: number };
  altars?: number;
  villagers?: number;
  /** Every player's hero must escape. */
  allEscape?: boolean;
  /** Personal goals: what your own hero has to carry out. */
  carry?: CarryGoal[];
  /** The kill target only exists from this rolled CR (user: Liches need CR 5). */
  minCr?: number;
  /** Personal seeding, per player who has it: Relics put in lairs, Gems lying about. */
  seed?: { relics?: number; gems?: number };
}

/** Consumables that heal (Fever Season). */
export const HEALING_CONSUMABLES: readonly ItemId[] = ['bandage', 'salts'];

export const EMERGENCIES: Record<EmergencyId, EmergencyDef> = {
  larders: {
    id: 'larders', name: 'Empty Larders', wellbeing: 1, kind: 'personal',
    desc: 'The stores are bare. Bring home 3 Resources of any kind.',
    carry: [{ items: RESOURCE_IDS, n: 3, label: 'Resources' }],
  },
  lamps: {
    id: 'lamps', name: 'The Lamps Gutter', wellbeing: 1, kind: 'party',
    desc: 'The Village lamps burn low and black. Cleanse an Altar.',
    altars: 1,
  },
  fever: {
    id: 'fever', name: 'Fever Season', wellbeing: 2, kind: 'personal',
    desc: 'Fever is in the houses. Bring home 2 healing consumables (Bandages or Smelling Salts). You can’t take any in.',
    carry: [{ items: HEALING_CONSUMABLES, n: 2, label: 'healing consumables' }],
  },
  shadows: {
    id: 'shadows', name: 'Shadows at the Gate', wellbeing: 2, kind: 'party',
    desc: 'Lantern Wights prowl the Village edge. Kill 3 of them.',
    kill: { enemy: 'wight', n: 3 },
  },
  patrol: {
    id: 'patrol', name: 'The Missing Patrol', wellbeing: 3, kind: 'party',
    desc: 'A patrol went down and didn’t come back. Save 3 villagers.',
    villagers: 3,
  },
  wells: {
    id: 'wells', name: 'Tainted Wells', wellbeing: 3, kind: 'party',
    desc: 'The wells run foul. Cleanse 2 Altars.',
    altars: 2,
  },
  envoy: {
    id: 'envoy', name: 'The Queen’s Envoy', wellbeing: 4, kind: 'party',
    desc: 'A Forsaken Queen has claimed the Village. Kill her.',
    kill: { enemy: 'queen', n: 1 },
  },
  tithe: {
    id: 'tithe', name: 'Tithe to the Shrine', wellbeing: 4, kind: 'personal',
    desc: 'The Shrine demands its due. Bring home a Relic and 2 Gems: they’re down there, somewhere.',
    carry: [{ items: ['relic'], n: 1, label: 'Relic' }, { items: ['gem'], n: 2, label: 'Gems' }],
    seed: { relics: 1, gems: 2 },
  },
  liches: {
    id: 'liches', name: 'Night of the Liches', wellbeing: 5, kind: 'party',
    desc: 'Two Liches rise beneath the Village. Kill them both. They only come at CR 5.',
    kill: { enemy: 'lich', n: 2 }, minCr: 5,
  },
  exodus: {
    id: 'exodus', name: 'Exodus', wellbeing: 5, kind: 'party',
    desc: 'Lead the lost home: save 4 villagers, and every player’s hero escapes.',
    villagers: 4, allEscape: true,
  },
};

export const EMERGENCY_IDS = Object.keys(EMERGENCIES) as EmergencyId[];

export const WELLBEING = { start: 3, min: 1, max: 5, lose: 0, win: 6 };

/** The Emergencies offered at a Wellbeing level. */
export function emergenciesAt(wellbeing: number): EmergencyId[] {
  return EMERGENCY_IDS.filter((id) => EMERGENCIES[id].wellbeing === wellbeing);
}

/** What this Emergency forbids in the kit: whatever it asks to be carried out can't be carried in. */
export function emergencyBans(id: EmergencyId | null | undefined): ItemId[] {
  return id ? [...new Set((EMERGENCIES[id].carry ?? []).flatMap((c) => c.items))] : [];
}

export const KIND_NAMES: Record<EmergencyKind, string> = { party: 'Party-wide', personal: 'Personal' };

/**
 * Why this Emergency is impossible (or may be) with this setup, or null. `cr` is the combined CR so far (a fraction
 * is the chance of the next CR up), or undefined outside a lobby.
 */
export function emergencyWarning(id: EmergencyId, ctx: { cr?: number; rites?: readonly ResourceId[] }): string | null {
  const def = EMERGENCIES[id];
  if (ctx.rites?.includes('gem') && def.carry?.some((c) => c.items.some((it) => ITEMS[it].kind === 'consumable'))) {
    return 'Impossible: your Gem Rite forbids consumables.';
  }
  if (def.minCr !== undefined && def.kill) {
    const name = def.kill.enemy === 'lich' ? 'Liches' : `${ENEMIES[def.kill.enemy].name}s`;
    if (ctx.cr === undefined) return `Needs CR ${def.minCr} for the ${name} to come: the lobby shows your party’s.`;
    const base = Math.floor(ctx.cr);
    const frac = Math.round((ctx.cr - base) * 100);
    if (base >= def.minCr) return null;
    if (base + 1 >= def.minCr && frac > 0) return `Only a ${frac}% chance the ${name} come: needs CR ${def.minCr}, the party has ${ctx.cr}.`;
    return `Impossible: the ${name} need CR ${def.minCr}, the party has ${ctx.cr}.`;
  }
  return null;
}
