// Weapon runtime and registry (ARCHITECTURE §6). ED.addWeapon(def, impl) registers ED.WEAPONS[id] / ED.WIMPL[id]; ED.WEAPON_IDS is registration order (wire / card order, append only).
// One weapon per hero: the signature. Root def: paths [{ id, name, ranks: [{ mods, txt }] x 3, form: formId | null }] x 3, hybrids [{ need: [i, j], form }] (0-2).
// Form def: { evolved: true, form: true, from: rootId, refine: [{ mods, txt }] x 2 }. A path at rank 3 unlocks its Form card; a hybrid needs both paths at rank 3; one Form per run.
// Slot ws = { id (root, then the Form once taken), root, lvl (display: 1 + sum pr + form + fl), pr: [rank x 3], fl (refine 0-2), evo, cd, st (impl state), S (cached numbers) }.
// Each tick per living hero and slot: impl.tick?(w, p, ws, S, dt); ws.cd -= dt; at <= 0 impl.fire(w, p, ws, S) -> true resets cd = S.cd and emits { t: 'shoot', pid, wid }, false retries in 0.1 s.
// Aim rule (GAME-DESIGN §3): directional patterns fire along w.aimDir(p) (the cursor), foe or no foe; targeted patterns (shells, pillars, globs, minions, the mark) pick foes and fall back to w.aimDir(p).
// Signatures fire on cooldown with no foe in range. Targeting sees only the holder's view (w.vclamp, combat.js).
(function (ED) {
  'use strict';
  const W = ED.World.prototype;
  ED.WEAPONS = {}; ED.WIMPL = {}; ED.WEAPON_IDS = [];
  ED.MAX_WEAPONS = 1; ED.MAX_PASSIVES = 6; ED.PATH_MAX = 3;
  // impl: { fire, tick?, init?(w, p, ws), kill?(w, p, ws, S, e) (any foe e its holder kills, by any source), draw? }.
  ED.addWeapon = (def, impl) => {
    if (ED.WEAPONS[def.id]) throw new Error('weapon id registered twice: ' + def.id); // ids are wire / save keys: one owner each
    ED.WEAPON_IDS.push(def.id);
    if (!def.held) def.held = def.icon; // in-world sprite the hero holds (actors.js)
    def.icon = 'icon.w.' + def.id;
    ED.WEAPONS[def.id] = def; ED.WIMPL[def.id] = impl;
    if (def.look) ED.regLook(def.look);
    return def;
  };
  // Root weapon id of a slot or weapon id.
  ED.weaponRoot = (x) => { const id = typeof x === 'string' ? x : x.root || x.id, d = ED.WEAPONS[id]; return d && d.from ? d.from : id; };
  // Forms of root weapon `rid`: [{ id, path (i or -1 hybrid), need: [i] | [i, j] }].
  ED.weaponForms = (rid) => {
    const d = ED.WEAPONS[rid], out = [];
    if (!d) return out;
    (d.paths || []).forEach((pa, i) => { if (pa.form && ED.WEAPONS[pa.form]) out.push({ id: pa.form, path: i, need: [i] }); });
    for (const h of d.hybrids || []) if (ED.WEAPONS[h.form]) out.push({ id: h.form, path: -1, need: h.need.slice() });
    return out;
  };
  const setLvl = (ws) => { ws.lvl = 1 + ws.pr[0] + ws.pr[1] + ws.pr[2] + (ws.evo ? 1 : 0) + ws.fl; };

  W.addWeapon = function (p, id) {
    if (p.weapons.length >= ED.MAX_WEAPONS || !ED.WEAPONS[id] || p.weapons.some(ws => ws.id === id)) return null;
    const ws = { id, root: ED.weaponRoot(id), lvl: 1, pr: [0, 0, 0], fl: 0, evo: !!ED.WEAPONS[id].evolved, cd: 0.4, st: {}, S: null, Sv: -1, Sk: -1, Sid: '' };
    setLvl(ws);
    p.weapons.push(ws);
    const im = ED.WIMPL[id]; if (im && im.init) im.init(this, p, ws);
    return ws;
  };
  // Ranks path i of slot ws (max ED.PATH_MAX). Returns the new rank or 0.
  W.rankPath = function (p, ws, i) {
    const pa = (ED.WEAPONS[ws.root].paths || [])[i];
    if (!pa || ws.pr[i] >= Math.min(ED.PATH_MAX, pa.ranks.length)) return 0;
    ws.pr[i]++; setLvl(ws);
    return ws.pr[i];
  };
  // Form ids slot ws may take now (none once a Form is taken): pure forms of paths at rank 3, hybrids with both paths at rank 3.
  W.formsReady = function (p, ws) {
    if (ws.evo) return [];
    return ED.weaponForms(ws.root).filter(f => f.need.every(i => ws.pr[i] >= ED.PATH_MAX));
  };
  // Takes Form `to` on slot ws: id swaps, impl state resets and re-inits, emits 'evolve' { pid, wid, from }.
  W.takeForm = function (p, ws, to) {
    if (ws.evo || !ED.WEAPONS[to]) return false;
    const from = ws.id;
    ws.id = to; ws.evo = true; ws.fl = 0; ws.st = {}; ws.cd = 0.2; ws.Sid = '';
    setLvl(ws);
    const im = ED.WIMPL[to]; if (im && im.init) im.init(this, p, ws);
    this.emit({ t: 'evolve', pid: p.pid, wid: to, from });
    return true;
  };
  // Refines the taken Form once (max def.refine.length). Returns the new refine level or 0.
  W.refineForm = function (p, ws) {
    const d = ED.WEAPONS[ws.id];
    if (!ws.evo || !d.refine || ws.fl >= d.refine.length) return 0;
    ws.fl++; setLvl(ws);
    return ws.fl;
  };
  // Test / tool helper: spends n path ranks on slot ws (path 0 first, then 1, then 2); form: also takes the first ready Form and refines it fully.
  W.setRanks = function (p, ws, n, form) {
    for (let i = 0; i < 3 && n > 0; i++) while (n > 0 && this.rankPath(p, ws, i)) n--;
    if (form) { const f = this.formsReady(p, ws)[0]; if (f && this.takeForm(p, ws, f.id)) while (this.refineForm(p, ws)); }
    this.recalc(p, false);
    return ws;
  };
  // Effective numbers of slot i (cached until stats, ranks, refine or id change).
  const rkey = (ws) => ws.pr[0] + ws.pr[1] * 4 + ws.pr[2] * 16 + ws.fl * 64;
  W.weaponS = function (p, i) { const ws = p.weapons[i]; return ws.S && ws.Sv === p.statsV && ws.Sk === rkey(ws) && ws.Sid === ws.id ? ws.S : ED.Stats.weapon(p, i); };
  ED.weaponKey = rkey;

  // Cursor aim (GAME-DESIGN §3): angle from hero p toward its aim point (p.in.ax / ay); p.mdir when that point is within 4 px of the hero.
  W.aimDir = function (p) { const I = p.in, dx = I.ax - p.x, dy = I.ay - p.y; return dx * dx + dy * dy < 16 ? p.mdir : Math.atan2(dy, dx); };
  // Kill callbacks of every weapon hero p holds (called by killFoe).
  W.weaponKill = function (p, e) {
    for (let i = 0; i < p.weapons.length; i++) { const im = ED.WIMPL[p.weapons[i].id]; if (im && im.kill) im.kill(this, p, p.weapons[i], this.weaponS(p, i), e); }
  };

  W.updateWeapons = function (dt) {
    for (const p of this.living) {
      this.vclamp = p;
      for (let i = 0; i < p.weapons.length; i++) {
        const ws = p.weapons[i], im = ED.WIMPL[ws.id];
        if (!im) continue;
        const S = this.weaponS(p, i);
        if (im.tick) im.tick(this, p, ws, S, dt);
        ws.cd -= dt;
        if (ws.cd > 0) continue;
        if (im.fire(this, p, ws, S)) { ws.cd = S.cd; this.emit({ t: 'shoot', pid: p.pid, wid: ws.id }); }
        else ws.cd = 0.1;
      }
    }
    this.vclamp = null;
  };
})(globalThis.ED || (globalThis.ED = {}));
