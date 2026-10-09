// Dev playtest helper (not loaded by the game). Inject from the browser console:
//   await import('/autopilot.js'); startAutopilot({ homeAt: 540 })
// Plays a reasonable human-ish hero: explore, loot, fight, head home, wait for allies, escape.
window.startAutopilot = (opts = {}) => {
  const n = window.__net;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const ap = (window.__ap = { log: [], on: true, homeAt: opts.homeAt ?? 540, waitUntil: opts.waitUntil ?? 700 });
  const L = (s) => {
    ap.log.push(`${n.cur ? Math.floor(n.cur.time) : '?'}s ${s}`);
    if (ap.log.length > 120) ap.log.shift();
  };
  /** Distances over known, open corridors. */
  const dists = (v, from) => {
    const dist = new Map([[from, 0]]);
    const q = [from];
    while (q.length) {
      const cur = q.shift();
      for (const c of v.corridors) {
        if (c.collapsed || (c.a !== cur && c.b !== cur)) continue;
        const nb = c.a === cur ? c.b : c.a;
        if (!dist.has(nb)) (dist.set(nb, dist.get(cur) + c.length), q.push(nb));
      }
    }
    return dist;
  };
  let lastRound = '';
  let busyUntil = 0;
  const abilityIds = { warden: ['bash', 'guard', 'rally'], cutthroat: ['backstab', 'poison', 'smoke'], lampbearer: ['mend', 'flare', 'vigil'], hexer: ['hex', 'wither', 'pact'] };
  const ready = (you, i) => (you.cooldowns[abilityIds[you.cls][i]] ?? 0) === 0;
  // Driven by incoming snapshots (10/s) rather than timers, which background tabs throttle.
  const step = (v) => {
    if (!ap.on || v.phase !== 'running') {
      if (ap.on && v.phase !== 'running') { L('phase ' + v.phase); ap.on = false; }
      return;
    }
    if (performance.now() < busyUntil) return;
    busyUntil = performance.now() + 250;
    const you = v.you;
    if (you.extracted || you.dead) { L(you.extracted ? 'escaped' : 'dead'); ap.on = false; return; }
    const enc = v.encounter;
    if (enc) {
      // One decision per turn: the key changes each time our Speed timer restarts.
      const me = enc.heroes.find((h) => h.id === you.id);
      const key = enc.room + ':' + (me && me.nextIn !== null ? Math.round(v.time + me.nextIn) : 'down');
      if (me && !me.downed && !enc.yourChoice && key !== lastRound) {
        lastRound = key;
        const soft = enc.monsters.find((m) => m.st.mark || m.st.stun) ?? enc.monsters.slice().sort((a, b) => a.hp - b.hp)[0];
        const front = enc.monsters.find((m) => m.rank === 'front') ?? soft;
        const downed = enc.heroes.find((h) => h.downed);
        const hurtAlly = enc.heroes.filter((h) => !h.downed && h.hp / h.maxHp < 0.5).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
        const bi = you.items.indexOf('bandage');
        let choice;
        if (enc.room === v.exitRoom && v.exitOpen && v.time > ap.waitUntil) choice = { action: 'flee' };
        else if (downed) choice = { action: 'revive', target: downed.id };
        else if (you.hp / you.maxHp < 0.3 && bi >= 0) choice = { action: 'item', item: bi, target: you.id };
        else if (you.cls === 'lampbearer' && hurtAlly && ready(you, 0)) choice = { action: 'a0', target: hurtAlly.id };
        else if (you.cls === 'lampbearer' && ready(you, 1)) choice = { action: 'a1' };
        else if (you.cls === 'warden' && ready(you, 0)) choice = { action: 'a0', target: front.id };
        else if (you.cls === 'hexer' && enc.monsters.length >= 3 && ready(you, 2) && you.hp > 12) choice = { action: 'a2' };
        else if (you.cls === 'cutthroat' && enc.monsters.length > 1 && ready(you, 1)) choice = { action: 'a1', target: soft.id };
        else if (you.cls === 'lampbearer' || you.cls === 'warden') choice = { action: 'brace' };
        else choice = { action: 'a0', target: soft.id };
        L(`fight vs ${enc.monsters.map((m) => m.name).join('+')}: ${choice.action} (hp ${you.hp})`);
        n.intent({ type: 'combat', choice });
      }
      return;
    }
    if (v.loot?.vote && v.loot.vote.voters.includes(you.id) && !v.loot.vote.votes[you.id]) {
      const me = v.loot.vote.candidates.find((c) => c.id === you.id);
      n.intent({ type: 'vote', choice: me ? you.id : 'leave' });
      L('vote on ' + v.loot.vote.item);
      return;
    }
    if (you.pos.kind !== 'room' || you.path.length || you.channel || you.downedAt !== null) return;
    const here = you.pos.room;
    if (v.event && !v.event.blocked && !ap.decided.has(here)) {
      ap.decided.add(here);
      const c = v.event.choices.find((x) => !x.disabled && ['lead', 'open', 'drink', 'channel'].includes(x.id));
      if (c && !(c.id === 'channel' && v.time > ap.homeAt - 60)) { L(`event ${v.event.kind}: ${c.id}`); n.intent({ type: 'event', choice: c.id }); return; }
    }
    const bi = you.items.indexOf('bandage');
    if (bi >= 0 && you.hp / you.maxHp < 0.5) { n.intent({ type: 'useItem', index: bi }); return; }
    const ti = you.items.indexOf('torch');
    if (ti >= 0 && you.light < 25) { n.intent({ type: 'useItem', index: ti }); return; }
    if (you.cls === 'lampbearer' && v.time >= you.fieldMendAt && you.hp / you.maxHp < 0.8) { n.intent({ type: 'fieldMend', target: you.id }); return; }
    const downedHere = v.allies.find((a) => a.live && a.downed && !a.dead && a.pos.kind === 'room' && a.pos.room === here);
    if (downedHere) { n.intent({ type: 'revive', target: downedHere.id }); L('revive ' + downedHere.name); return; }
    const d = dists(v, here);
    const exit = v.rooms.find((r) => r.id === v.exitRoom);
    const frontier = v.rooms.filter((r) => r.knowledge !== 'explored' && r.kind !== 'exit' && d.has(r.id));
    const rubbleHere = v.corridors.find((c) => c.collapsed && (c.a === here || c.b === here));
    const goHome = v.time >= ap.homeAt || you.hp / you.maxHp < 0.3 || v.leading;
    if (goHome) {
      if (here === v.exitRoom) {
        const missing = v.allies.filter((a) => !a.dead && !a.extracted && !(a.live && a.pos.kind === 'room' && a.pos.room === here));
        if (v.exitOpen && (missing.length === 0 || v.time > ap.waitUntil)) {
          L('escaping; missing: ' + (missing.map((a) => a.name).join(', ') || 'nobody'));
          n.intent({ type: 'extract' });
        }
        return;
      }
      if (d.has(v.exitRoom)) { n.intent({ type: 'goto', room: v.exitRoom }); return; }
      if (frontier.length) {
        const best = frontier.sort((a, b) => Math.hypot(a.x - exit.x, a.y - exit.y) - Math.hypot(b.x - exit.x, b.y - exit.y))[0];
        n.intent({ type: 'goto', room: best.id });
        return;
      }
      if (rubbleHere) { n.intent({ type: 'dig', corridor: rubbleHere.id }); L('digging'); }
      return;
    }
    const safe = (r) => !(r.threat > 0) || you.hp / you.maxHp > 0.6;
    const lootRoom = v.rooms.find((r) => r.loot > 0 && r.id !== here && d.has(r.id) && safe(r));
    const target = lootRoom ?? frontier.filter(safe).sort((a, b) => d.get(a.id) - d.get(b.id))[0] ?? frontier.sort((a, b) => d.get(a.id) - d.get(b.id))[0];
    if (target) n.intent({ type: 'goto', room: target.id });
    else if (rubbleHere) n.intent({ type: 'dig', corridor: rubbleHere.id });
  };
  ap.decided = new Set();
  n.viewHooks.push(step);
  return 'autopilot started';
};
