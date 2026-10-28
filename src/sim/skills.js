// Hero skill (Q, one per hero) and the hero registries. Cooldowns are host-side (sim state). The E input is unbound (ignored).
// ED.addHero(def) registers ED.HEROES[cls] (def: { id, name, hp, speed, crit, sig (signature weapon id), skills: [qId], icon, col, txt }). ED.HERO_IDS order is the save / wire index: append only.
// ED.addSkill(def, cast): ED.SKILLS[id] = { id, name, icon, cd, txt, base: { dmg, r, dur, n, ... }, levels: [{ mods, txt }] x 3 }, ED.CAST[id] = cast(w, p, x, y, N, sk) where (x, y) is the
// aim point (world px), N = ED.Stats.skill numbers (damage scales with the weapon and the party level), sk the slot { id, lvl, cd, cdMax }. A cast returns false to refuse (no cooldown), else an object merged into the 'skill' event or nothing.
// ED.HOOK[cls] = { init(w, p), tick(w, p, dt), kill(w, p, e), hit(w, p, e, dealt, src), stats(p, add) } (all optional).
(function (ED) {
  'use strict';
  const W = ED.World.prototype;
  ED.HEROES = ED.HEROES || {}; ED.HERO_IDS = ['knight', 'ranger', 'pyro', 'necro', 'cleric', 'shade', 'bell'];
  ED.SKILLS = {}; ED.CAST = {}; ED.HOOK = ED.HOOK || {};
  ED.addHero = (def) => { ED.HEROES[def.id] = def; return def; };
  ED.addSkill = (def, cast) => { ED.SKILLS[def.id] = def; ED.CAST[def.id] = cast; return def; };
  ED.skillMaxLvl = (def) => 1 + (def.levels ? def.levels.length : 0);

  // Skill numbers of slot i (cached until stats, skill level or party level change).
  W.skillN = function (p, i) { const sk = p.skills[i]; return sk.N && sk.Nv === p.statsV && sk.Nl === sk.lvl && sk.Np === this.level ? sk.N : ED.Stats.skill(p, i, this.level); };

  W.updateSkills = function (dt) {
    for (const p of this.heroes) {
      const I = p.in;
      if (!this.alive(p)) { I.q = I.e = false; continue; }
      this.vclamp = p;
      for (let i = 0; i < p.skills.length; i++) {
        const sk = p.skills[i];
        if (sk.cd > 0) sk.cd -= dt;
        if (i > 0 || !I.q || sk.cd > 0) continue;
        const fn = ED.CAST[sk.id]; if (!fn) continue;
        const N = this.skillN(p, i), r = fn(this, p, I.ax, I.ay, N, sk);
        if (r === false) continue;
        sk.cdMax = N.cd; sk.cd = N.cd;
        const ev = { t: 'skill', pid: p.pid, id: sk.id, slot: i, x: Math.round(I.ax), y: Math.round(I.ay), a: p.face };
        if (r && typeof r === 'object') Object.assign(ev, r);
        this.emit(ev);
      }
      this.vclamp = null;
      I.q = I.e = false;
    }
  };
})(globalThis.ED || (globalThis.ED = {}));
