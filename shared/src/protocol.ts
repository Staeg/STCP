import { CLASS_IDS, type ClassId } from './content/classes';
import type { PlayerView } from './sim/views';
import type { Intent } from './sim/world';

export type LobbyState = 'lobby' | 'game';

export interface LobbyMemberView {
  id: string;
  name: string;
  cls: ClassId | null;
  ready: boolean;
  connected: boolean;
}

export interface LobbyView {
  code: string;
  youId: string;
  hostId: string;
  state: LobbyState;
  members: LobbyMemberView[];
  maxPlayers: number;
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
  /** Dev-only (server started with --debug): fast-forward the game clock. */
  | { t: 'debugSkip'; seconds: number };

export type ServerMsg =
  | { t: 'pong'; id: number }
  | { t: 'lobby'; lobby: LobbyView | null }
  | { t: 'error'; msg: string }
  | { t: 'view'; view: PlayerView };

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
      return { t: msg.t };
    case 'debugSkip':
      return typeof msg.seconds === 'number' && msg.seconds > 0 && msg.seconds <= 900 ? { t: 'debugSkip', seconds: msg.seconds } : null;
    case 'intent': {
      const i = msg.intent as Record<string, unknown> | undefined;
      if (!i || typeof i !== 'object') return null;
      if (i.type === 'goto' && Number.isInteger(i.room)) return { t: 'intent', intent: { type: 'goto', room: i.room as number } };
      if (i.type === 'turnBack' || i.type === 'stop') return { t: 'intent', intent: { type: i.type } };
      return null;
    }
  }
  return null;
}
