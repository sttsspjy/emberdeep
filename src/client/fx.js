// Minimal juice (client only): death puffs, damage numbers (merged per foe per 150 ms, at most 60 alive, oldest dropped; crits bigger and yellow), swing arcs, blast rings, chain lines,
// screen shake (skills, elite deaths, boss hits; scaled down with the crowd). ED.FX.handle(ev, ctx) consumes sim events; update(dt) once per frame; draw(B, t) world layer; drawTop(B) numbers.
(function (ED) {
  'use strict';
  const U = ED.U;
  const F = ED.FX = { shake: 0, numbers: true };
  const MAXP = 400, MAXN = 60, MAXR = 48, MAXS = 24, MAXC = 16, DIE_BUDGET = 40;
  const parts = [], nums = [], rings = [], slashes = [], chains = [];
  let now = 0, dieN = 0;
  const take = (arr, max, make) => { if (arr.length >= max) { const o = arr.shift(); arr.push(o); return o; } const o = make(); arr.push(o); return o; };

  F.part = (x, y, vx, vy, life, col, size) => { const p = take(parts, MAXP, () => ({})); p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = p.max = life; p.col = col; p.size = size || 2; };
  F.puff = (x, y, n, col, sp) => { for (let i = 0; i < n; i++) { const a = Math.random() * U.TAU, s = (sp || 40) * (0.4 + Math.random() * 0.8); F.part(x, y, Math.cos(a) * s, Math.sin(a) * s - 10, 0.35 + Math.random() * 0.25, col, 2); } };
  F.ring = (x, y, r, col, life) => { const o = take(rings, MAXR, () => ({})); o.x = x; o.y = y; o.r = r; o.col = col; o.life = o.max = life || 0.3; };
  F.number = (id, x, y, v, crit) => {
    if (!F.numbers) return;
    for (let i = nums.length - 1; i >= 0; i--) { const n = nums[i]; if (n.id === id && now - n.born < 0.15) { n.v += v; n.crit = n.crit || crit; n.x = x; n.y = y; return; } }
    const n = take(nums, MAXN, () => ({})); n.id = id; n.x = x + (Math.random() - 0.5) * 6; n.y = y; n.v = v; n.crit = crit; n.born = now; n.life = n.max = crit ? 0.8 : 0.6;
  };
  F.addShake = (v, crowd) => { F.shake = Math.min(10, F.shake + v / (1 + (crowd || 0) / 300)); };

  const LOOK_COL = { fire: 0xff8a3dff, holy: 0xffe08aff, shock: 0xd8e6ffff, ring: 0xe6c27aff, skull: 0xb7a6e0ff, shadow: 0x8a9bd6ff, poison: 0x7fe39aff, meteor: 0xff6a2aff, tele: 0xff4a3aff };
  // ctx: { me (local pid), crowd (foes on screen), foes (view foes for elite lookups) }
  F.handle = (ev, ctx) => {
    const mine = ev.pid === ctx.me;
    switch (ev.t) {
      case 'hit': F.number(ev.id, ev.x, ev.y - 4, ev.dmg, ev.crit); break;
      case 'die':
        if (dieN++ < DIE_BUDGET) F.puff(ev.x, ev.y - 4, ev.elite || ev.boss ? 16 : 5, ev.boss ? 0xffd27aff : 0xd8c8b0ff, ev.elite || ev.boss ? 80 : 40);
        if (ev.elite || ev.boss) F.addShake(ev.boss ? 6 : 3, ctx.crowd);
        break;
      case 'swing': { const s = take(slashes, MAXS, () => ({})); s.x = ev.x; s.y = ev.y; s.a = ev.a; s.r = ev.r; s.arc = ev.arc; s.life = s.max = 0.16; break; }
      case 'boom': F.ring(ev.x, ev.y, ev.r, LOOK_COL[ev.look] || (ev.team ? 0xff4a3aff : 0xfff1d6ff), ev.r > 200 ? 0.45 : 0.3); break;
      case 'chain': { const c = take(chains, MAXC, () => ({})); c.pts = ev.pts; c.life = c.max = 0.18; break; }
      case 'skill': if (mine) F.addShake(2.5, ctx.crowd); break;
      case 'hurt': if (ev.pid === ctx.me) F.addShake(2, 0); F.puff(ev.x, ev.y - 10, 4, 0xff4a4aff, 50); break;
      case 'boss': if (ev.phase === 0) F.addShake(5, 0); break;
      case 'evolve': case 'level': break;
      default: break;
    }
  };

  F.update = (dt) => {
    now += dt; dieN = 0;
    let n = 0;
    for (let i = 0; i < parts.length; i++) { const p = parts[i]; p.life -= dt; if (p.life <= 0) continue; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy = p.vy * 0.9 + 60 * dt; parts[n++] = p; }
    parts.length = n;
    const tick = (arr, rate) => { let m = 0; for (let i = 0; i < arr.length; i++) { const o = arr[i]; o.life -= dt; if (rate) o.y -= rate * dt; if (o.life > 0) arr[m++] = o; } arr.length = m; };
    tick(nums, 22); tick(rings); tick(slashes); tick(chains);
    F.shake = Math.max(0, F.shake - dt * (8 + F.shake * 3));
  };
  // Camera offset from shake (world px).
  F.shakeXY = (out) => { const s = F.shake; out.x = s > 0.05 ? (Math.random() - 0.5) * s : 0; out.y = s > 0.05 ? (Math.random() - 0.5) * s : 0; return out; };

  F.draw = (B) => {
    for (const s of slashes) { const k = s.life / s.max; if (s.arc >= 6.2) B.circ(s.x, s.y, s.r * (1.05 - 0.2 * k), (0xfff1d600 | Math.round(160 * k)) >>> 0, 3); else B.cone(s.x, s.y, s.r, s.a, s.arc, (0xfff1d600 | Math.round(110 * k)) >>> 0, 0); }
    for (const r of rings) { const k = r.life / r.max, a = Math.round(220 * k); B.circ(r.x, r.y, Math.max(1, r.r * (1.1 - 0.35 * k)), ((r.col & 0xffffff00) | a) >>> 0, 2); }
    for (const c of chains) { const k = c.life / c.max, p = c.pts; for (let i = 0; i + 3 < p.length; i += 2) B.line(p[i], p[i + 1] - 6, p[i + 2], p[i + 3] - 6, 2, (0xbfe4ff00 | Math.round(255 * k)) >>> 0); }
    for (const p of parts) { const k = p.life / p.max; B.rect(Math.round(p.x), Math.round(p.y), p.size, p.size, ((p.col & 0xffffff00) | Math.round(255 * k)) >>> 0); }
  };
  F.drawTop = (B) => {
    for (const n of nums) {
      const k = n.life / n.max, pop = Math.min(1, (n.max - n.life) / 0.08);
      B.text(String(Math.round(n.v)), n.x, n.y, n.crit ? 0xffd84a : 0xffffff, n.crit ? 2 : 1, 'c', Math.min(1, k * 2) * (0.6 + 0.4 * pop));
    }
  };
  F.clear = () => { parts.length = nums.length = rings.length = slashes.length = chains.length = 0; F.shake = 0; };
})(globalThis.ED || (globalThis.ED = {}));
