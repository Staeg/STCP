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
  (async () => {
    while (ap.on) {
      await wait(250);
      const v = n.cur;
      if (!v || v.phase !== 'running') {
        if (v) L('phase ' + v.phase);
        break;
      }
      const you = v.you;
      if (you.extracted || you.dead) {
        L(you.extracted ? 'escaped' : 'dead');
        break;
      }
      const enc = v.encounter;
      if (enc) {
        const key = enc.room + ':' + enc.round;
        if (enc.phase === 'choosing' && !enc.yourChoice && !enc.youJoining && key !== lastRound) {
          lastRound = key;
          const soft = enc.monsters.find((m) => m.st.mark || m.st.stun) ?? enc.monsters.slice().sort((a, b) => a.hp - b.hp)[0];
          const downed = enc.heroes.find((h) => h.downed);
          const bi = you.items.indexOf('bandage');
          let choice = { action: 'a0', target: soft?.id };
          if (enc.room === v.exitRoom && v.exitOpen && v.time > ap.waitUntil) choice = { action: 'flee' };
          else if (downed) choice = { action: 'revive', target: downed.id };
          else if (you.hp / you.maxHp < 0.35 && bi >= 0) choice = { action: 'item', item: bi, target: you.id };
          L(`fight r${enc.round}: ${choice.action}`);
          n.intent({ type: 'combat', choice });
        }
        continue;
      }
      if (v.loot?.vote && v.loot.vote.voters.includes(you.id) && !v.loot.vote.votes[you.id]) {
        const me = v.loot.vote.candidates.find((c) => c.id === you.id);
        n.intent({ type: 'vote', choice: me ? you.id : 'leave' });
        L('vote on ' + v.loot.vote.item);
        continue;
      }
      if (you.pos.kind !== 'room' || you.path.length || you.channel || you.downedAt !== null) continue;
      const here = you.pos.room;
      const bi = you.items.indexOf('bandage');
      if (bi >= 0 && you.hp / you.maxHp < 0.5) { n.intent({ type: 'useItem', index: bi }); continue; }
      const ti = you.items.indexOf('torch');
      if (ti >= 0 && you.light < 25) { n.intent({ type: 'useItem', index: ti }); continue; }
      const downedHere = v.allies.find((a) => a.live && a.downed && !a.dead && a.pos.kind === 'room' && a.pos.room === here);
      if (downedHere) { n.intent({ type: 'revive', target: downedHere.id }); L('revive ' + downedHere.name); continue; }
      const d = dists(v, here);
      const exit = v.rooms.find((r) => r.id === v.exitRoom);
      const frontier = v.rooms.filter((r) => r.knowledge !== 'explored' && r.kind !== 'exit' && d.has(r.id));
      const rubbleHere = v.corridors.find((c) => c.collapsed && (c.a === here || c.b === here));
      if (v.time >= ap.homeAt) {
        if (here === v.exitRoom) {
          const missing = v.allies.filter((a) => !a.dead && !a.extracted && !(a.live && a.pos.kind === 'room' && a.pos.room === here));
          if (v.exitOpen && (missing.length === 0 || v.time > ap.waitUntil)) {
            L('escaping; missing: ' + (missing.map((a) => a.name).join(', ') || 'nobody'));
            n.intent({ type: 'extract' });
            await wait(1000);
          }
          continue;
        }
        if (d.has(v.exitRoom)) { n.intent({ type: 'goto', room: v.exitRoom }); L('heading to exit'); continue; }
        if (frontier.length) {
          const best = frontier.sort((a, b) => Math.hypot(a.x - exit.x, a.y - exit.y) - Math.hypot(b.x - exit.x, b.y - exit.y))[0];
          n.intent({ type: 'goto', room: best.id });
          continue;
        }
        if (rubbleHere) { n.intent({ type: 'dig', corridor: rubbleHere.id }); L('digging'); continue; }
        continue;
      }
      const lootRoom = v.rooms.find((r) => r.loot > 0 && r.id !== here && d.has(r.id));
      const target = lootRoom ?? frontier.sort((a, b) => d.get(a.id) - d.get(b.id))[0];
      if (target) n.intent({ type: 'goto', room: target.id });
      else if (rubbleHere) n.intent({ type: 'dig', corridor: rubbleHere.id });
    }
  })();
  return 'autopilot started';
};
