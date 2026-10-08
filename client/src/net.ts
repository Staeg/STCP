import type { ClientMsg, Intent, PlayerView, ServerMsg } from '@stcp/shared';

/** Holds the two latest snapshots so the renderer can interpolate between them. */
export class Net {
  status: 'connecting' | 'open' | 'closed' = 'connecting';
  ping = 0;
  heroId: string | null = null;
  prev: PlayerView | null = null;
  cur: PlayerView | null = null;
  curAt = 0;

  private ws!: WebSocket;
  private pingId = 0;
  private pingSent = new Map<number, number>();

  constructor() {
    this.connect();
    setInterval(() => this.sendPing(), 2000);
  }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.status = 'connecting';
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => {
      this.status = 'open';
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
      case 'welcome':
        this.heroId = msg.heroId;
        this.prev = this.cur = null;
        break;
      case 'view':
        this.prev = this.cur;
        this.cur = msg.view;
        this.curAt = performance.now();
        break;
    }
  }

  private send(msg: ClientMsg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
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
