import { describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import type { ClientMsg, LobbyView, ServerMsg } from '@stcp/shared';
import { LobbyManager } from './lobby';

class FakeWs {
  readonly OPEN = 1;
  readyState = 1;
  sent: ServerMsg[] = [];
  closed = false;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  lastLobby(): LobbyView | null | undefined {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      const m = this.sent[i];
      if (m.t === 'lobby') return m.lobby;
    }
    return undefined;
  }
  errors() {
    return this.sent.filter((m) => m.t === 'error').map((m) => (m as { msg: string }).msg);
  }
}

function client(mgr: LobbyManager, token: string, name: string) {
  const ws = new FakeWs();
  const sock = ws as unknown as WebSocket;
  const say = (msg: ClientMsg) => mgr.handle(sock, token, name, msg);
  say({ t: 'hello', token, name });
  return { ws, sock, say };
}

describe('LobbyManager', () => {
  it('runs the full create → join → pick → ready → start flow and fills bots', () => {
    const mgr = new LobbyManager();
    const a = client(mgr, 'tokenAAAA', 'Ann');
    expect(a.ws.lastLobby()).toBeNull();
    a.say({ t: 'create' });
    const code = a.ws.lastLobby()!.code;
    expect(code).toMatch(/^[A-Z]{4}$/);

    const b = client(mgr, 'tokenBBBB', 'Bob');
    b.say({ t: 'join', code });
    expect(b.ws.lastLobby()!.members.map((m) => m.name)).toEqual(['Ann', 'Bob']);

    a.say({ t: 'pickClass', cls: 'warden' });
    b.say({ t: 'pickClass', cls: 'warden' });
    expect(b.ws.errors()).toContain('Someone already picked that class.');
    b.say({ t: 'pickClass', cls: 'hexer' });

    a.say({ t: 'ready', ready: true });
    b.say({ t: 'start' });
    expect(b.ws.errors()).toContain('Only the host can start.');
    a.say({ t: 'start' });
    expect(a.ws.errors()).toContain('Everyone must pick a class and ready up.');

    b.say({ t: 'ready', ready: true });
    a.say({ t: 'start' });
    expect(a.ws.lastLobby()!.state).toBe('game');

    mgr.tick();
    const view = a.ws.sent.find((m) => m.t === 'view');
    expect(view).toBeDefined();
    if (view?.t !== 'view') throw new Error();
    // 3 others: Bob + 2 bots, all visible at the entrance; classes unique.
    expect(view.view.allies).toHaveLength(3);
    const classes = [view.view.you.cls, ...view.view.allies.map((x) => x.cls)];
    expect(new Set(classes).size).toBe(4);
    expect(view.view.allies.filter((x) => x.isBot)).toHaveLength(2);
  });

  it('never leaks tokens to other players', () => {
    const mgr = new LobbyManager();
    const a = client(mgr, 'secretAAAA', 'Ann');
    a.say({ t: 'create' });
    const b = client(mgr, 'secretBBBB', 'Bob');
    b.say({ t: 'join', code: a.ws.lastLobby()!.code });
    expect(JSON.stringify(b.ws.sent)).not.toContain('secretAAAA');
  });

  it('resumes the same hero on reconnect with the same token', () => {
    const mgr = new LobbyManager();
    const a = client(mgr, 'tokenAAAA', 'Ann');
    a.say({ t: 'create' });
    a.say({ t: 'pickClass', cls: 'cutthroat' });
    a.say({ t: 'ready', ready: true });
    a.say({ t: 'start' });
    const id = a.ws.lastLobby()!.youId;

    mgr.disconnected(a.sock, 'tokenAAAA');
    const a2 = client(mgr, 'tokenAAAA', 'Ann');
    const lobby = a2.ws.lastLobby()!;
    expect(lobby.state).toBe('game');
    expect(lobby.youId).toBe(id);
    mgr.tick();
    expect(a2.ws.sent.some((m) => m.t === 'view')).toBe(true);
  });

  it('kicks the old socket if the same token connects twice', () => {
    const mgr = new LobbyManager();
    const a = client(mgr, 'tokenAAAA', 'Ann');
    a.say({ t: 'create' });
    client(mgr, 'tokenAAAA', 'Ann');
    expect(a.ws.closed).toBe(true);
  });

  it('rejects joining a game in progress or a full lobby', () => {
    const mgr = new LobbyManager();
    const host = client(mgr, 'tokenHOST', 'H');
    host.say({ t: 'create' });
    const code = host.ws.lastLobby()!.code;
    for (const t of ['tokenP2xx', 'tokenP3xx', 'tokenP4xx']) client(mgr, t, t).say({ t: 'join', code });
    const late = client(mgr, 'tokenP5xx', 'Late');
    late.say({ t: 'join', code });
    expect(late.ws.errors()).toContain('That lobby is full.');
  });

  it('turns a player who leaves mid-game into a bot and passes host on', () => {
    const mgr = new LobbyManager();
    const a = client(mgr, 'tokenAAAA', 'Ann');
    a.say({ t: 'create' });
    const b = client(mgr, 'tokenBBBB', 'Bob');
    b.say({ t: 'join', code: a.ws.lastLobby()!.code });
    a.say({ t: 'pickClass', cls: 'warden' });
    b.say({ t: 'pickClass', cls: 'hexer' });
    a.say({ t: 'ready', ready: true });
    b.say({ t: 'ready', ready: true });
    a.say({ t: 'start' });
    const annId = a.ws.lastLobby()!.youId;
    a.say({ t: 'leave' });
    const lobby = b.ws.lastLobby()!;
    expect(lobby.hostId).toBe(lobby.youId);
    mgr.tick();
    const views = b.ws.sent.filter((m) => m.t === 'view');
    const last = views[views.length - 1];
    if (last?.t !== 'view') throw new Error();
    expect(last.view.allies.find((x) => x.id === annId)?.isBot).toBe(true);
  });
});
