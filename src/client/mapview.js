// The floor map (ED.MapView): one renderer for the M overlay (#ov-map) and the Tab sheet's Map tab. Slay-the-Spire layout: the start camp at the bottom, the boss at the top,
// ED.Dungeon.LANES columns, a fixed row pitch (the canvas is as tall as the floor; its viewport scrolls by wheel, drag, keys and the right stick).
// Whole UI art px (PixUI.k device px each): paths dotted (dim), solid brass (walked) or ember (the current room's exits); rooms as bevelled squares with their glyph at whole
// multiples of 16 device px, threat pips above, a moon badge on dark rooms, the reward's path badge (contract: room reward 'boon' may carry a path id). Redrawn only when the key changes.
(function (ED) {
  'use strict';
  const U = ED.U, PX = ED.PixUI;
  const $ = (id) => document.getElementById(id);
  const MV = ED.MapView = { insts: [] };
  const C = {
    ol: '#222222', here: '#e6c27a', hereB: '#fff3c4', next: '#ff8a3d', nextLock: '#8a5a32', walked: '#c9a063', path: '#6a5038', pathGone: '#2a1f17',
    visF: '#3a2e24', visB: '#8a6a44', aheadF: '#1e1712', aheadB: '#5a4a3c', goneF: '#100b08', goneB: '#2a1f17',
    dark: '#a070ff', darkF: '#22163a', elite: '#ff7a3a', threat: '#ff5a3a', focus: '#ffffff',
  };
  const START = { icon: 'campfire', color: '#c9a063', label: 'Start', badge: null, reward: null };

  // ---------------- room data ----------------
  // Reward kind and path of a room: room.reward is a kind string (or { kind, path }); a path id rides on room.rewardPath / room.reward.path. Unknown path ids read as none.
  const rewardKind = (rm) => { const r = rm && rm.reward; return r && typeof r === 'object' ? r.kind || null : r || null; };
  MV.rewardPath = (rm) => {
    if (!rm) return null;
    const r = rm.reward, id = r && typeof r === 'object' ? r.path : rm.rewardPath;
    return id && ED.PATHS && ED.PATHS[id] ? id : null;
  };
  const plain = (rm) => (rm.reward && typeof rm.reward === 'object' ? Object.assign({}, rm, { reward: rewardKind(rm) }) : rm);
  // Glyph of a room ({ icon, color, label, badge, reward }): ED.Render.roomIcon (a path boon wears its path's colour), the campfire for the start camp.
  function glyph(rm) {
    if (rm.type === 'start') return START;
    const p = MV.rewardPath(rm), q = plain(rm);
    return p ? ED.Icons.room(q, p, ED.World.REWARD_UP) : ED.Render.roomIcon(q);
  }
  // Plain name of a room: ED.Render.roomName ('Elite fight: Relics'), a path boon as '<Path> boon', an event room with its shrine.
  MV.roomName = (rm) => {
    if (!rm) return '';
    if (rm.type === 'start') return 'Start';
    const q = plain(rm), p = MV.rewardPath(rm), g = glyph(rm), rw = g && g.reward;
    let n = ED.Render.roomName(q);
    if (p && (rw === 'boon' || rw === 'epic')) n = n.replace(/: .*$/, '') + ': ' + ED.PATHS[p].name + (rw === 'epic' ? ' epic boon' : ' boon');
    if (rm.type === 'event' && g && g.label) n += ': ' + g.label;
    return n;
  };
  // Room ids reachable from room id through exits (id included).
  MV.reach = (fl, id) => {
    const seen = new Set([id]), q = [id];
    while (q.length) for (const n of fl.rooms[q.pop()].exits || []) if (!seen.has(n)) { seen.add(n); q.push(n); }
    return seen;
  };
  const hash = (a, b) => { let h = (a | 0) ^ Math.imul(b + 0x9e37, 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }; // [0, 1), stable per floor and room

  // ---------------- one map view ----------------
  // vp: the scrolling viewport (overflow-y auto) holding canvas cv; tip: the tooltip element (a sibling of vp inside a position: relative box).
  MV.create = (vp, cv, tip) => {
    const M = { vp, cv, tip, key: '', L: null, focus: -1, revealFor: null, held: {}, drag: null };
    const view = () => (ED.Game && ED.Game.s ? ED.Game.s.view : null);
    const dpr = () => window.devicePixelRatio || 1;

    // Layout in device px from the viewport width: icon size, square sides, lane and row pitch, room centres (deterministic jitter per room).
    function layout(fl, W, Hv) {
      const k = PX ? PX.k : Math.max(1, Math.round(2 * dpr())), lanes = ED.Dungeon.LANES, R = fl.rows, Wa = Math.floor(W / k);
      let ico = 16 * Math.max(2, Math.round(3 * k / 4)), sa;
      for (;;) { sa = Math.ceil(ico / k) + 6; if (ico <= 16 || lanes * (sa + 4) <= Wa) break; ico -= 16; }
      const icoB = ico + 16, sb = Math.ceil(icoB / k) + 6;
      const lp = U.clamp(Math.floor(Wa / lanes), sa + 4, Math.round(sa * 1.9)), rp = Math.round(sa * 1.75);
      const top = sb + 6, bot = sa, Ha = Math.max(top + (R + 1) * rp + bot, Math.floor(Hv / k)), oy = Math.floor((Ha - (top + (R + 1) * rp + bot)) / 2);
      const ox = Math.floor((Wa - lanes * lp) / 2), seed = fl.seed | 0, nodes = [];
      for (const r of fl.rooms) {
        const end = r.type === 'start' || r.type === 'boss', s = r.type === 'boss' ? sb : sa;
        const jx = end ? 0 : Math.round((hash(seed, r.id * 2) - 0.5) * 0.3 * lp), jy = end ? 0 : Math.round((hash(seed, r.id * 2 + 1) - 0.5) * 0.2 * rp);
        const cx = ox + Math.floor((r.lane + 0.5) * lp) + jx, cy = oy + top + (R + 1 - r.row) * rp + jy;
        nodes[r.id] = { id: r.id, row: r.row, cx, cy, s, x: cx - (s >> 1), y: cy - (s >> 1) };
      }
      return { k, ico, icoB, sa, lp, rp, W: Wa * k, H: Ha * k, nodes, bd: 16 * Math.max(1, Math.round(ico / 32)) };
    }

    // Redraws when the viewport size, grid, floor, room, lock, room states or focus change; reveals the current room once per floor and room (centred).
    M.draw = (force) => {
      const v = view(), fl = v && v.floor;
      if (!fl || !fl.rows) return;
      const d = dpr(), W = Math.floor(vp.clientWidth * d), Hv = Math.floor(vp.clientHeight * d);
      if (W < 16 || Hv < 16) return; // a hidden view measures 0 and draws nothing
      const st = v.roomState || {};
      let rs = ''; for (const id in st) { const q = st[id]; rs += (q.visited ? 1 : 0) + (q.cleared ? 4 : 0); }
      const key = [W, Hv, PX ? PX.k : 0, v.roomId, v.locked ? 1 : 0, rs, fl.seed, fl.stratum, M.focus, ED.Render.mainPath || ''].join('|');
      if (force || key !== M.key) { M.key = key; paint(v, fl, W, Hv); }
      const rk = fl.stratum + ':' + fl.seed + ':' + v.roomId;
      if (M.revealFor !== rk) { M.revealFor = rk; M.reveal(v.roomId, false); }
    };
    M.dirty = () => { M.key = ''; };

    function paint(v, fl, W, Hv) {
      const L = M.L = layout(fl, W, Hv), d = dpr(), k = L.k;
      cv.style.width = (L.W / d) + 'px'; cv.style.height = (L.H / d) + 'px';
      if (cv.width !== L.W) cv.width = L.W;
      if (cv.height !== L.H) cv.height = L.H;
      const c = cv.getContext('2d'), st = v.roomState || {}, cur = fl.rooms[v.roomId], reach = cur ? MV.reach(fl, cur.id) : new Set(), next = new Set(cur && cur.exits ? cur.exits : []);
      c.clearRect(0, 0, L.W, L.H); c.imageSmoothingEnabled = false;
      const rect = (col, x, y, w, h) => { c.fillStyle = col; c.fillRect(x * k, y * k, w * k, h * k); }; // art px
      // a path between two rooms: 2 art px steps from edge to edge; dash: 3 on, 3 off (0 = solid)
      const line = (a, b, col, dash) => {
        const A = L.nodes[a.id], B = L.nodes[b.id], dx = B.cx - A.cx, dy = B.cy - A.cy, n = Math.max(Math.abs(dx), Math.abs(dy)), len = Math.hypot(dx, dy) || 1;
        const i0 = Math.ceil((A.s / 2 + 3) * n / len), i1 = n - Math.ceil((B.s / 2 + 3) * n / len);
        c.fillStyle = col;
        for (let i = i0; i <= i1; i++) if (!dash || (i - i0) % 6 < 3) c.fillRect((Math.round(A.cx + dx * i / n) - 1) * k, (Math.round(A.cy + dy * i / n) - 1) * k, 2 * k, 2 * k);
      };
      const walked = (a, b) => st[a.id] && st[a.id].visited && st[b.id] && st[b.id].visited;
      for (const pass of [0, 1, 2]) for (const r of fl.rooms) for (const n of r.exits || []) { // dim, then walked, then the current room's exits on top
        const b = fl.rooms[n], kind = walked(r, b) ? 1 : r === cur ? 2 : 0;
        if (kind !== pass) continue;
        if (kind === 1) line(r, b, C.walked, 0);
        else if (kind === 2) line(r, b, v.locked ? C.nextLock : C.next, v.locked ? 1 : 0);
        else line(r, b, reach.has(r.id) ? C.path : C.pathGone, 1);
      }
      const badge = (name, col, x, y, alpha) => { // a bd-px glyph on an outlined backing square, top-left at art px x, y
        const s = L.bd / k + 2;
        rect(C.ol, x, y, s, s); rect('#120d0a', x + 1, y + 1, s - 2, s - 2);
        c.globalAlpha = alpha; c.drawImage(ED.Icons.canvas(name, col, L.bd), (x + 1) * k, (y + 1) * k, L.bd, L.bd); c.globalAlpha = 1;
      };
      for (const r of fl.rooms) {
        const N = L.nodes[r.id], q = st[r.id] || {}, here = r === cur, gone = !q.visited && !here && !reach.has(r.id), nx = next.has(r.id), s = N.s, x = N.x, y = N.y;
        let fill = here ? C.here : q.visited ? C.visF : gone ? C.goneF : C.aheadF;
        let edge = here ? C.hereB : nx && !v.locked ? C.next : r.dark ? (gone ? U.shade(C.dark, -0.5) : C.dark) : r.type === 'elite' || r.type === 'champion' || r.type === 'boss' ? (gone ? U.shade(C.elite, -0.55) : C.elite) : q.visited ? C.visB : gone ? C.goneB : C.aheadB;
        if (r.dark && !here) fill = U.mix(fill, C.darkF, gone ? 0.5 : 0.85);
        if (here || (nx && !v.locked)) { rect(C.ol, x - 3, y - 3, s + 6, s + 6); rect(here ? C.hereB : C.next, x - 2, y - 2, s + 4, s + 4); } // ring: gold on the current room, ember on the open next doors
        rect(C.ol, x, y, s, s); rect(edge, x + 1, y + 1, s - 2, s - 2);
        rect(fill, x + 2, y + 2, s - 4, s - 4);
        rect(U.shade(fill, 0.22), x + 2, y + 2, s - 4, 1); rect(U.shade(fill, -0.35), x + 2, y + s - 3, s - 4, 1);
        const g = glyph(r), ico = r.type === 'boss' ? L.icoB : L.ico, a = gone ? 0.3 : q.visited && !here ? 0.55 : 1;
        if (g) { c.globalAlpha = a; c.drawImage(ED.Icons.canvas(g.icon, g.color, ico), x * k + Math.floor((s * k - ico) / 2), y * k + Math.floor((s * k - ico) / 2), ico, ico); c.globalAlpha = 1; }
        const bs = L.bd / k + 2, p = MV.rewardPath(r);
        if (r.dark) badge(ED.Icons.DARK[0], ED.Icons.DARK[1], x + s - bs + 3, y - 3, gone ? 0.4 : 1);
        if (g && g.badge) badge(g.badge[0], g.badge[1], x + s - bs + 3, y + s - bs + 3, gone ? 0.4 : 1);
        if (p) badge(ED.PATHS[p].icon, ED.PATHS[p].color, g && g.badge ? x - 3 : x + s - bs + 3, y + s - bs + 3, gone ? 0.4 : 1);
        const th = q.cleared || here ? 0 : U.clamp(r.threat | 0, 0, 3);
        for (let i = 0; i < th; i++) { const px0 = x + 1 + i * 5; rect(C.ol, px0, y - 3, 5, 5); rect(gone ? U.shade(C.threat, -0.5) : C.threat, px0 + 1, y - 2, 3, 3); } // threat pips on the top-left corner
      }
      const F = L.nodes[M.focus];
      if (F) { // focus: four 2 art px corner brackets 4 art px out
        const x0 = F.x - 5, y0 = F.y - 5, x1 = F.x + F.s + 3, y1 = F.y + F.s + 3;
        for (const [bx, by, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
          rect(C.focus, sx > 0 ? bx : bx - 2, by, 4, 2); rect(C.focus, bx, sy > 0 ? by : by - 2, 2, 4);
        }
      }
      tipPaint(v, fl);
    }

    // ---------------- scroll ----------------
    // Scrolls so room id sits at the centre of the viewport (clamped); smooth when asked.
    M.reveal = (id, smooth) => {
      const N = M.L && M.L.nodes[id]; if (!N) return;
      const top = U.clamp(N.cy * M.L.k / dpr() - vp.clientHeight / 2, 0, Math.max(0, vp.scrollHeight - vp.clientHeight));
      if (smooth) vp.scrollTo({ top, behavior: 'smooth' }); else vp.scrollTop = top;
    };
    M.page = (dir) => { vp.scrollTop += dir * (vp.clientHeight * 0.85); };
    // Viewport rect of room id in CSS px relative to the visible viewport (null before the first draw).
    M.rectOf = (id) => {
      const N = M.L && M.L.nodes[id]; if (!N) return null;
      const f = M.L.k / dpr();
      return { x: N.x * f, y: N.y * f - vp.scrollTop, w: N.s * f, h: N.s * f, vw: vp.clientWidth, vh: vp.clientHeight };
    };

    // ---------------- focus and tooltip ----------------
    // Moves the focus one step: up / down to the nearest row above / below (closest in x), left / right to the next room of the same row; scrolls it into the middle.
    M.move = (dir) => {
      const v = view(), fl = v && v.floor; if (!fl || !M.L) return;
      const nodes = M.L.nodes;
      if (!nodes[M.focus]) { M.focus = v.roomId; M.draw(); M.reveal(M.focus, true); return; }
      const F = nodes[M.focus];
      let best = null, bs = Infinity;
      for (const N of nodes) {
        if (!N || N === F) continue;
        let sc;
        if (dir === 'up' || dir === 'down') { const dr = dir === 'up' ? N.row - F.row : F.row - N.row; if (dr <= 0) continue; sc = dr * 1e6 + Math.abs(N.cx - F.cx); }
        else { if (N.row !== F.row) continue; const dx = dir === 'right' ? N.cx - F.cx : F.cx - N.cx; if (dx <= 0) continue; sc = dx; }
        if (sc < bs) { bs = sc; best = N; }
      }
      if (!best) return;
      M.focus = best.id; M.draw(); M.reveal(best.id, true);
    };
    function tipPaint(v, fl) {
      const r = fl.rooms[M.focus];
      if (!tip) return;
      if (!r || !M.L) { tip.hidden = true; return; }
      const st = (v.roomState || {})[r.id] || {}, cur = fl.rooms[v.roomId], here = r === cur, nx = cur && cur.exits && cur.exits.indexOf(r.id) >= 0;
      const reach = cur ? MV.reach(fl, cur.id) : new Set();
      const state = here ? 'You are here' : nx ? (v.locked ? 'Next door: opens when this room is clear' : 'Next door') : st.visited ? 'Visited' : reach.has(r.id) ? 'Ahead' : 'Out of reach';
      const th = U.clamp(r.threat | 0, 0, 3), esc = ED.UI.esc;
      let h = `<b class="mv-tn">${esc(MV.roomName(r))}</b>`;
      if (th) h += `<span class="mv-tl">Threat <span class="mv-pips">${[0, 1, 2].map(i => `<i class="${i < th ? 'on' : ''}"></i>`).join('')}</span>${st.cleared ? ' <span class="mut">cleared</span>' : ''}</span>`;
      else if (r.type !== 'start') h += '<span class="mv-tl">No fight</span>';
      if (r.dark) h += '<span class="mv-tl mv-dk">Dark room: harder foes, better rewards</span>';
      h += `<span class="mv-tl mut">${esc(state)}</span>`;
      if (tip.innerHTML !== h) tip.innerHTML = h;
      tip.hidden = false;
      tipPlace();
    }
    function tipPlace() {
      if (!tip || tip.hidden) return;
      const R = M.rectOf(M.focus); if (!R) { tip.hidden = true; return; }
      const box = tip.offsetParent || vp.parentNode, ox = vp.offsetLeft, oy = vp.offsetTop, tw = tip.offsetWidth, tht = tip.offsetHeight, bw = box.clientWidth, gap = 8;
      let x = ox + R.x + R.w + gap; if (x + tw > ox + R.vw) x = ox + R.x - gap - tw; x = U.clamp(x, 0, Math.max(0, bw - tw));
      const y = U.clamp(oy + R.y + R.h / 2 - tht / 2, oy, Math.max(oy, oy + R.vh - tht));
      tip.style.left = Math.round(x) + 'px'; tip.style.top = Math.round(y) + 'px';
      tip.style.visibility = R.y + R.h < 0 || R.y > R.vh ? 'hidden' : '';
    }
    // Room id under a client point (squares padded 2 art px), or -1.
    function hit(cx, cy) {
      if (!M.L) return -1;
      const b = cv.getBoundingClientRect(), f = dpr() / M.L.k, x = (cx - b.left) * f, y = (cy - b.top) * f;
      for (const N of M.L.nodes) if (N && x >= N.x - 2 && x < N.x + N.s + 2 && y >= N.y - 2 && y < N.y + N.s + 2) return N.id;
      return -1;
    }
    const setFocus = (id) => { if (id !== M.focus) { M.focus = id; M.draw(); } };

    // ---------------- input ----------------
    // Keys and pad for an open view (inp = ED.Input.read()): directions move the focus (held: repeat after 0.4 s every 0.09 s), the right stick scrolls.
    M.nav = (inp, dt) => {
      for (const d of ['up', 'down', 'left', 'right']) {
        let fire = !!inp[d];
        if (ED.Input.held(d)) { if (!fire) { M.held[d] = (M.held[d] || 0) + dt; if (M.held[d] > 0.4) { M.held[d] -= 0.09; fire = true; } } } else M.held[d] = 0;
        if (fire) M.move(d);
      }
      if (inp.navY) M.move(inp.navY > 0 ? 'down' : 'up');
      if (inp.navX) M.move(inp.navX > 0 ? 'right' : 'left');
      if (inp.scrollY) vp.scrollTop += inp.scrollY * vp.clientHeight * 1.6 * dt;
    };
    // PgUp / PgDn a page, Home the top (boss), End the bottom (start); false for any other code.
    M.scrollKey = (code) => {
      if (code === 'PageDown') M.page(1); else if (code === 'PageUp') M.page(-1); else if (code === 'Home') vp.scrollTop = 0; else if (code === 'End') vp.scrollTop = vp.scrollHeight; else return false;
      return true;
    };
    vp.addEventListener('scroll', tipPlace, { passive: true });
    vp.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      M.drag = { y: e.clientY, top: vp.scrollTop, id: e.pointerId, moved: false };
    });
    vp.addEventListener('pointermove', (e) => {
      const g = M.drag;
      if (g && g.id === e.pointerId && (e.buttons & 1)) {
        if (!g.moved && Math.abs(e.clientY - g.y) > 4) { g.moved = true; try { vp.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ } vp.classList.add('drag'); setFocus(-1); }
        if (g.moved) vp.scrollTop = g.top - (e.clientY - g.y);
        return;
      }
      setFocus(hit(e.clientX, e.clientY));
    });
    const end = (e) => { if (M.drag && M.drag.id === e.pointerId) { M.drag = null; vp.classList.remove('drag'); } };
    vp.addEventListener('pointerup', end); vp.addEventListener('pointercancel', end);
    vp.addEventListener('pointerleave', () => { if (!M.drag) setFocus(-1); });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { M.key = ''; if (vp.clientWidth && ED.Game && ED.Game.s) M.draw(); }).observe(vp);
    MV.insts.push(M);
    return M;
  };
  if (PX) PX.on(() => { for (const M of MV.insts) M.dirty(); });

  // ---------------- legend ----------------
  // Room kinds (glyphs from ED.Icons), the path boons of the floor (ED.PATHS), the room states; written once per floor into el.
  MV.legend = (el, fl) => {
    if (!el) return;
    const sig = fl ? fl.stratum + ':' + fl.seed + ':' + (ED.Render.mainPath || '') : ''; // the boon glyph wears the hero's deepest path
    if (el.dataset.sig === sig && el.firstChild) return;
    el.dataset.sig = sig;
    const Ic = ED.Icons, esc = ED.UI.esc, im = (n, c) => `<img class="mv-li" alt="" src="${Ic.url(n, c)}">`, sq = (c, b) => `<i class="mv-ls" style="--c:${c};--b:${b}"></i>`;
    const rw = (k) => { const r = Ic.reward(k, ED.Render.mainPath); return [im(r[0], r[1]), 'Fight: ' + (r[3] || r[2])]; };
    const items = [rw('boon'), rw('gold'), rw('vigor'), rw('forge')];
    const paths = new Set(); if (fl) for (const r of fl.rooms) { const p = MV.rewardPath(r); if (p) paths.add(p); }
    for (const p of ED.PATH_IDS || []) if (paths.has(p)) items.push([im(ED.PATHS[p].icon, ED.PATHS[p].color), ED.PATHS[p].name + ' boon']);
    for (const [ic, col, t] of [['skullhorn', '#ff7a3a', 'Elite or champion'], ['stall', '#4fb6ff', 'Shop'], ['campfire', '#ff9a3a', 'Rest'], ['chest', '#e0a050', 'Treasure'], ['question', '#7dffd9', 'Shrine'], ['skullcrown', '#ff5a3a', 'Boss']]) items.push([im(ic, col), t]);
    items.push([im(Ic.DARK[0], Ic.DARK[1]), 'Dark room: harder foes, better rewards']);
    items.push([sq(C.here, C.hereB), 'You are here'], [sq(C.aheadF, C.next), 'Next doors'], [sq(C.visF, C.visB), 'Visited'], [sq(C.goneF, C.goneB), 'Out of reach'], [sq(C.threat, C.ol), 'Threat']);
    el.innerHTML = items.map(([i, t]) => `<span>${i}${esc(t)}</span>`).join('');
  };

  // ---------------- the M overlay ----------------
  let OV = null, headT = 0;
  const ovEl = () => $('ov-map');
  MV.open = () => !!ovEl() && !ovEl().hidden;
  function head() {
    const v = ED.Game.s.view, fl = v.floor; if (!fl) return;
    const cur = fl.rooms[v.roomId], b = ED.biomeFor(fl.stratum), rows = fl.rows | 0;
    const where = !cur ? '' : cur.type === 'boss' ? 'Boss room' : cur.type === 'start' ? 'Start' : `Room ${cur.row | 0} of ${rows}`;
    const ahead = cur ? [...MV.reach(fl, cur.id)].filter(id => id !== cur.id && fl.rooms[id].dark).length : 0;
    const t = `${U.roman(fl.stratum)} ${b.name}`, s = `${where} · ${ahead} dark ${ahead === 1 ? 'room' : 'rooms'} ahead`;
    if ($('mv-title').textContent !== t) $('mv-title').textContent = t;
    if ($('mv-where').textContent !== s) $('mv-where').textContent = s;
    const I = ED.Input, k = (a) => `<kbd>${ED.UI.esc(I.label(a))}</kbd>`;
    const f = I.device === 'pad' ? '<kbd>D-pad</kbd> rooms · <kbd>R stick</kbd> scroll · <kbd>B</kbd> close'
      : `${k('up')}${k('left')}${k('down')}${k('right')} rooms · wheel or drag scroll · <kbd>PgUp</kbd><kbd>PgDn</kbd> · ${k('mapview')} or <kbd>Esc</kbd> close`;
    if ($('mv-foot').innerHTML !== f) $('mv-foot').innerHTML = f;
    MV.legend($('mv-legend'), fl);
  }
  // Opens (on = true), closes (false) or toggles the overlay; opening centres the current room.
  MV.toggle = (on) => {
    const el = ovEl(); if (!el || !ED.Game.s) return;
    const open = on === undefined ? el.hidden : !!on;
    if (open === !el.hidden) return;
    el.hidden = !open;
    if (!OV) OV = MV.over = MV.create($('mv-vp'), $('mv-canvas'), $('mv-tip'));
    if (!open) { OV.focus = -1; $('mv-tip').hidden = true; return; }
    OV.focus = -1; OV.revealFor = null; OV.held = {};
    head(); OV.draw(true);
    if (ED.Audio) ED.Audio.play('hover');
  };
  MV.tick = (dt) => { if (!OV || !MV.open()) return; OV.draw(false); headT += dt; if (headT >= 0.25) { headT = 0; head(); } };
  MV.nav = (inp, dt) => { if (!OV) return; if (inp.back) { MV.toggle(false); return; } OV.nav(inp, dt); };
  window.addEventListener('keydown', (e) => { if (MV.open() && OV && OV.scrollKey(e.code)) e.preventDefault(); });
})(globalThis.ED || (globalThis.ED = {}));
