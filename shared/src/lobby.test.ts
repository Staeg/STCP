import { describe, expect, it } from 'vitest';
import type { ClientMsg, LobbyView, ServerMsg } from './protocol';
import { LobbyManager } from './lobby';
import { Stash } from './stash';

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
  const sock = ws;
  const say = (msg: ClientMsg) => mgr.handle(sock, token, name, msg);
  say({ t: 'hello', token, name });
  return { ws, sock, say };
}

describe('LobbyManager', () => {
  it('runs the full create → join → pick → ready → start flow and fills bots', () => {
    const mgr = new LobbyManager(new Stash(null));
    const a = client(mgr, 'tokenAAAA', 'Ann');
    expect(a.ws.lastLobby()).toBeNull();
    a.say({ t: 'create' });
    const code = a.ws.lastLobby()!.code;
    expect(code).toMatch(/^[A-Z]{4}$/);

    const b = client(mgr, 'tokenBBBB', 'Bob');
    b.say({ t: 'join', code });
    expect(b.ws.lastLobby()!.members.map((m) => m.name)).toEqual(['Ann', 'Bob']);

    // Players may share a class; bots take classes nobody picked.
    a.say({ t: 'pickClass', cls: 'warden' });
    b.say({ t: 'pickClass', cls: 'warden' });
    expect(b.ws.errors()).toHaveLength(0);

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
    // 3 others: Bob + 2 bots, all visible at the entrance. Both humans are Wardens, the bots something else.
    expect(view.view.allies).toHaveLength(3);
    const bots = view.view.allies.filter((x) => x.isBot);
    expect(bots).toHaveLength(2);
    expect(view.view.allies.find((x) => !x.isBot)!.cls).toBe('warden');
    expect(bots.every((x) => x.cls !== 'warden')).toBe(true);
    expect(bots[0].cls).not.toBe(bots[1].cls);
    // Same class, different colours, so they can be told apart.
    expect(view.view.allies.find((x) => !x.isBot)!.color).not.toBe(view.view.you.color);
  });

  it('accepts a rename before joining a lobby without an error', () => {
    const mgr = new LobbyManager(new Stash(null));
    const a = client(mgr, 'tokA', 'Mara');
    a.say({ t: 'setName', name: 'Tobin' });
    expect(a.ws.errors()).toEqual([]);
  });

  it('never leaks tokens to other players', () => {
    const mgr = new LobbyManager(new Stash(null));
    const a = client(mgr, 'secretAAAA', 'Ann');
    a.say({ t: 'create' });
    const b = client(mgr, 'secretBBBB', 'Bob');
    b.say({ t: 'join', code: a.ws.lastLobby()!.code });
    expect(JSON.stringify(b.ws.sent)).not.toContain('secretAAAA');
  });

  it('resumes the same hero on reconnect with the same token', () => {
    const mgr = new LobbyManager(new Stash(null));
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
    const mgr = new LobbyManager(new Stash(null));
    const a = client(mgr, 'tokenAAAA', 'Ann');
    a.say({ t: 'create' });
    client(mgr, 'tokenAAAA', 'Ann');
    expect(a.ws.closed).toBe(true);
  });

  it('rejects joining a game in progress or a full lobby', () => {
    const mgr = new LobbyManager(new Stash(null));
    const host = client(mgr, 'tokenHOST', 'H');
    host.say({ t: 'create' });
    const code = host.ws.lastLobby()!.code;
    for (const t of ['tokenP2xx', 'tokenP3xx', 'tokenP4xx']) client(mgr, t, t).say({ t: 'join', code });
    const late = client(mgr, 'tokenP5xx', 'Late');
    late.say({ t: 'join', code });
    expect(late.ws.errors()).toContain('That lobby is full.');
  });

  it('turns a player who leaves mid-game into a bot and passes host on', () => {
    const mgr = new LobbyManager(new Stash(null));
    const a = client(mgr, 'tokenAAAA', 'Ann');
    a.say({ t: 'create' });
    const b = client(mgr, 'tokenBBBB', 'Bob');
    b.say({ t: 'join', code: a.ws.lastLobby()!.code });
    a.say({ t: 'pickClass', cls: 'warden' });
    b.say({ t: 'pickClass', cls: 'witch' });
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

  it('brings Village Characters: bots borrow healthy ones, and only players’ Characters carry the run home', () => {
    const stash = new Stash(null);
    // Ann's Village: everything but the Witch and the Zealot is hurt; her Warden has a Talent.
    for (const c of stash.characters('Ann')) {
      if (c.cls === 'witch' || c.cls === 'zealot' || c.cls === 'warden') continue;
      stash.recordCharacter('Ann', c.id, { escaped: true, lowestHp: 0.4, downedMajor: false, affliction: null });
    }
    const warden = stash.characterFor('Ann', 'warden');
    stash.recordCharacter('Ann', warden.id, { escaped: true, lowestHp: 1, downedMajor: false, affliction: null });
    stash.recordCharacter('Ann', warden.id, { escaped: true, lowestHp: 1, downedMajor: false, affliction: null });
    expect(stash.chooseTalent('Ann', warden.id, 'ironOath')).toBeNull();

    const mgr = new LobbyManager(stash);
    const a = client(mgr, 'tokenAAAA', 'Ann');
    a.say({ t: 'create' });
    a.say({ t: 'pickClass', cls: 'warden' });
    expect(a.ws.lastLobby()!.cr).toBe(1);
    expect(a.ws.lastLobby()!.members[0].character?.talent).toBe('ironOath');
    a.say({ t: 'ready', ready: true });
    a.say({ t: 'start' });

    const lobby = (mgr as unknown as { lobbies: Map<string, { game: import('./sim/game').Game }> }).lobbies.values().next().value!;
    const heroes = Object.values(lobby.game.world.heroes);
    const you = heroes.find((h) => !h.isBot)!;
    expect(you.name).toBe(`${warden.name} (Ann)`);
    expect(you.talent).toBe('ironOath');
    const bots = heroes.filter((h) => h.isBot);
    // The two healthy ones first (Witch, Zealot), then a hurt one, since nobody healthy is left.
    expect(bots.map((h) => h.cls).slice(0, 2).sort()).toEqual(['witch', 'zealot']);
    expect(bots[2].injuries).toEqual(['minor']);
    expect(bots.every((b) => b.owner === 'Ann')).toBe(true);
    expect(lobby.game.world.cr).toBe(1);

    // Everyone dies: the bots' Characters are untouched, Ann's Warden is replaced by a recruit.
    for (const h of heroes) {
      h.dead = true;
      h.diedAt = 1;
    }
    mgr.tick();
    const v = stash.village('Ann');
    expect(v.characters.find((c) => c.cls === 'warden')!.id).not.toBe(warden.id);
    expect(v.characters.find((c) => c.cls === 'witch')!.injuries).toEqual([]);
    expect(v.characters.find((c) => c.cls === 'zealot')!.xp).toBe(0);
    expect(a.ws.sent.some((m) => m.t === 'village' && m.village.report.length > 0)).toBe(true);
  });
});
