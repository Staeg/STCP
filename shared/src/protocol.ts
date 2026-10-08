import type { Intent } from './sim/world';
import type { PlayerView } from './sim/views';

export type ClientMsg =
  | { t: 'ping'; id: number }
  | { t: 'intent'; intent: Intent };

export type ServerMsg =
  | { t: 'pong'; id: number }
  | { t: 'welcome'; heroId: string }
  | { t: 'view'; view: PlayerView };

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
  if (msg.t === 'ping' && typeof msg.id === 'number') return { t: 'ping', id: msg.id };
  if (msg.t === 'intent' && msg.intent && typeof msg.intent === 'object') {
    const i = msg.intent as Record<string, unknown>;
    if (i.type === 'goto' && Number.isInteger(i.room)) return { t: 'intent', intent: { type: 'goto', room: i.room as number } };
    if (i.type === 'turnBack' || i.type === 'stop') return { t: 'intent', intent: { type: i.type } };
  }
  return null;
}
