// Weapon runtime and registry (ARCHITECTURE §6). ED.addWeapon(def, impl) registers ED.WEAPONS[id] / ED.WIMPL[id]; ED.WEAPON_IDS is registration order (wire / card order, append only).
// Slots: p.weapons = [{ id, lvl, evo, cd, st (impl state), S (effective numbers, cached until stats / level / id change) }], max 6. Each tick per living hero and slot:
// impl.tick?(w, p, ws, S, dt); ws.cd -= dt; at <= 0 impl.fire(w, p, ws, S) -> true resets cd = S.cd and emits { t: 'shoot', pid, wid }, false retries in 0.1 s.
// No-target rule (GAME-DESIGN §3): signatures and facing-mode weapons fire on cooldown with no foe in range, along p.mdir (the last movement direction).
// Evolution: level 8 + the def.pair passive owned = ready; the next chest swaps id to def.evo (slot and level 8 kept, st reset, impl.init re-run).
(function (ED) {
  'use strict';
  const U = ED.U, W = ED.World.prototype;
  ED.WEAPONS = {}; ED.WIMPL = {}; ED.WEAPON_IDS = [];
  ED.MAX_WEAPONS = 6; ED.MAX_PASSIVES = 6; ED.WEAPON_MAX_LVL = 8;
  // def: { id, name, icon (forced to the atlas icon.w.<id>; the given icon becomes held), look, sig, mode, base, levels, pair, evo, evolved, txt (card line for a new weapon), noAmount }.
  // impl: { fire, tick?, init?(w, p, ws), kill?(w, p, ws, S, e) (any foe e its holder kills, by any source), draw? }.
  ED.addWeapon = (def, impl) => {
    if (!ED.WEAPONS[def.id]) ED.WEAPON_IDS.push(def.id);
    if (!def.held) def.held = def.icon; // in-world sprite the hero holds (actors.js)
    def.icon = 'icon.w.' + def.id;
    ED.WEAPONS[def.id] = def; ED.WIMPL[def.id] = impl;
    if (def.look) ED.regLook(def.look);
    return def;
  };
  ED.weaponMaxLvl = (def) => (def.evolved ? ED.WEAPON_MAX_LVL : Math.min(ED.WEAPON_MAX_LVL, 1 + (def.levels ? def.levels.length : 0)));

  W.addWeapon = function (p, id) {
    if (p.weapons.length >= ED.MAX_WEAPONS || !ED.WEAPONS[id] || p.weapons.some(ws => ws.id === id)) return null;
    const ws = { id, lvl: 1, evo: !!ED.WEAPONS[id].evolved, cd: 0.4, st: {}, S: null, Sv: -1, Sl: 0, Sid: '' };
    p.weapons.push(ws);
    const im = ED.WIMPL[id]; if (im && im.init) im.init(this, p, ws);
    return ws;
  };
  W.weaponReady = function (p, ws) {
    const def = ED.WEAPONS[ws.id];
    return !!(def && !def.evolved && def.evo && ED.WEAPONS[def.evo] && ws.lvl >= ED.WEAPON_MAX_LVL && def.pair && p.passives.some(ps => ps.id === def.pair));
  };
  W.evolve = function (p, ws) {
    const from = ws.id, to = ED.WEAPONS[from].evo;
    ws.id = to; ws.evo = true; ws.st = {}; ws.cd = 0.2; ws.Sid = '';
    const im = ED.WIMPL[to]; if (im && im.init) im.init(this, p, ws);
    this.emit({ t: 'evolve', pid: p.pid, wid: to, from });
  };
  // Effective numbers of slot i (cached).
  W.weaponS = function (p, i) { const ws = p.weapons[i]; return ws.S && ws.Sv === p.statsV && ws.Sl === ws.lvl && ws.Sid === ws.id ? ws.S : ED.Stats.weapon(p, i); };

  // Aim helper for fire(): 'facing' -> facingAim (p.mdir without a foe), 'around' -> p.mdir, else the angle toward the weapon's target (mode as w.target), or null when there is none.
  W.aimAngle = function (p, mode, range) {
    if (mode === 'facing') return this.facingAim(p, p.mdir, range);
    if (mode === 'around') return p.mdir;
    const t = this.target(mode, p, range);
    return t ? Math.atan2(t.y - p.y, t.x - p.x) : null;
  };

  // Facing aim (GAME-DESIGN §3): coneFoe -> angle toward the nearest foe within range and cone rad (default ED.FACING_CONE) of a0, else null;
  // nearAngle -> angle toward the nearest foe within range, else null; facingAim -> coneFoe, else nearAngle, else a0.
  ED.FACING_CONE = 1.75;
  let FA = 0, FC = 0, FX = 0, FY = 0;
  const offCone = (e) => Math.abs(U.angDiff(FA, Math.atan2(e.y - FY, e.x - FX))) > FC;
  W.coneFoe = function (p, a0, range, cone) {
    FA = a0; FC = cone || ED.FACING_CONE; FX = p.x; FY = p.y;
    const e = this.nearestFoe(p.x, p.y, range, offCone);
    return e ? Math.atan2(e.y - p.y, e.x - p.x) : null;
  };
  W.nearAngle = function (p, range) { const e = this.nearestFoe(p.x, p.y, range); return e ? Math.atan2(e.y - p.y, e.x - p.x) : null; };
  W.facingAim = function (p, a0, range, cone) {
    let a = this.coneFoe(p, a0, range, cone);
    if (a === null) a = this.nearAngle(p, range);
    return a === null ? a0 : a;
  };
  // Kill callbacks of every weapon hero p holds (called by killFoe).
  W.weaponKill = function (p, e) {
    for (let i = 0; i < p.weapons.length; i++) { const im = ED.WIMPL[p.weapons[i].id]; if (im && im.kill) im.kill(this, p, p.weapons[i], this.weaponS(p, i), e); }
  };

  W.updateWeapons = function (dt) {
    for (const p of this.living) {
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
  };
})(globalThis.ED || (globalThis.ED = {}));
