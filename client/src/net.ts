import type { ClientMsg, Intent, LeaderboardEntry, LobbyView, PlayerView, ServerMsg } from '@stcp/shared';
import { LocalSocket, SOLO } from './local';

/** Per-tab secret: survives refresh (sessionStorage) but differs between tabs, so one browser can host several test players. */
function getToken(): string {
  let token = sessionStorage.getItem('stcp-token');
  if (!token) {
    token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem('stcp-token', token);
  }
  return token;
}

export class Net {
  status: 'connecting' | 'open' | 'closed' = 'connecting';
  ping = 0;
  /** Set after the server answers hello; null = not in a lobby. undefined = not yet known. */
  lobby: LobbyView | null | undefined = undefined;
  prev: PlayerView | null = null;
  cur: PlayerView | null = null;
  curAt = 0;
  name = localStorage.getItem('stcp-name') ?? '';
  onError: (msg: string) => void = () => {};
  onLobby: (lobby: LobbyView | null) => void = () => {};
  /** The Hall of Fortune (top players by total gold extracted). */
  leaderboard: LeaderboardEntry[] = [];
  /** Called on every snapshot. Used by dev playtest scripts: unlike timers, these aren't throttled in background tabs. */
  viewHooks: ((view: PlayerView) => void)[] = [];

  private ws!: WebSocket;
  private pingId = 0;
  private pingSent = new Map<number, number>();
  private readonly token = getToken();

  constructor() {
    this.connect();
    setInterval(() => this.sendPing(), 2000);
  }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.status = 'connecting';
    this.ws = SOLO ? (new LocalSocket() as unknown as WebSocket) : new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => {
      this.status = 'open';
      this.send({ t: 'hello', token: this.token, name: this.name });
      this.sendPing();
    };
    this.ws.onclose = () => {
      this.status = 'closed';
      setTimeout(() => this.connect(), 1000);
    };
    this.ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data) as ServerMsg);
  }

  private onMessage(msg: ServerMsg) {
    switch (msg.t) {
      case 'pong': {
        const sent = this.pingSent.get(msg.id);
        if (sent !== undefined) this.ping = Math.round(performance.now() - sent);
        this.pingSent.delete(msg.id);
        break;
      }
      case 'lobby':
        if (msg.lobby?.state !== 'game') this.prev = this.cur = null;
        this.lobby = msg.lobby;
        this.onLobby(msg.lobby);
        break;
      case 'error':
        this.onError(msg.msg);
        break;
      case 'leaderboard':
        this.leaderboard = msg.entries;
        break;
      case 'view':
        this.prev = this.cur;
        this.cur = msg.view;
        this.curAt = performance.now();
        for (const hook of this.viewHooks) hook(msg.view);
        break;
    }
  }

  send(msg: ClientMsg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  setName(name: string) {
    this.name = name;
    localStorage.setItem('stcp-name', name);
    this.send({ t: 'setName', name });
  }

  private sendPing() {
    const id = ++this.pingId;
    this.pingSent.set(id, performance.now());
    this.send({ t: 'ping', id });
  }

  intent(intent: Intent) {
    this.send({ t: 'intent', intent });
  }
}
