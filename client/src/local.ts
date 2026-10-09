import { LobbyManager, parseClientMsg, send, SERVER_TICK, Stash, type ServerMsg, type Socket } from '@stcp/shared';

/**
 * Solo play: no server, the lobby and game run in this page and bots fill the other three slots.
 * On for the static (GitHub Pages) build, or with ?solo on any build.
 */
export const SOLO = import.meta.env.VITE_SOLO === '1' || new URLSearchParams(location.search).has('solo');

const STASH_KEY = 'stcp-stash';

let manager: LobbyManager | null = null;

function getManager(): LobbyManager {
  if (manager) return manager;
  const stash = new Stash({
    load: () => {
      try {
        return localStorage.getItem(STASH_KEY);
      } catch {
        return null;
      }
    },
    save: (json) => {
      try {
        localStorage.setItem(STASH_KEY, json);
      } catch {
        // Storage blocked: career stats just don't persist.
      }
    },
  });
  const mgr = new LobbyManager(stash);
  setInterval(() => mgr.tick(), SERVER_TICK * 1000);
  return (manager = mgr);
}

/** Stands in for the browser WebSocket that Net opens, and plays the server's half of server/src/index.ts. */
export class LocalSocket {
  readonly readyState = WebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;

  private token: string | null = null;
  private name = '';
  /** The server's end of the connection. */
  private peer: Socket = {
    OPEN: 1,
    readyState: 1,
    send: (data) => queueMicrotask(() => this.onmessage?.({ data })),
    close: () => {},
  };

  constructor() {
    setTimeout(() => this.onopen?.(), 0);
  }

  send(data: string) {
    const msg = parseClientMsg(data);
    if (!msg) return;
    const reply = (m: ServerMsg) => send(this.peer, m);
    if (msg.t === 'ping') return reply({ t: 'pong', id: msg.id });
    if (msg.t === 'hello') {
      this.token = msg.token;
      this.name = msg.name;
    }
    if (msg.t === 'setName' && msg.name) this.name = msg.name;
    if (!this.token) return reply({ t: 'error', msg: 'Say hello first.' });
    getManager().handle(this.peer, this.token, this.name, msg);
  }
}
