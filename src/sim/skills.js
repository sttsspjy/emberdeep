// Hero skill (Q, one per hero) and the hero registries. Cooldowns are host-side (sim state). The E input is unbound (ignored).
// ED.addHero(def) registers ED.HEROES[cls] (def: { id, name, hp, speed, crit, sig (signature weapon id), skills: [qId], icon, col, txt }). ED.HERO_IDS order is the save / wire index: append only.
// ED.addSkill(def, cast): ED.SKILLS[id] = { id, name, icon, cd, txt, base: { r, dur, charges, ... }, levels: [{ mods, txt }] x 3 }, ED.CAST[id] = cast(w, p, x, y, N, sk) where (x, y) is the
// aim point (world px), N = ED.Stats.skill numbers, sk the slot { id, lvl, cd, cdMax }. A cast returns false to refuse (no cooldown), else an object merged into the 'skill' event or nothing.
// Hero skills are utility: they deal no damage (push, stun, slow, flee, lure, block, heal, gem pull).
// ED.HOOK[cls] = { init(w, p), tick(w, p, dt), kill(w, p, e), hit(w, p, e, dealt, src), stats(p, add) } (all optional).
(function (ED) {
  'use strict';
  const W = ED.World.prototype, U = ED.U;
  ED.HEROES = ED.HEROES || {}; ED.HERO_IDS = ['knight', 'ranger', 'pyro', 'necro', 'cleric', 'shade', 'bell'];
  ED.SKILLS = {}; ED.CAST = {}; ED.HOOK = ED.HOOK || {};
  ED.addHero = (def) => { ED.HEROES[def.id] = def; return def; };
  ED.addSkill = (def, cast) => { ED.SKILLS[def.id] = def; ED.CAST[def.id] = cast; return def; };
  ED.skillMaxLvl = (def) => 1 + (def.levels ? def.levels.length : 0);

  // Skill numbers of slot i (cached until stats or skill level change).
  W.skillN = function (p, i) { const sk = p.skills[i]; return sk.N && sk.Nv === p.statsV && sk.Nl === sk.lvl ? sk.N : ED.Stats.skill(p, i); };

  // Charges (N.charges > 1): sk.chN = N.charges (0 when single), sk.ch stored casts, sk.rc recharge timer (one charge per N.cd s while not full), sk.gp gap after a cast (GAP s).
  // sk.cd / sk.cdMax (wire + HUD dial) = time until the next cast: the gap while a charge is stored, else the recharge. A slot turning multi-charge while ready starts full, else its running cooldown becomes the first recharge.
  const GAP = 0.3;
  const charge = (sk, cd, max, dt) => {
    if (!(sk.ch >= 0)) { sk.ch = sk.cd > 0 ? 0 : max; sk.rc = sk.cd > 0 ? sk.cd : 0; sk.gp = 0; }
    if (sk.ch < max) { sk.rc -= dt; if (sk.rc <= 0) { sk.ch++; sk.rc = sk.ch < max ? sk.rc + cd : 0; } }
    sk.gp -= dt;
    if (sk.ch > 0) { sk.cd = Math.max(0, sk.gp); sk.cdMax = GAP; } else { sk.cd = sk.rc; sk.cdMax = cd; }
  };
  // Every xp gem within r px of (x, y) flies to hero p (zero-damage gem pull of utility skills).
  W.pullGems = function (p, x, y, r) {
    const r2 = r * r;
    for (const g of this.pickups) if (!g.dead && !g.pull && g.k.charCodeAt(0) === 120 && U.dist2(x, y, g.x, g.y) <= r2) { g.pull = p.pid; g.t = 0; } // 120 'x': xp gems
  };

  W.updateSkills = function (dt) {
    for (const p of this.heroes) {
      const I = p.in;
      if (!this.alive(p)) { I.q = I.e = false; continue; }
      this.vclamp = p;
      for (let i = 0; i < p.skills.length; i++) {
        const sk = p.skills[i], N = this.skillN(p, i), max = N.charges | 0;
        sk.chN = max > 1 ? max : 0;
        if (max > 1) charge(sk, N.cd, max, dt); else if (sk.cd > 0) sk.cd -= dt;
        if (i > 0 || !I.q || sk.cd > 0) continue;
        const fn = ED.CAST[sk.id]; if (!fn) continue;
        const r = fn(this, p, I.ax, I.ay, N, sk);
        if (r === false) continue;
        if (max > 1) { sk.ch--; if (!(sk.rc > 0)) sk.rc = N.cd; sk.gp = GAP; sk.cd = sk.ch > 0 ? GAP : sk.rc; sk.cdMax = sk.ch > 0 ? GAP : N.cd; }
        else { sk.cdMax = N.cd; sk.cd = N.cd; }
        const ev = { t: 'skill', pid: p.pid, id: sk.id, slot: i, x: Math.round(I.ax), y: Math.round(I.ay), a: p.face };
        if (r && typeof r === 'object') Object.assign(ev, r);
        this.emit(ev);
      }
      this.vclamp = null;
      I.q = I.e = false;
    }
  };
})(globalThis.ED || (globalThis.ED = {}));
