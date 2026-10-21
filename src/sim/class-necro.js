// Necromancer: Raise Legion and Bone Harvest (base kits from ED.SKILLS numbers), the minions (spawnMinion, updateAllies) and the Necromancer hook table ED.CLS.necro.
(function (ED) {
  'use strict';
  const U = ED.U, Sim = ED.Sim, C = ED.CONST;
  const W = ED.World.prototype;
  C.COMP_MUL = 0.85; // minion damage multiplier

  // Raise Legion: minions fan out around the cursor point for the part's duration.
  ED.CAST.legion = function (p, a, data, st, N) {
    const g = this.groundTarget(p, a, data, 'legion'), q = N.p.minion;
    for (let i = 0; i < q.n; i++) {
      const an = a + (i - (q.n - 1) / 2) * 0.9, m = { x: g.x + Math.cos(an) * 26, y: g.y + Math.sin(an) * 26, r: 9 };
      Sim.resolve(m, this.room, this.locked, false);
      this.spawnMinion(p, m.x, m.y, q.dur);
    }
    return { x: Math.round(g.x), y: Math.round(g.y) };
  };

  // Bone Harvest: every minion explodes where it stands and heals the Necromancer 3% each (at most 6% per cast); then new minions rise (1, or 2 with none; harvestRaise sets the count).
  ED.CAST.harvest = function (p, a, data, st, N) {
    const mine = this.allies.filter(q => q.owner === p.pid), b = N.p.burst, life = ED.Stats.skillNums('legion', st).p.minion.dur;
    for (const m of mine) {
      this.skillBlast(p, m.x, m.y, b.r, b.dmg, this.partSrc(p, N, 'burst', { knock: 90, infAdd: { shadow: 0.5 } }));
      this.emit({ t: 'boom', x: Math.round(m.x), y: Math.round(m.y), r: Math.round(b.r), k: 'bone' });
    }
    if (mine.length) { const gone = new Set(mine); this.allies = this.allies.filter(q => !gone.has(q)); this.healPlayer(p, p.maxHp * Math.min(0.06, 0.03 * mine.length)); }
    const n = st.harvestRaise || (mine.length ? 1 : 2);
    for (let i = 0; i < n; i++) { const an = a + (i - (n - 1) / 2) * 0.9; this.spawnMinion(p, p.x + Math.cos(an) * 26, p.y + Math.sin(an) * 26, life); }
    return {};
  };

  // Raises a minion for the owner (the oldest falls when the cap is full).
  W.spawnMinion = function (owner, x, y, life) {
    const st = owner.stats;
    const mine = this.allies.filter(a => a.owner === owner.pid);
    if (mine.length >= st.maxMinions) { mine.sort((a, b) => a.life - b.life); mine[0].life = 0; }
    this.allies.push({ id: U.uid(), owner: owner.pid, x, y, r: 9, life, maxLife: life, cd: 0.5, face: 1,
      dmg: ED.Stats.skillNums('legion', st).p.minion.dmg * (1 + st.minionDmg) });
    this.emit({ t: 'raise', x, y });
  };

  // Minions hit physically (untagged, no hero multiplier or crit) and infuse their owner's gates at MINION_INFUSE (+ minionInfuse); Bone Spikes burst when one expires.
  W.updateAllies = function (dt) {
    const keep = [];
    for (const a of this.allies) {
      a.life -= dt; a.cd -= dt;
      const owner = this.players.get(a.owner);
      if (a.life <= 0 || !owner) {
        if (owner && owner.stats.boneSpikes) {
          const N = ED.Stats.skillNums('legion', owner.stats);
          this.skillBlast(owner, a.x, a.y, N.p.spikes.r, N.p.spikes.dmg, this.partSrc(owner, N, 'spikes', { knock: 90, infAdd: { shadow: 0.5 } }));
          this.emit({ t: 'boom', x: Math.round(a.x), y: Math.round(a.y), r: Math.round(N.p.spikes.r), k: 'bone' });
        }
        this.emit({ t: 'puff', x: a.x, y: a.y, c: '#7dffd9' });
        continue;
      }
      const tgt = this.nearestEnemy(a.x, a.y, 400);
      let tx, ty;
      if (tgt) { tx = tgt.x; ty = tgt.y; } else { tx = owner.x + Math.cos(a.id) * 30; ty = owner.y + Math.sin(a.id) * 30; }
      const d = Math.hypot(tx - a.x, ty - a.y);
      if (tgt && d < a.r + tgt.r + 6) {
        if (a.cd <= 0) {
          a.cd = 0.7;
          const st = owner.stats, k = C.MINION_INFUSE + st.minionInfuse;
          this.hitEnemy(tgt, a.dmg * C.COMP_MUL, { p: owner, kind: 'minion', comp: true, knock: 40, kx: (tx - a.x) / (d || 1), ky: (ty - a.y) / (d || 1), raw: true, infK: k,
            infAdd: st.mInfShadow ? { shadow: Math.max(0, st.mInfShadow - st.shadowInfuse * k) } : undefined });
        }
      } else if (d > 6) {
        const dir = this.pathDir(a, tx, ty);
        Sim.moveCircle(a, dir[0] * 105 * dt, dir[1] * 105 * dt, this.room, this.locked, false);
        a.face = dir[0] >= 0 ? 1 : -1;
      }
      keep.push(a);
    }
    this.allies = keep;
  };

  ED.CLS.necro = {
    // Soul Scythe and luck: a foe the Necromancer kills may rise as a minion for 10 s (12% + the weapon's raise)
    kill(e, p, src) {
      if (!p || p.cls !== 'necro' || e.boss || src.kind === 'minionBurst') return;
      if (this.rng.chance(0.12 + (p.stats.weapon.raise || 0))) this.spawnMinion(p, e.x, e.y, 10);
    },
  };
})(globalThis.ED || (globalThis.ED = {}));
