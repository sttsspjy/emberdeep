// Support weapons (a), trees and numbers in docs/supports.md: Censer -> Holy Censer, Orbit Lanterns -> Sun Wheel, Meteor Call -> Starfall, Frost Ring -> Glacier.
// Registered with ED.addWeapon(def with support: true, impl). Every hit goes through the combat primitives (blast, zone, shoot), so the holder's view clamp holds.
// Per-entity state comes from free lists (returned in onEnd); zone / shot options are scratch objects: steady-state firing allocates nothing. Draws: src/client/wfx-a.js (by look).
// Looks: censer holycenser (hero auras: r radius, w swinging censers), cward (push ring), cember (ember patch), lantern sunlantern (orbit shots), sunring (wheel aura), lflare (burst),
// meteor mshower star comet (falling, team 0 warn zones), mboom (impact), mcrater (burning ground), ember (shard shot), frostring glacier shatterw (rings), mrime (frost floor), iceshard (shot).
(function (ED) {
  'use strict';
  const U = ED.U, TAU = U.TAU;
  ED.regLook('censer', 'holycenser', 'cward', 'cember', 'lantern', 'sunlantern', 'sunring', 'lflare', 'meteor', 'mshower', 'star', 'comet', 'mboom', 'mcrater', 'ember',
    'frostring', 'glacier', 'shatterw', 'mrime', 'iceshard');

  // ---------------- shared helpers ----------------
  const pool = () => { const L = []; return { take: () => L.pop() || {}, give: (o) => { if (L.length < 256) L.push(o); } }; };
  const ORB = pool(), RING = pool(), DROP = pool();
  const ZO = {}, SO = {};
  // Scratch options for w.zone / w.shoot (both copy what they need during the call).
  const zo = () => { for (const k in ZO) ZO[k] = undefined; ZO.team = 0; return ZO; };
  const so = () => { for (const k in SO) SO[k] = undefined; return SO; };
  // Visual-only zone (no damage) for the renderer.
  const vis = (w, p, wid, look, x, y, r, dur) => { const o = zo(); o.look = look; o.x = x; o.y = y; o.r = r; o.dur = dur; o.p = p; o.wid = wid; return w.zone(o); };
  // Cached [a, b] status pair per slot state (zones keep the reference).
  const pair = (st, key, a, b) => { const v = st[key] || (st[key] = [0, 0]); v[0] = a; v[1] = b; return v; };
  // Hero-following aura zone of slot ws (ws.st.zid); dies once the hero falls or the slot stops owning it (Form taken: ws.st is replaced).
  const auraTick = (w, z) => { const ws = z.st; if (!w.alive(z.p) || !ws || ws.st.zid !== z.id) { z.dead = true; z.st = null; } };
  const aura = (w, p, ws, look, r) => {
    const st = ws.st; let z = st.z;
    if (!z || z.dead || z.id !== st.zid) {
      const o = zo(); o.look = look; o.x = p.x; o.y = p.y; o.r = r; o.dur = 1e6; o.follow = p.pid; o.p = p; o.wid = ws.id; o.onTick = auraTick; o.st = ws;
      z = st.z = w.zone(o); st.zid = z.id;
    }
    if (z.r !== r) z.r = r;
    return z;
  };
  let inBurst = false; // kill bursts never chain

  // ---------------- Censer / Holy Censer ----------------
  // Aura of S.rad x area px around the hero; every cd a pulse hits every foe inside (S.dmg, no event): slowK slows (for cd + 0.3 s), push knocks out, burn sets foes burning
  // (S.dmg x burn per s, 2 s). ward: every 3rd pulse also blasts a push ring (look cward, knock 240, stun 0.3 s). embers: each pulse drops that many burning patches (look cember,
  // 12 x area px, 2.5 s, 80% damage per s) at random points inside. swing: censers orbit at 0.8 R (angle SWING_W x aura age + i x TAU / n; the client draws it from the zone's t),
  // each a 12 x area px hit every 0.2 s at 50% damage. burst (kill hook): a foe burning from the holder bursts on death (24 x area px, 60% damage, burns).
  // Holy Censer: kills inside the aura heal the holder 1 HP each, at most S.heal HP/s (allies: living allies inside heal too).
  const SWING_W = 3.2;
  const PULSE = { noEv: true, knock: 0, slow: null, burn: null };
  const WARD = { noEv: true, knock: 240, stun: 0.3, slow: null };
  const SWING = { noEv: true, knock: 60 };
  const BURST = { look: 'fire', knock: 40, burn: null };
  const censerTick = (w, p, ws, S, dt, look) => {
    const st = ws.st, R = S.rad * S.area, n = S.swing | 0, z = aura(w, p, ws, look, R);
    z.w = n;
    if (S.heal > 0) st.hb = Math.min(S.heal, (st.hb || 0) + S.heal * dt);
    if (n > 0 && (st.swT = (st.swT || 0) - dt) <= 0) {
      st.swT += 0.2;
      for (let i = 0; i < n; i++) {
        const a = z.t * SWING_W + i * TAU / n;
        w.blast(p, ws.id, p.x + Math.cos(a) * R * 0.8, p.y - 2 + Math.sin(a) * R * 0.8, 12 * S.area, S.dmg * 0.5, SWING);
      }
    }
  };
  const censerFire = (w, p, ws, S) => {
    const st = ws.st, R = S.rad * S.area;
    st.pc = (st.pc | 0) + 1;
    PULSE.knock = S.push || 0;
    PULSE.slow = S.slowK > 0 ? pair(st, 'slowA', S.slowK, S.cd + 0.3) : null;
    PULSE.burn = S.burn > 0 ? pair(st, 'burnA', S.dmg * S.burn, 2) : null;
    w.blast(p, ws.id, p.x, p.y, R, S.dmg, PULSE);
    if (S.ward > 0 && st.pc % 3 === 0) { WARD.slow = PULSE.slow; w.blast(p, ws.id, p.x, p.y, R + 8, S.dmg, WARD); vis(w, p, ws.id, 'cward', p.x, p.y, R + 8, 0.3); }
    for (let i = 0; i < (S.embers | 0); i++) {
      const a = w.rng.next() * TAU, d = Math.sqrt(w.rng.next()) * R * 0.85, o = zo();
      o.look = 'cember'; o.x = p.x + Math.cos(a) * d; o.y = p.y + Math.sin(a) * d; o.r = 12 * S.area; o.dur = 2.5; o.dps = S.dmg * 0.8; o.tick = 0.5; o.p = p; o.wid = ws.id;
      o.burn = pair(st, 'burnE', S.dmg * Math.max(0.3, S.burn || 0), 2);
      w.zone(o);
    }
    return true;
  };
  const censerKill = (w, p, ws, S, e) => {
    if (S.burst > 0 && !inBurst && e.burnT > 0 && e.burnOwner === p) {
      inBurst = true; BURST.burn = pair(ws.st, 'burnB', S.dmg * Math.max(0.3, S.burn || 0), 2);
      w.blast(p, ws.id, e.x, e.y, 24 * S.area, S.dmg * 0.6, BURST);
      inBurst = false;
    }
    const st = ws.st;
    if (!(S.heal > 0) || !(st.hb >= 1)) return;
    const R = S.rad * S.area + e.r;
    if (U.dist2(p.x, p.y, e.x, e.y) > R * R) return;
    st.hb -= 1; w.heal(p, 1);
    if (S.allies) for (const h of w.living) if (h !== p && U.dist2(h.x, h.y, e.x, e.y) <= R * R) w.heal(h, 1);
  };
  ED.addWeapon({
    id: 'censer', name: 'Censer', icon: 'shield.gold', look: 'censer', support: true, role: 'horde', mode: 'around', txt: 'A smoking aura burns foes near you', noAmount: true,
    base: { dmg: 3, cd: 0.7, n: 1, pierce: 0, area: 1, speed: 0, dur: 0, knock: 0, range: 0, rad: 40, swing: 0, push: 0, slowK: 0, ward: 0, burn: 0, embers: 0, burst: 0, heal: 0 },
    paths: [
      { id: 'size', name: 'Size', form: 'holycenser', ranks: [
        { mods: { area: 0.2 }, txt: 'Aura 20% wider' },
        { mods: { swing: 1 }, txt: 'A censer swings around you' },
        { mods: { area: 0.2, swing: 1 }, txt: 'Aura 20% wider, +1 swinging censer' }] },
      { id: 'ward', name: 'Ward', form: 'holycenser', ranks: [
        { mods: { slowK: 0.25 }, txt: 'Foes in the aura slow 25%' },
        { mods: { push: 60, dmg: 0.2 }, txt: 'Pulses push foes out, +20% damage' },
        { mods: { ward: 1 }, txt: 'Every 3rd pulse blasts foes back' }] },
      { id: 'embers', name: 'Embers', form: 'holycenser', ranks: [
        { mods: { burn: 0.4 }, txt: 'Pulses set foes burning' },
        { mods: { embers: 1 }, txt: 'Each pulse drops a burning ember' },
        { mods: { burst: 1 }, txt: 'Burning foes burst when slain' }] },
    ],
    hybrids: [],
  }, { tick: (w, p, ws, S, dt) => censerTick(w, p, ws, S, dt, 'censer'), fire: censerFire, kill: censerKill });
  ED.addWeapon({
    id: 'holycenser', name: 'Holy Censer', icon: 'fx.burst', look: 'holycenser', support: true, role: 'horde', mode: 'around', evolved: true, form: true, from: 'censer',
    txt: 'Kills in the aura heal you', noAmount: true,
    base: { dmg: 6, cd: 0.55, n: 1, pierce: 0, area: 1, speed: 0, dur: 0, knock: 0, range: 0, rad: 60, swing: 0, push: 110, slowK: 0.2, heal: 3 },
    refine: [
      { mods: { area: 0.2 }, txt: 'Holy aura 20% wider' },
      { mods: { heal: 2, allies: true }, txt: 'Heals allies too, up to 5 HP/s' },
    ],
  }, { tick: (w, p, ws, S, dt) => censerTick(w, p, ws, S, dt, 'holycenser'), fire: censerFire, kill: censerKill });

  // ---------------- Orbit Lanterns / Sun Wheel ----------------
  // Lanterns are pierce-all shots steered on a circle around the hero (angle a0 + w.time x spin x dir, so a rebuilt ring keeps its phase), re-hitting a foe every S.rehit s.
  // tick keeps the ring: it rebuilds when the slot's numbers change (weapon key, stats version) or a lantern is gone; old lanterns die on their next step (generation check).
  // ring2: a counter-ring of ceil(n / 3) + 1 lanterns at 1.6 R; breathe: radius swings 0.65 R .. 1.35 R every 3 s; flare: a lantern that hits bursts (S.flareR x area px, 30% damage,
  // flareSlow: bursts slow 40% for 1.2 s; look lflare) at most every 1.2 s. Sun Wheel: a burning ring (look sunring) follows the hero, and every cd the wheel flares:
  // each sun bursts in turn 0.04 s apart (S.flareR x area px, S.dmg, push S.knock x 2, burns S.dmg x S.burn per s for 2 s).
  const ORB_Y = 4, BREATHE = 3;
  const breath = (w) => 1 + 0.35 * Math.sin(w.time * TAU / BREATHE); // breathe: radius factor 0.65 .. 1.35
  const orbR = (w, s) => s.R * (s.breathe ? breath(w) : 1);
  const orbTick = (w, pr, dt) => {
    const s = pr.st, p = pr.p;
    if (!s || !w.alive(p) || s.ws.st !== s.own || s.own.gen !== s.gen) { pr.dead = true; return; }
    const R = orbR(w, s) * (s.pop && pr.t < 0.2 ? pr.t / 0.2 : 1), a = s.a0 + w.time * s.spin * s.dir;
    pr.vx = (p.x + Math.cos(a) * R - pr.x) / dt; pr.vy = (p.y - ORB_Y + Math.sin(a) * R - pr.y) / dt;
  };
  const FLARE = { noEv: true, knock: 90, burn: null, slow: null }, FL_SLOW = [0.4, 1.2];
  const orbHit = (w, pr, e) => {
    const s = pr.st; if (!s) return;
    if (s.flR > 0 && w.time >= s.fT) {
      s.fT = w.time + 1.2;
      FLARE.knock = 90; FLARE.burn = null; FLARE.slow = s.flS ? FL_SLOW : null;
      w.blast(pr.p, pr.wid, pr.x, pr.y, s.flR, s.flD, FLARE);
      vis(w, pr.p, pr.wid, 'lflare', pr.x, pr.y, s.flR, 0.3);
    }
  };
  const orbEnd = (w, pr) => { if (pr.st) { ORB.give(pr.st); pr.st = null; } };
  const orbRing = (w, p, ws, S, n, R, dir, a0, look, body) => {
    const st = ws.st, r = (look === 'sunlantern' ? 11 : 8) * Math.sqrt(S.area);
    for (let i = 0; i < n; i++) {
      const s = ORB.take();
      s.ws = ws; s.own = st; s.gen = st.gen; s.a0 = a0 + i * TAU / n; s.R = R; s.spin = S.speed; s.dir = dir; s.breathe = S.breathe > 0; s.pop = !st.cont;
      s.flR = S.flare > 0 ? S.flareR * S.area : 0; s.flD = S.dmg * 0.3; s.flS = S.flareSlow > 0; s.fT = 0;
      const a = s.a0 + w.time * s.spin * dir, R0 = s.pop ? 2 : orbR(w, s);
      const q = so(); q.look = look; q.speed = 0; q.r = r; q.life = 1e6; q.pierce = 1e9; q.rehit = S.rehit; q.dmg = S.dmg * body; q.knock = S.knock; q.tick = orbTick; q.onHit = orbHit; q.onEnd = orbEnd; q.st = s;
      const pr = w.shoot(p, ws.id, p.x + Math.cos(a) * R0, p.y - ORB_Y + Math.sin(a) * R0, a + Math.PI / 2, S, q);
      st.objs.push(pr); st.ids.push(pr.id);
    }
  };
  // Keeps the slot's ring(s) alive and current. Returns the number of live lanterns.
  const keepRing = (w, p, ws, S, look, body) => {
    const st = ws.st;
    if (!st.objs) { st.objs = []; st.ids = []; st.gen = 0; st.key = -1; }
    let live = 0;
    for (let i = 0; i < st.objs.length; i++) { const o = st.objs[i]; if (!o.dead && o.id === st.ids[i]) live++; }
    const key = ED.weaponKey(ws) * 65536 + (p.statsV & 65535);
    if (key === st.key && live === st.objs.length && live > 0) return live;
    st.cont = live > 0; st.gen++; st.key = key; st.objs.length = 0; st.ids.length = 0;
    const n = Math.max(1, S.n | 0), R = S.rad * Math.sqrt(S.area);
    orbRing(w, p, ws, S, n, R, 1, 0, look, body);
    if (S.ring2 > 0) orbRing(w, p, ws, S, Math.ceil(n / 3) + 1, R * 1.6, -1, 0.4, look, body);
    return st.objs.length;
  };
  ED.addWeapon({
    id: 'lanterns', name: 'Orbit Lanterns', icon: 'weapon.lantern', look: 'lantern', support: true, role: 'horde', mode: 'around', txt: 'Lanterns circle you, striking foes',
    base: { dmg: 3, cd: 1, n: 3, pierce: 0, area: 1, speed: 1.7, dur: 0, knock: 70, range: 0, rad: 40, rehit: 0.4, ring2: 0, breathe: 0, flare: 0, flareR: 16, flareSlow: 0 },
    paths: [
      { id: 'count', name: 'Count', form: 'sunwheel', ranks: [
        { mods: { n: 1 }, txt: '+1 lantern' },
        { mods: { n: 1 }, txt: '+1 lantern' },
        { mods: { n: 1 }, txt: '+1 lantern' }] },
      { id: 'radius', name: 'Radius', form: 'sunwheel', ranks: [
        { mods: { rad: 14, area: 0.15 }, txt: 'Wider orbit, bigger lanterns' },
        { mods: { ring2: 1 }, txt: 'An outer ring spins the other way' },
        { mods: { breathe: 1 }, txt: 'Rings swing in and out' }] },
      { id: 'flare', name: 'Flare', form: 'sunwheel', ranks: [
        { mods: { flare: 1 }, txt: 'Lanterns burst on hit' },
        { mods: { flareSlow: 1, dmg: 0.2 }, txt: 'Bursts slow foes, +20% damage' },
        { mods: { flareR: 8 }, txt: 'Bursts 50% wider' }] },
    ],
    hybrids: [],
  }, {
    tick(w, p, ws, S) { keepRing(w, p, ws, S, 'lantern', 1); },
    fire() { return false; }, // the ring is kept by tick
  });
  ED.addWeapon({
    id: 'sunwheel', name: 'Sun Wheel', icon: 'fxbig.firespin', look: 'sunlantern', support: true, role: 'horde', mode: 'around', evolved: true, form: true, from: 'lanterns',
    txt: 'A burning wheel of suns flares out',
    base: { dmg: 2.4, cd: 1.8, n: 4, pierce: 0, area: 1, speed: 1.4, dur: 0, knock: 90, range: 0, rad: 60, rehit: 0.4, burn: 1, flareR: 26 },
    refine: [
      { mods: { n: 2 }, txt: '+2 suns on the wheel' },
      { mods: { cd: -0.35 }, txt: 'The wheel flares 35% more often' },
    ],
  }, {
    tick(w, p, ws, S, dt) {
      keepRing(w, p, ws, S, 'sunlantern', 1);
      const st = ws.st;
      aura(w, p, ws, 'sunring', S.rad * Math.sqrt(S.area) * (S.breathe > 0 ? breath(w) : 1));
      if (!(st.fi < st.objs.length) || (st.fq -= dt) > 0) return;
      st.fq += 0.04;
      const pr = st.objs[st.fi], id = st.ids[st.fi++];
      if (pr.dead || pr.id !== id) return;
      FLARE.knock = S.knock * 2; FLARE.burn = pair(st, 'burnF', S.dmg * S.burn, 2); FLARE.slow = S.flareSlow > 0 ? FL_SLOW : null;
      w.blast(p, ws.id, pr.x, pr.y, S.flareR * S.area, S.dmg, FLARE);
      vis(w, p, ws.id, 'lflare', pr.x, pr.y, S.flareR * S.area, 0.35);
    },
    fire(w, p, ws) { ws.st.fi = 0; ws.st.fq = 0; return true; },
  });

  // ---------------- Meteor Call / Starfall ----------------
  // A meteor is a team 0 warn zone (look meteor / mshower / star / comet): it falls for its dur, then hits every foe inside (dmg, knock) and emits 'boom';
  // onEnd adds the impact flash (mboom), braziers, a crater (crater: burning ground of 0.8 x r x (1 + craterK), S.dur s, 15% dmg per s; erupt: it bursts again as it fades, 50%)
  // and ember shards (shards: 3 shots, 30% dmg). Targets: random foes in the holder's view (dense: the first at the densest pack), else the aim point 90 px out.
  // shower: every 0.6 s that many small meteors (0.5 x size, 40% dmg, 0.45 s fall, no crater) on random foes.
  // Starfall: S.n stars every cd (0.7 x size, no crater, shards with the Shower path); every S.comet-th volley a comet on the densest pack (2.5x damage, 2.2x size, a crater that erupts, shards).
  const F_CRATER = 1, F_ERUPT = 2, F_SHARDS = 4;
  const craterEnd = (w, z) => {
    const s = z.st; if (!s) return;
    if (s.fl & F_ERUPT) { w.blast(z.p, z.wid, z.x, z.y, z.r, s.dmg * 0.5, ERUPT); vis(w, z.p, z.wid, 'mboom', z.x, z.y, z.r, 0.45); }
    DROP.give(s); z.st = null;
  };
  const ERUPT = { look: 'fire', knock: 120 };
  const impact = (w, z) => {
    const s = z.st; if (!s) return;
    const p = z.p;
    vis(w, p, z.wid, 'mboom', z.x, z.y, z.r, 0.45);
    w.hitBraziers(z.x, z.y, z.r, p);
    if (s.fl & F_CRATER) {
      const c = DROP.take(), o = zo(); c.fl = s.fl; c.dmg = s.dmg;
      o.look = 'mcrater'; o.x = z.x; o.y = z.y; o.r = z.r * 0.8 * (1 + s.ck); o.dur = s.dur; o.dps = s.dmg * 0.15; o.tick = 0.5; o.tickDelay = 0.3; o.p = p; o.wid = z.wid;
      o.st = c; o.onEnd = craterEnd;
      w.zone(o);
    }
    if (s.fl & F_SHARDS) for (let i = 0; i < 3; i++) {
      const a = i * TAU / 3 + z.id * 0.61, q = so();
      q.look = 'ember'; q.speed = 190; q.dmg = s.dmg * 0.3; q.pierce = 1; q.r = 4; q.life = 0.45; q.knock = 30;
      w.shoot(p, z.wid, z.x, z.y, a, null, q);
    }
    DROP.give(s); z.st = null;
  };
  const drop = (w, p, ws, S, x, y, look, r, dmg, fall, fl) => {
    const s = DROP.take();
    s.fl = fl; s.dmg = dmg; s.dur = Math.max(0.5, S.dur); s.ck = S.craterK || 0;
    const o = zo(); o.warn = true; o.look = look; o.x = x; o.y = y; o.r = r; o.dur = fall; o.dmg = dmg; o.knock = S.knock;
    o.p = p; o.wid = ws.id; o.st = s; o.onEnd = impact;
    w.zone(o);
  };
  // Drop point near a random foe in view (or the densest pack), else the aim point 90 px out. Returns w.pt-like { x, y } in PT.
  const PT = { x: 0, y: 0 };
  const spot = (w, p, S, dense, jit) => {
    const e = dense ? w.target('densest', p, S.range) : w.target('random', p, S.range);
    if (e) { PT.x = e.x + w.rng.range(-jit, jit); PT.y = e.y + w.rng.range(-jit, jit); return PT; }
    const a = w.aimDir(p); PT.x = p.x + Math.cos(a) * 90; PT.y = p.y + Math.sin(a) * 90;
    return PT;
  };
  const showerTick = (w, p, ws, S, dt) => {
    const st = ws.st;
    if (!(S.shower > 0) || (st.shT = (st.shT || 0) - dt) > 0) return;
    st.shT += 0.6;
    for (let i = 0; i < (S.shower | 0); i++) { const t = spot(w, p, S, false, 12); drop(w, p, ws, S, t.x, t.y, 'mshower', S.size * 0.5 * S.area, S.dmg * 0.4, 0.45, 0); }
  };
  ED.addWeapon({
    id: 'meteorcall', name: 'Meteor Call', icon: 'proj.fireball', look: 'meteor', support: true, role: 'horde', mode: 'random', txt: 'Meteors fall on foes near you',
    base: { dmg: 10, cd: 2.4, n: 3, pierce: 0, area: 1, speed: 0, dur: 2, knock: 140, range: 420, fall: 0.7, size: 22, dense: 0, crater: 0, craterK: 0, erupt: 0, shower: 0, shards: 0 },
    paths: [
      { id: 'volley', name: 'Volley', form: 'starfall', ranks: [
        { mods: { n: 1 }, txt: '+1 meteor' },
        { mods: { n: 1 }, txt: '+1 meteor' },
        { mods: { dense: 1 }, txt: 'One meteor hits the densest pack' }] },
      { id: 'crater', name: 'Crater', form: 'starfall', ranks: [
        { mods: { crater: 1 }, txt: 'Impacts leave burning ground' },
        { mods: { craterK: 0.3, dur: 0.5 }, txt: 'Craters 30% wider, 50% longer' },
        { mods: { erupt: 1 }, txt: 'Craters erupt again as they fade' }] },
      { id: 'shower', name: 'Shower', form: 'starfall', ranks: [
        { mods: { shower: 1 }, txt: 'Small meteors fall between volleys' },
        { mods: { shower: 1 }, txt: 'Twice the small meteors' },
        { mods: { shards: 1 }, txt: 'Impacts throw ember shards' }] },
    ],
    hybrids: [],
  }, {
    tick: showerTick,
    fire(w, p, ws, S) {
      const n = Math.max(1, S.n | 0), fl = (S.crater > 0 ? F_CRATER : 0) | (S.erupt > 0 ? F_ERUPT : 0) | (S.shards > 0 ? F_SHARDS : 0);
      for (let i = 0; i < n; i++) { const t = spot(w, p, S, i === 0 && S.dense > 0, 8); drop(w, p, ws, S, t.x, t.y, 'meteor', S.size * S.area, S.dmg, S.fall + i * 0.06, fl); }
      return true;
    },
  });
  ED.addWeapon({
    id: 'starfall', name: 'Starfall', icon: 'fx.spark.magic', look: 'star', support: true, role: 'horde', mode: 'random', evolved: true, form: true, from: 'meteorcall',
    txt: 'A constant shower of stars',
    base: { dmg: 5, cd: 0.8, n: 1, pierce: 0, area: 1, speed: 0, dur: 2, knock: 90, range: 440, fall: 0.5, size: 30, comet: 8 },
    refine: [
      { mods: { n: 1 }, txt: '+1 star per volley' },
      { mods: { comet: -4 }, txt: 'Comets fall twice as often' },
    ],
  }, {
    tick: showerTick,
    fire(w, p, ws, S) {
      const st = ws.st, n = Math.max(1, S.n | 0), fl = S.shards > 0 ? F_SHARDS : 0;
      for (let i = 0; i < n; i++) { const t = spot(w, p, S, false, 10); drop(w, p, ws, S, t.x, t.y, 'star', S.size * 0.7 * S.area, S.dmg, S.fall, fl); }
      st.k = ((st.k | 0) + 1) % Math.max(1, S.comet | 0);
      if (st.k === 0) { const t = spot(w, p, S, true, 0); drop(w, p, ws, S, t.x, t.y, 'comet', S.size * 2.2 * S.area, S.dmg * 2.5, 0.9, F_CRATER | F_ERUPT | F_SHARDS); }
      return true;
    },
  });

  // ---------------- Frost Ring / Glacier ----------------
  // A ring zone (look frostring / glacier) grows from the hero to R = S.rad x area over S.exp s (ease out); its front hits each foe once (centre distance in (prev, r + 5]):
  // S.dmg (rings after the first of a volley: 50%), push S.knock, slow [S.slowK, S.dur]. A volley is S.n rings 0.25 s apart. Ring k (counted per slot) freezes (S.dur x 0.6 s)
  // with freezeEv > 0 and k % freezeEv == 0, or always with freezeAll. shatter: a freezing ring sends a shatter ring 0.7 s behind it that hits only frozen foes: S.dmg x shatter,
  // an ice burst (22 px, 25%, slows) and a thaw. At full size: shards (8 ice shards fly out, 40%, slow), frost (a frost floor of radius R for S.dur x S.frost s, no damage: every 0.25 s
  // it slows the foes on it in the holder's view by 0.8 x slowK; look mrime). Root rings follow the hero; Glacier rings stay where they rose and hold as a frost wall for
  // S.hold s (every 0.5 s: 30% damage, no shatter, and a refreeze to foes in the band R +- 14).
  const SHATTER = { look: 'frost', knock: 40, slow: [0.5, 1.5] };
  const rimeTick = (w, z) => {
    if (z.t < z.tickT) return;
    z.tickT = z.t + 0.25;
    const q = w.foeScan(z.x, z.y, z.r), p = z.p;
    for (let i = 0; i < q.length; i++) {
      const e = q[i], rr = z.r + e.r;
      if (!e.dead && U.dist2(z.x, z.y, e.x, e.y) <= rr * rr && (!p || ED.inView(p, e.x, e.y, e.r))) w.slow(e, z.slow[0], z.slow[1]);
    }
    w.foeEnd();
  };
  const ringHit = (w, z, s, e, dmg) => {
    if (z.p && !ED.inView(z.p, e.x, e.y, e.r)) return; // statuses follow the damage rule: only inside the holder's view
    const src = w.src(z.p, z.wid, 'weapon', s.knock); src.x = z.x; src.y = z.y;
    if (s.sh) {
      if (!(e.freezeT > 0)) return;
      e.freezeT = 0; src.knock = 0;
      w.hitFoe(e, dmg * s.shatter, src);
      w.blast(z.p, z.wid, e.x, e.y, 22, s.dmg * 0.25, SHATTER);
      return;
    }
    w.hitFoe(e, dmg, src);
    if (e.dead) return;
    w.slow(e, s.slowK, s.slowT);
    if (s.freeze > 0) w.freeze(e, s.freeze);
  };
  const shardHit = (w, pr, e) => { if (!e.dead) w.slow(e, 0.5, 1.5); };
  const ringTick = (w, z) => {
    const s = z.st; if (!s) return;
    const p = z.p, tt = z.t - s.delay; if (tt < 0) return;
    const k = Math.min(1, tt / s.exp), r = s.R * U.easeOut(k), reach = r + 5;
    z.r = Math.max(2, r);
    if (!s.done) {
      const q = w.foeScan(z.x, z.y, reach);
      for (let i = 0; i < q.length; i++) {
        const e = q[i]; if (e.dead) continue;
        const d = Math.hypot(e.x - z.x, e.y - z.y);
        if (d <= s.prev || d > reach) continue;
        ringHit(w, z, s, e, s.dmg);
      }
      w.foeEnd();
      s.prev = reach;
      if (k < 1) return;
      s.done = true; s.next = z.t + 0.5;
      if (s.sh) return;
      w.hitBraziers(z.x, z.y, s.R, p);
      if (s.shards) for (let i = 0; i < 8; i++) {
        const a = i * TAU / 8 + z.id * 0.37, q2 = so();
        q2.look = 'iceshard'; q2.speed = 230; q2.dmg = s.dmg * 0.4; q2.pierce = 2; q2.r = 5; q2.life = 0.55; q2.knock = 40; q2.onHit = shardHit;
        w.shoot(p, z.wid, z.x + Math.cos(a) * s.R, z.y + Math.sin(a) * s.R, a, null, q2);
      }
      if (s.frost > 0 && s.first) { const o = zo(); o.look = 'mrime'; o.x = z.x; o.y = z.y; o.r = s.R; o.dur = s.slowT * s.frost; o.slow = s.rimeS; o.p = p; o.wid = z.wid; o.onTick = rimeTick; w.zone(o); }
    } else if (s.hold > 0 && z.t <= s.exp + s.hold && z.t >= s.next) {
      s.next = z.t + 0.5;
      const q = w.foeScan(z.x, z.y, s.R + 18);
      for (let i = 0; i < q.length; i++) {
        const e = q[i]; if (e.dead) continue;
        if (Math.abs(Math.hypot(e.x - z.x, e.y - z.y) - s.R) <= 14 + e.r) ringHit(w, z, s, e, s.dmg * 0.3);
      }
      w.foeEnd();
    }
  };
  const ringEnd = (w, z) => { if (z.st) { RING.give(z.st); z.st = null; } };
  // One ring of slot ws (sh: the shatter ring, 0.7 s late, no hold). Then the shatter ring of a freezing ring.
  const ring = (w, p, ws, S, first, sh) => {
    const st = ws.st, s = RING.take();
    if (!sh) st.rc = (st.rc | 0) + 1;
    const fz = !sh && (S.freezeAll > 0 || (S.freezeEv > 0 && st.rc % Math.max(1, S.freezeEv | 0) === 0));
    s.sh = !!sh; s.delay = sh ? 0.7 : 0; s.R = S.rad * S.area; s.exp = S.exp; s.prev = -1; s.done = false; s.next = 0; s.hold = sh ? 0 : S.hold || 0;
    s.dmg = S.dmg * (first ? 1 : 0.5); s.knock = S.knock; s.first = first && !sh;
    s.slowK = S.slowK; s.slowT = S.dur; s.freeze = fz ? S.dur * 0.6 : 0; s.shatter = S.shatter || 0; s.shards = !sh && S.shards > 0; s.frost = sh ? 0 : S.frost || 0;
    s.rimeS = pair(st, 'rimeA', S.slowK * 0.8, 0.5);
    const o = zo(); o.look = sh ? 'shatterw' : ED.WEAPONS[ws.id].look; o.x = p.x; o.y = p.y; o.r = 2; o.dur = s.delay + S.exp + s.hold + 0.3; o.p = p; o.wid = ws.id;
    o.follow = S.hold > 0 ? '' : p.pid; o.onTick = ringTick; o.onEnd = ringEnd; o.st = s;
    w.zone(o);
    if (fz && s.shatter > 0) ring(w, p, ws, S, first, true);
  };
  // Volley: the first ring at once, the rest 0.25 s apart (ws.st.left).
  const ringVolley = {
    fire(w, p, ws, S) { ring(w, p, ws, S, true); ws.st.left = (S.n | 0) - 1; ws.st.t = 0.25; return true; },
    tick(w, p, ws, S, dt) {
      const st = ws.st;
      if (!(st.left > 0) || (st.t -= dt) > 0) return;
      st.t = 0.25; st.left--;
      ring(w, p, ws, S, false);
    },
  };
  ED.addWeapon({
    id: 'frostring', name: 'Frost Ring', icon: 'fx.ice.burst', look: 'frostring', support: true, role: 'control', mode: 'around', txt: 'A ring of frost slows foes near you',
    noAmount: true,
    base: { dmg: 3, cd: 2.4, n: 1, pierce: 0, area: 1, speed: 0, dur: 1.5, knock: 70, range: 0, rad: 60, exp: 0.45, slowK: 0.4, shards: 0, frost: 0, freezeEv: 0, shatter: 0 },
    paths: [
      { id: 'reach', name: 'Reach', form: 'glacier', ranks: [
        { mods: { area: 0.2 }, txt: 'Rings 20% wider' },
        { mods: { area: 0.25 }, txt: 'Rings 25% wider' },
        { mods: { shards: 1 }, txt: 'Full rings burst into ice shards' }] },
      { id: 'chill', name: 'Chill', form: 'glacier', ranks: [
        { mods: { frost: 1.5 }, txt: 'Rings leave frost that slows' },
        { mods: { n: 1 }, txt: 'A second ring follows the first' },
        { mods: { slowK: 0.2, frost: 1.5 }, txt: 'Slow 60%, frost lasts twice as long' }] },
      { id: 'shatter', name: 'Shatter', form: 'glacier', ranks: [
        { mods: { freezeEv: 3 }, txt: 'Every 3rd ring freezes foes' },
        { mods: { shatter: 0.5 }, txt: 'A shatter ring breaks the frozen: +50%' },
        { mods: { freezeEv: -1 }, txt: 'Every 2nd ring freezes foes' }] },
    ],
    hybrids: [],
  }, ringVolley);
  ED.addWeapon({
    id: 'glacier', name: 'Glacier', icon: 'fxbig.freezing', look: 'glacier', support: true, role: 'control', mode: 'around', evolved: true, form: true, from: 'frostring',
    txt: 'Rings freeze foes and hold as walls', noAmount: true,
    base: { dmg: 15, cd: 2.2, n: 1, pierce: 0, area: 1, speed: 0, dur: 1.5, knock: 90, range: 0, rad: 60, exp: 0.55, hold: 1.2, slowK: 0.5, freezeAll: 1 },
    refine: [
      { mods: { n: 1 }, txt: '+1 ring each volley' },
      { mods: { hold: 1 }, txt: 'Frost walls hold 1 s longer' },
    ],
  }, ringVolley);
})(globalThis.ED || (globalThis.ED = {}));
