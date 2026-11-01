// Weapon runtime and registry (ARCHITECTURE §6). ED.addWeapon(def, impl) registers ED.WEAPONS[id] / ED.WIMPL[id]; ED.WEAPON_IDS is registration order (wire / card order, append only).
// Slots: p.weapons[0] = the hero weapon (spawned, fixed), [1], [2] = supports (defs with support: true, shared pool, docs/supports.md); ED.MAX_WEAPONS 3.
// Root def: paths [{ id, name, ranks: [{ mods, txt }] x 3 (shape ranks), forms: [formId, formId?] }] x 3 (supports: every path lists the support's one Form).
// Form def: { evolved: true, form: true, from: rootId, refine: [{ mods, txt }] x 2 }.
// Slot lifecycle (GAME-DESIGN §4): tune 0 -> ED.TUNE_MAX (level-up tune cards, ED.TUNE kinds, ED.TUNE_KIND_MAX each) -> path-ready -> pickPath (chest path-pick offer: ws.path, rank 1, permanent)
// -> path ranks 2 -> ED.PATH_MAX (level-up cards) -> Form-ready -> takeForm (chest Form offer: one of the path's forms; locks the slot) -> refine 1-2 (level-up cards).
// Slot ws = { id (root, then the Form once taken), root, lvl (display: 1 + tune + pr[path] + evo + fl), tune (0-5), tk: [dmg, haste, area] tune counts, path (-1 or index),
//   pr: [rank x 3] (only pr[path] is ever nonzero, 0-5), fl (refine 0-2), evo, cd, st (impl state), S (cached numbers), t0 (sim s acquired) }.
// Each tick per living hero and slot: impl.tick?(w, p, ws, S, dt); ws.cd -= dt; at <= 0 impl.fire(w, p, ws, S) -> true resets cd = S.cd and emits { t: 'shoot', pid, wid }, false retries in 0.1 s.
// Aim rule (GAME-DESIGN §3): directional patterns fire along w.aimDir(p) (the cursor), foe or no foe; targeted patterns (shells, pillars, globs, minions, the mark) pick foes and fall back to w.aimDir(p).
// Weapons fire on cooldown with no foe in range. Targeting sees only the holder's view (w.vclamp, combat.js).
(function (ED) {
  'use strict';
  const W = ED.World.prototype;
  ED.WEAPONS = {}; ED.WIMPL = {}; ED.WEAPON_IDS = [];
  ED.MAX_WEAPONS = 3; ED.MAX_PASSIVES = 6; ED.PATH_MAX = 5; ED.TUNE_MAX = 5; ED.TUNE_KIND_MAX = 3;
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
  // Form ids path i of root weapon `rid` leads to (registered ones only).
  ED.pathForms = (rid, i) => { const d = ED.WEAPONS[rid], pa = d && d.paths && d.paths[i]; return pa && pa.forms ? pa.forms.filter(id => !!ED.WEAPONS[id]) : []; };
  // Forms of root weapon `rid`, one entry per Form id: [{ id, path (first path listing it), any: [paths listing it] }].
  ED.weaponForms = (rid) => {
    const d = ED.WEAPONS[rid], out = [];
    if (!d) return out;
    (d.paths || []).forEach((pa, i) => {
      for (const id of ED.pathForms(rid, i)) { const f = out.find(x => x.id === id); if (f) f.any.push(i); else out.push({ id, path: i, any: [i] }); }
    });
    return out;
  };
  const setLvl = (ws) => { ws.lvl = 1 + ws.tune + (ws.path >= 0 ? ws.pr[ws.path] : 0) + (ws.evo ? 1 : 0) + ws.fl; };

  // Adds weapon `id` to hero p. Refused: slots full, unknown id, a root already held, a hero weapon (non-support) outside slot 0, a support beyond MAX_WEAPONS - 1 supports.
  // Returns the slot or null.
  W.addWeapon = function (p, id) {
    const d = ED.WEAPONS[id], rid = d ? ED.weaponRoot(id) : '';
    if (!d || p.weapons.length >= ED.MAX_WEAPONS || p.weapons.some(ws => ws.root === rid)) return null;
    if (ED.WEAPONS[rid].support ? p.weapons.filter(ws => ED.WEAPONS[ws.root].support).length >= ED.MAX_WEAPONS - 1 : p.weapons.length > 0) return null;
    const ws = { id, root: rid, lvl: 1, tune: 0, tk: [0, 0, 0], path: -1, pr: [0, 0, 0], fl: 0, evo: !!ED.WEAPONS[id].evolved, cd: 0.4, st: {}, S: null, Sv: -1, Sk: -1, Sid: '', t0: this.time };
    setLvl(ws);
    p.weapons.push(ws);
    const im = ED.WIMPL[id]; if (im && im.init) im.init(this, p, ws);
    return ws;
  };
  // Tune step of kind k (0 damage, 1 haste, 2 area; ED.TUNE) on slot ws: refused at ED.TUNE_MAX steps or ED.TUNE_KIND_MAX of kind k. Returns the new tune count or 0.
  W.tuneSlot = function (p, ws, k) {
    if (!(k >= 0 && k < 3) || ws.tune >= ED.TUNE_MAX || ws.tk[k] >= ED.TUNE_KIND_MAX) return 0;
    ws.tk[k]++; ws.tune++; setLvl(ws);
    return ws.tune;
  };
  // True when slot ws waits for a path pick: tune full, no path yet, the root has paths.
  W.pathReady = function (p, ws) { const d = ED.WEAPONS[ws.root]; return ws.path < 0 && ws.tune >= ED.TUNE_MAX && !!(d && d.paths && d.paths.length); };
  // Picks path i on a path-ready slot ws (permanent; rank 1). Returns true when done.
  W.pickPath = function (p, ws, i) {
    if (!this.pathReady(p, ws) || !ED.WEAPONS[ws.root].paths[i]) return false;
    ws.path = i; ws.pr[i] = 1; setLvl(ws);
    return true;
  };
  // Ranks the picked path of slot ws once (i must be ws.path; ranks 2 .. ED.PATH_MAX). Returns the new rank or 0.
  W.rankPath = function (p, ws, i) {
    if (ws.path < 0 || i !== ws.path || ws.pr[i] < 1 || ws.pr[i] >= ED.PATH_MAX) return 0;
    ws.pr[i]++; setLvl(ws);
    return ws.pr[i];
  };
  // Forms slot ws may take now: the picked path's forms once that path is at ED.PATH_MAX and no Form is taken. [{ id, path }].
  W.formsReady = function (p, ws) {
    if (ws.evo || ws.path < 0 || ws.pr[ws.path] < ED.PATH_MAX) return [];
    return ED.pathForms(ws.root, ws.path).map(id => ({ id, path: ws.path }));
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
  // Test / tool helper: builds slot ws through the lifecycle and recalcs. tune: steps (0-5, kinds round-robin damage, haste, area); path: index to pick (-1 / undefined: none;
  // tune fills to ED.TUNE_MAX first); rank: path rank 1-5 (default 1); form: index into the path's forms (-1 / undefined: none; the path ranks to ED.PATH_MAX first);
  // refine: Form refine ranks (0-2). Steps the lifecycle refuses are skipped. Returns ws.
  W.setRanks = function (p, ws, tune, path, rank, form, refine) {
    const hasPath = path >= 0, hasForm = hasPath && form >= 0, T = hasPath ? ED.TUNE_MAX : Math.min(ED.TUNE_MAX, tune | 0);
    for (let k = 0, g = 0; ws.tune < T && g < 9; k = (k + 1) % 3, g++) this.tuneSlot(p, ws, k);
    if (hasPath && (ws.path === path || this.pickPath(p, ws, path))) {
      const R = hasForm ? ED.PATH_MAX : Math.max(1, Math.min(ED.PATH_MAX, rank | 0));
      while (ws.pr[path] < R && this.rankPath(p, ws, path));
      if (hasForm) { const f = this.formsReady(p, ws)[form]; if (f && this.takeForm(p, ws, f.id)) for (let r = 0; r < (refine | 0); r++) this.refineForm(p, ws); }
    }
    this.recalc(p, false);
    return ws;
  };
  // Test / tool helper: builds slot ws up to Form `fid` (the path listing it at ED.PATH_MAX, the Form taken) with `refine` refine ranks. Returns ws.
  W.setForm = function (p, ws, fid, refine) {
    const f = ED.weaponForms(ws.root).find(x => x.id === fid);
    return f ? this.setRanks(p, ws, ED.TUNE_MAX, f.path, ED.PATH_MAX, ED.pathForms(ws.root, f.path).indexOf(fid), refine) : ws;
  };
  // Cache key of slot ws's rank state: tune kinds, path, its rank, refine (bit fields; no collisions within their ranges).
  const rkey = (ws) => ws.tk[0] | ws.tk[1] << 2 | ws.tk[2] << 4 | (ws.path + 1) << 6 | (ws.path >= 0 ? ws.pr[ws.path] : 0) << 8 | ws.fl << 11;
  // Effective numbers of slot i (cached until stats, ranks, refine or id change).
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
