// Pyromancer: Flame Nova and Meteor (base kits from ED.SKILLS numbers) and the Pyromancer hook table ED.CLS.pyro.
(function (ED) {
  'use strict';

  // Flame Nova: a ring of fire around the hero; every foe struck takes the blast and a Burn add (pre-affinity, the adder applies the stratum's).
  ED.CAST.nova = function (p, a, data, st, N) {
    const q = N.p.blast, b = N.p.burn, ring = N.p.ring;
    this.skillBlast(p, p.x, p.y, q.r, q.dmg, this.partSrc(p, N, 'blast'), (e, dealt) => { if (e.hp > 0 && dealt > 0) this.addBurn(e, b.dmg * (1 + st.classElMul), p); });
    this.emit({ t: 'nova', x: p.x, y: p.y, r: q.r, c: '#ff7a2a' });
    if (ring.on) this.addZone({ kind: 'pfire', x: p.x, y: p.y, r: ring.r, dur: ring.dur, dps: ring.dmg, owner: p.pid, team: 0, clsEl: st.element });
    return {};
  };

  // Meteor: a friendly telegraph, then the impact (Burn add = half the impact before affinity) and a burning crater; Twin Meteor chains one more at the nearest foe.
  ED.CAST.meteor = function (p, a, data, st, N) {
    const t = this.groundTarget(p, a, data, 'meteor');
    this.castMeteor(p, t.x, t.y, N.p.impact.delay, 1, false);
    return { tx: Math.round(t.x), ty: Math.round(t.y) };
  };

  ED.World.prototype.castMeteor = function (p, x, y, delay, mul, twin) {
    const q = ED.Stats.skillNums('meteor', p.stats).p.impact;
    this.addZone({ kind: 'meteor', x, y, r: q.r, dur: delay, team: 0, owner: p.pid, custom: true,
      onEnd: (w, z) => {
        const o = w.players.get(z.owner); if (!o) return;
        const st = o.stats, N = ED.Stats.skillNums('meteor', st), im = N.p.impact, cr = N.p.crater;
        w.skillBlast(o, z.x, z.y, z.r, im.dmg * mul, w.partSrc(o, N, 'impact'), (e, dealt, pre) => { if (e.hp > 0 && dealt > 0) w.addBurn(e, pre * im.statusAdd.burn, o); });
        w.emit({ t: 'boom', x: Math.round(z.x), y: Math.round(z.y), r: Math.round(z.r), k: 'bigfire' });
        if (!twin) w.addZone({ kind: 'pfire', x: z.x, y: z.y, r: cr.r, dur: cr.dur, dps: cr.dmg, owner: o.pid, team: 0, clsEl: st.element });
        if (st.twinMeteor && !twin) {
          const tg = w.nearestEnemy(z.x, z.y, 300);
          if (tg) w.castMeteor(o, tg.x, tg.y, N.p.twin.delay, st.twinMeteor, true);
        }
      } });
  };

  ED.CLS.pyro = {};
})(globalThis.ED || (globalThis.ED = {}));
