// Procedural icon set for boons, relics, upgrades and deeds. Drawn once per (icon, colour) and cached as data URLs.
(function (ED) {
  'use strict';
  const Ic = ED.Icons = {};
  const cache = {};
  let S = 64; // icon bitmap size: 128 when the sheet's icons (2.6 rem) would be upscaled, see Ic.fit
  // Picks the icon size from the root font size and the device pixel ratio (128 when 2.6 rem in device pixels exceeds 64); icons cached at the other size stay valid.
  Ic.fit = () => { const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16; S = (window.devicePixelRatio || 1) * rem * 2.6 > 64 ? 128 : 64; };

  const P = {
    sword(c) { c.beginPath(); c.moveTo(46, 12); c.lineTo(52, 12); c.lineTo(52, 18); c.lineTo(26, 44); c.lineTo(20, 38); c.closePath(); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(14, 34); c.lineTo(30, 50); c.lineWidth = 5; c.stroke(); c.lineWidth = 3; c.beginPath(); c.moveTo(20, 44); c.lineTo(12, 52); c.lineWidth = 6; c.stroke(); c.lineWidth = 3; },
    hand(c) { c.beginPath(); c.moveTo(20, 52); c.lineTo(18, 30); c.quadraticCurveTo(18, 26, 22, 26); c.lineTo(24, 36); c.lineTo(24, 16); c.quadraticCurveTo(28, 12, 30, 16); c.lineTo(30, 32); c.lineTo(32, 14); c.quadraticCurveTo(36, 10, 38, 14); c.lineTo(37, 32); c.lineTo(41, 18); c.quadraticCurveTo(45, 16, 45, 20); c.lineTo(44, 40); c.quadraticCurveTo(42, 52, 32, 54); c.closePath(); c.fill(); c.stroke(); },
    boot(c) { c.beginPath(); c.moveTo(22, 12); c.lineTo(36, 12); c.lineTo(36, 36); c.lineTo(50, 42); c.quadraticCurveTo(54, 50, 48, 52); c.lineTo(18, 52); c.lineTo(20, 36); c.closePath(); c.fill(); c.stroke(); c.beginPath(); c.moveTo(14, 26); c.lineTo(8, 26); c.moveTo(14, 34); c.lineTo(6, 34); c.stroke(); },
    heart(c) { c.beginPath(); c.moveTo(32, 52); c.bezierCurveTo(8, 36, 10, 14, 24, 14); c.quadraticCurveTo(30, 14, 32, 22); c.quadraticCurveTo(34, 14, 40, 14); c.bezierCurveTo(54, 14, 56, 36, 32, 52); c.fill(); c.stroke(); },
    heartbroken(c) { P.heart(c); c.beginPath(); c.moveTo(32, 22); c.lineTo(28, 32); c.lineTo(36, 38); c.lineTo(31, 50); c.lineWidth = 3; c.strokeStyle = '#1a0d08'; c.stroke(); },
    eye(c) { c.beginPath(); c.moveTo(8, 32); c.quadraticCurveTo(32, 8, 56, 32); c.quadraticCurveTo(32, 56, 8, 32); c.fill(); c.stroke(); c.fillStyle = '#1a0d08'; c.beginPath(); c.arc(32, 32, 9, 0, 7); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.arc(29, 29, 3, 0, 7); c.fill(); },
    shield(c) { c.beginPath(); c.moveTo(32, 10); c.lineTo(52, 16); c.quadraticCurveTo(52, 42, 32, 54); c.quadraticCurveTo(12, 42, 12, 16); c.closePath(); c.fill(); c.stroke(); c.beginPath(); c.moveTo(32, 16); c.lineTo(32, 48); c.moveTo(18, 24); c.lineTo(46, 24); c.stroke(); },
    shieldgold(c) { P.shield(c); c.fillStyle = '#fff6c8'; c.beginPath(); c.arc(32, 32, 5, 0, 7); c.fill(); },
    hourglass(c) { c.beginPath(); c.moveTo(16, 10); c.lineTo(48, 10); c.lineTo(48, 14); c.quadraticCurveTo(46, 28, 34, 32); c.quadraticCurveTo(46, 36, 48, 50); c.lineTo(48, 54); c.lineTo(16, 54); c.lineTo(16, 50); c.quadraticCurveTo(18, 36, 30, 32); c.quadraticCurveTo(18, 28, 16, 14); c.closePath(); c.fill(); c.stroke(); c.fillStyle = '#1a0d08'; c.beginPath(); c.moveTo(24, 50); c.lineTo(40, 50); c.lineTo(32, 42); c.fill(); },
    magnet(c) { c.lineWidth = 10; c.beginPath(); c.arc(32, 30, 14, Math.PI, 0); c.stroke(); c.lineWidth = 3; c.beginPath(); c.moveTo(13, 30); c.lineTo(13, 50); c.lineTo(23, 50); c.lineTo(23, 30); c.closePath(); c.fill(); c.stroke(); c.beginPath(); c.moveTo(41, 30); c.lineTo(41, 50); c.lineTo(51, 50); c.lineTo(51, 30); c.closePath(); c.fill(); c.stroke(); },
    leaf(c) { c.beginPath(); c.moveTo(12, 52); c.quadraticCurveTo(10, 14, 52, 12); c.quadraticCurveTo(54, 50, 12, 52); c.fill(); c.stroke(); c.beginPath(); c.moveTo(14, 50); c.lineTo(44, 20); c.stroke(); },
    wing(c) { c.beginPath(); c.moveTo(14, 46); c.quadraticCurveTo(14, 14, 52, 12); c.quadraticCurveTo(46, 22, 50, 24); c.quadraticCurveTo(40, 30, 46, 34); c.quadraticCurveTo(34, 38, 38, 44); c.quadraticCurveTo(26, 46, 14, 46); c.fill(); c.stroke(); },
    wingblade(c) { P.wing(c); c.beginPath(); c.moveTo(10, 54); c.lineTo(26, 38); c.lineWidth = 5; c.stroke(); c.lineWidth = 3; },
    skull(c) { c.beginPath(); c.arc(32, 28, 18, Math.PI * 0.85, Math.PI * 0.15); c.lineTo(44, 50); c.lineTo(20, 50); c.closePath(); c.fill(); c.stroke(); c.fillStyle = '#1a0d08'; c.beginPath(); c.arc(25, 30, 5, 0, 7); c.arc(39, 30, 5, 0, 7); c.fill(); c.beginPath(); c.moveTo(32, 35); c.lineTo(29, 41); c.lineTo(35, 41); c.fill(); },
    fang(c) { c.beginPath(); c.moveTo(14, 14); c.quadraticCurveTo(32, 20, 50, 14); c.lineTo(42, 24); c.lineTo(36, 52); c.lineTo(32, 28); c.lineTo(28, 52); c.lineTo(22, 24); c.closePath(); c.fill(); c.stroke(); },
    arrow(c) { c.beginPath(); c.moveTo(12, 52); c.lineTo(48, 16); c.lineWidth = 5; c.stroke(); c.lineWidth = 3; c.beginPath(); c.moveTo(52, 12); c.lineTo(38, 16); c.lineTo(48, 26); c.closePath(); c.fill(); c.stroke(); c.beginPath(); c.moveTo(12, 52); c.lineTo(10, 42); c.moveTo(12, 52); c.lineTo(22, 54); c.stroke(); },
    arrows(c) { c.save(); c.translate(-8, 4); P.arrow(c); c.restore(); c.save(); c.translate(8, -4); P.arrow(c); c.restore(); },
    arc(c) { c.lineWidth = 7; c.beginPath(); c.arc(32, 44, 26, Math.PI * 1.15, Math.PI * 1.85); c.stroke(); c.lineWidth = 3; c.beginPath(); c.arc(32, 44, 4, 0, 7); c.fill(); },
    flame(c) { c.beginPath(); c.moveTo(32, 8); c.quadraticCurveTo(48, 26, 46, 40); c.quadraticCurveTo(44, 54, 32, 54); c.quadraticCurveTo(18, 54, 18, 40); c.quadraticCurveTo(18, 30, 26, 22); c.quadraticCurveTo(26, 32, 32, 32); c.quadraticCurveTo(28, 20, 32, 8); c.fill(); c.stroke(); c.fillStyle = '#fff3c4'; c.beginPath(); c.moveTo(32, 32); c.quadraticCurveTo(40, 40, 38, 46); c.quadraticCurveTo(32, 52, 26, 46); c.quadraticCurveTo(26, 38, 32, 32); c.fill(); },
    snow(c) { c.lineWidth = 4; for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; c.beginPath(); c.moveTo(32 + Math.cos(a) * 22, 32 + Math.sin(a) * 22); c.lineTo(32 - Math.cos(a) * 22, 32 - Math.sin(a) * 22); c.stroke(); } c.lineWidth = 3; c.beginPath(); c.arc(32, 32, 6, 0, 7); c.fill(); },
    bolt(c) { c.beginPath(); c.moveTo(36, 6); c.lineTo(16, 36); c.lineTo(30, 36); c.lineTo(26, 58); c.lineTo(48, 26); c.lineTo(34, 26); c.closePath(); c.fill(); c.stroke(); },
    thorn(c) { c.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; c.lineTo(32 + Math.cos(a) * 24, 32 + Math.sin(a) * 24); c.lineTo(32 + Math.cos(a + 0.39) * 11, 32 + Math.sin(a + 0.39) * 11); } c.closePath(); c.fill(); c.stroke(); },
    cloak(c) { c.beginPath(); c.moveTo(32, 8); c.quadraticCurveTo(46, 12, 46, 26); c.lineTo(54, 54); c.lineTo(10, 54); c.lineTo(18, 26); c.quadraticCurveTo(18, 12, 32, 8); c.fill(); c.stroke(); c.fillStyle = '#1a0d08'; c.beginPath(); c.ellipse(32, 24, 9, 10, 0, 0, 7); c.fill(); c.fillStyle = '#fff'; c.fillRect(27, 23, 3, 2); c.fillRect(34, 23, 3, 2); },
    axe(c) { c.beginPath(); c.moveTo(18, 54); c.lineTo(42, 14); c.lineWidth = 5; c.stroke(); c.lineWidth = 3; c.beginPath(); c.moveTo(36, 16); c.quadraticCurveTo(54, 10, 56, 30); c.quadraticCurveTo(46, 24, 38, 30); c.closePath(); c.fill(); c.stroke(); },
    coin(c) { c.beginPath(); c.arc(32, 32, 20, 0, 7); c.fill(); c.stroke(); c.beginPath(); c.arc(32, 32, 13, 0, 7); c.stroke(); c.font = '900 18px Georgia'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#1a0d08'; c.fillText('$', 32, 33); },
    blades(c) { for (let i = 0; i < 3; i++) { c.save(); c.translate(32, 32); c.rotate(i * 2.09); c.beginPath(); c.moveTo(0, -4); c.quadraticCurveTo(14, -22, 4, -26); c.quadraticCurveTo(12, -14, -2, 4); c.closePath(); c.fill(); c.stroke(); c.restore(); } },
    orb(c) { c.beginPath(); c.arc(32, 32, 16, 0, 7); c.fill(); c.stroke(); c.fillStyle = 'rgba(255,255,255,0.8)'; c.beginPath(); c.arc(26, 26, 5, 0, 7); c.fill(); c.strokeStyle = 'rgba(255,255,255,0.5)'; c.beginPath(); c.arc(32, 32, 24, -0.5, 1.2); c.stroke(); },
    bomb(c) { c.beginPath(); c.arc(30, 36, 17, 0, 7); c.fill(); c.stroke(); c.beginPath(); c.moveTo(40, 22); c.quadraticCurveTo(46, 12, 52, 14); c.stroke(); c.fillStyle = '#ffd36b'; c.beginPath(); c.arc(52, 13, 4, 0, 7); c.fill(); },
    twin(c) { c.save(); c.translate(-7, 0); P.sword(c); c.restore(); c.save(); c.translate(64 + 7, 0); c.scale(-1, 1); P.sword(c); c.restore(); },
    twinblue(c) { P.twin(c); },
    star(c) { c.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 10 : 24, a = i * Math.PI / 5 - Math.PI / 2; c.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); } c.closePath(); c.fill(); c.stroke(); },
    drum(c) { c.beginPath(); c.ellipse(32, 22, 20, 8, 0, 0, 7); c.fill(); c.stroke(); c.beginPath(); c.moveTo(12, 22); c.lineTo(14, 44); c.quadraticCurveTo(32, 54, 50, 44); c.lineTo(52, 22); c.stroke(); c.beginPath(); c.moveTo(14, 26); c.lineTo(24, 46); c.lineTo(34, 28); c.lineTo(44, 47); c.lineTo(50, 28); c.stroke(); },
    drop(c) { c.beginPath(); c.moveTo(32, 8); c.quadraticCurveTo(50, 32, 48, 40); c.quadraticCurveTo(46, 54, 32, 54); c.quadraticCurveTo(18, 54, 16, 40); c.quadraticCurveTo(14, 32, 32, 8); c.fill(); c.stroke(); c.fillStyle = 'rgba(255,255,255,0.6)'; c.beginPath(); c.ellipse(25, 38, 3, 6, 0.3, 0, 7); c.fill(); },
    feather(c) { c.beginPath(); c.moveTo(14, 54); c.quadraticCurveTo(20, 16, 50, 10); c.quadraticCurveTo(48, 40, 18, 48); c.closePath(); c.fill(); c.stroke(); c.beginPath(); c.moveTo(12, 56); c.lineTo(44, 18); c.stroke(); },
    dagger(c) { c.beginPath(); c.moveTo(50, 10); c.lineTo(30, 38); c.lineTo(24, 34); c.closePath(); c.fill(); c.stroke(); c.beginPath(); c.moveTo(20, 30); c.lineTo(34, 42); c.lineWidth = 5; c.stroke(); c.beginPath(); c.moveTo(26, 40); c.lineTo(14, 52); c.lineWidth = 6; c.stroke(); c.lineWidth = 3; },
    sun(c) { c.beginPath(); c.arc(32, 32, 11, 0, 7); c.fill(); c.stroke(); c.lineWidth = 4; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; c.beginPath(); c.moveTo(32 + Math.cos(a) * 16, 32 + Math.sin(a) * 16); c.lineTo(32 + Math.cos(a) * 25, 32 + Math.sin(a) * 25); c.stroke(); } c.lineWidth = 3; },
    bow(c) { c.lineWidth = 5; c.beginPath(); c.arc(16, 32, 26, -1.0, 1.0); c.stroke(); c.lineWidth = 2; c.beginPath(); c.moveTo(30, 10); c.lineTo(30, 54); c.stroke(); c.lineWidth = 3; },
    potion(c) { c.beginPath(); c.moveTo(26, 10); c.lineTo(38, 10); c.lineTo(38, 22); c.quadraticCurveTo(52, 30, 50, 42); c.quadraticCurveTo(48, 54, 32, 54); c.quadraticCurveTo(16, 54, 14, 42); c.quadraticCurveTo(12, 30, 26, 22); c.closePath(); c.fill(); c.stroke(); c.fillStyle = 'rgba(255,255,255,0.55)'; c.fillRect(20, 34, 4, 10); },
    lantern(c) { c.beginPath(); c.moveTo(22, 18); c.lineTo(42, 18); c.lineTo(46, 46); c.lineTo(18, 46); c.closePath(); c.fill(); c.stroke(); c.beginPath(); c.arc(32, 14, 6, Math.PI, 0); c.stroke(); c.fillStyle = '#fff3c4'; c.beginPath(); c.ellipse(32, 33, 6, 9, 0, 0, 7); c.fill(); c.fillStyle = 'inherit'; c.strokeRect(16, 46, 32, 6); },
    gem(c) { c.beginPath(); c.moveTo(20, 14); c.lineTo(44, 14); c.lineTo(54, 26); c.lineTo(32, 54); c.lineTo(10, 26); c.closePath(); c.fill(); c.stroke(); c.beginPath(); c.moveTo(10, 26); c.lineTo(54, 26); c.moveTo(24, 26); c.lineTo(32, 54); c.lineTo(40, 26); c.stroke(); },
    mirror(c) { c.beginPath(); c.ellipse(32, 26, 15, 18, 0, 0, 7); c.fill(); c.stroke(); c.beginPath(); c.moveTo(32, 44); c.lineTo(32, 56); c.lineWidth = 6; c.stroke(); c.lineWidth = 3; c.strokeStyle = 'rgba(255,255,255,0.7)'; c.beginPath(); c.moveTo(24, 22); c.lineTo(30, 14); c.stroke(); },
    crown(c) { c.beginPath(); c.moveTo(10, 46); c.lineTo(12, 18); c.lineTo(22, 32); c.lineTo(32, 12); c.lineTo(42, 32); c.lineTo(52, 18); c.lineTo(54, 46); c.closePath(); c.fill(); c.stroke(); c.fillRect(10, 46, 44, 6); c.strokeRect(10, 46, 44, 6); },
    idol(c) { c.beginPath(); c.arc(32, 20, 10, 0, 7); c.fill(); c.stroke(); c.beginPath(); c.moveTo(20, 54); c.lineTo(24, 30); c.lineTo(40, 30); c.lineTo(44, 54); c.closePath(); c.fill(); c.stroke(); c.fillStyle = '#1a0d08'; c.fillRect(27, 18, 3, 3); c.fillRect(34, 18, 3, 3); },
    mask(c) { c.beginPath(); c.moveTo(12, 18); c.quadraticCurveTo(32, 10, 52, 18); c.quadraticCurveTo(52, 46, 32, 54); c.quadraticCurveTo(12, 46, 12, 18); c.fill(); c.stroke(); c.fillStyle = '#1a0d08'; c.beginPath(); c.moveTo(18, 26); c.lineTo(29, 30); c.lineTo(20, 34); c.closePath(); c.moveTo(46, 26); c.lineTo(35, 30); c.lineTo(44, 34); c.closePath(); c.fill(); c.beginPath(); c.moveTo(24, 44); c.lineTo(40, 44); c.stroke(); },
    banner(c) { c.beginPath(); c.moveTo(16, 8); c.lineTo(16, 58); c.lineWidth = 4; c.stroke(); c.lineWidth = 3; c.beginPath(); c.moveTo(18, 12); c.lineTo(50, 12); c.lineTo(50, 44); c.lineTo(34, 36); c.lineTo(18, 44); c.closePath(); c.fill(); c.stroke(); },
    chalice(c) { c.beginPath(); c.moveTo(14, 12); c.lineTo(50, 12); c.quadraticCurveTo(50, 36, 34, 38); c.lineTo(34, 48); c.lineTo(44, 54); c.lineTo(20, 54); c.lineTo(30, 48); c.lineTo(30, 38); c.quadraticCurveTo(14, 36, 14, 12); c.fill(); c.stroke(); c.fillStyle = '#b3123a'; c.beginPath(); c.ellipse(32, 16, 16, 4, 0, 0, 7); c.fill(); },
    scroll(c) { c.beginPath(); c.moveTo(16, 14); c.lineTo(48, 14); c.lineTo(48, 50); c.lineTo(16, 50); c.closePath(); c.fill(); c.stroke(); c.beginPath(); c.moveTo(22, 24); c.lineTo(42, 24); c.moveTo(22, 32); c.lineTo(42, 32); c.moveTo(22, 40); c.lineTo(36, 40); c.stroke(); },
    clover(c) { for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; c.beginPath(); c.arc(32 + Math.cos(a) * 11, 28 + Math.sin(a) * 11, 10, 0, 7); c.fill(); c.stroke(); } c.beginPath(); c.moveTo(32, 30); c.quadraticCurveTo(34, 48, 26, 58); c.stroke(); },
    chest(c) { c.beginPath(); c.moveTo(10, 30); c.lineTo(54, 30); c.lineTo(54, 52); c.lineTo(10, 52); c.closePath(); c.fill(); c.stroke(); c.beginPath(); c.moveTo(10, 30); c.quadraticCurveTo(10, 14, 32, 14); c.quadraticCurveTo(54, 14, 54, 30); c.fill(); c.stroke(); c.fillStyle = '#1a0d08'; c.fillRect(28, 30, 8, 10); },
    ember(c) { P.flame(c); },
    // ---- Wickdeep glyphs ----
    anvil(c) { c.beginPath(); c.moveTo(6, 22); c.lineTo(52, 22); c.lineTo(58, 22); c.lineTo(52, 30); c.quadraticCurveTo(42, 31, 40, 36); c.lineTo(42, 46); c.lineTo(50, 52); c.lineTo(14, 52); c.lineTo(22, 46); c.lineTo(24, 36); c.quadraticCurveTo(22, 31, 12, 30); c.quadraticCurveTo(8, 28, 6, 22); c.closePath(); c.fill(); c.stroke(); c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 2; c.beginPath(); c.moveTo(12, 25); c.lineTo(50, 25); c.stroke(); },
    campfire(c) { const sk = c.strokeStyle; c.strokeStyle = '#b07a42'; c.lineWidth = 7; c.beginPath(); c.moveTo(10, 54); c.lineTo(54, 42); c.moveTo(54, 54); c.lineTo(10, 42); c.stroke(); c.strokeStyle = sk; c.lineWidth = 3; c.beginPath(); c.moveTo(32, 6); c.quadraticCurveTo(48, 20, 45, 34); c.quadraticCurveTo(42, 46, 32, 46); c.quadraticCurveTo(21, 46, 19, 34); c.quadraticCurveTo(19, 26, 25, 20); c.quadraticCurveTo(26, 29, 32, 29); c.quadraticCurveTo(28, 18, 32, 6); c.fill(); c.stroke(); c.fillStyle = '#fff3c4'; c.beginPath(); c.moveTo(32, 28); c.quadraticCurveTo(40, 35, 38, 40); c.quadraticCurveTo(32, 46, 26, 40); c.quadraticCurveTo(26, 34, 32, 28); c.fill(); },
    hammer(c) { const sk = c.strokeStyle; c.strokeStyle = '#7a5530'; c.lineWidth = 7; c.beginPath(); c.moveTo(14, 54); c.lineTo(42, 24); c.stroke(); c.strokeStyle = sk; c.lineWidth = 3; c.save(); c.translate(43, 23); c.rotate(-0.72); c.beginPath(); c.rect(-16, -9, 32, 18); c.fill(); c.stroke(); c.fillStyle = 'rgba(255,255,255,0.4)'; c.fillRect(-14, -7, 28, 4); c.restore(); },
    meteor(c) { c.beginPath(); c.moveTo(6, 6); c.quadraticCurveTo(26, 8, 48, 28); c.lineTo(30, 48); c.quadraticCurveTo(10, 28, 6, 6); c.closePath(); c.globalAlpha = 0.55; c.fill(); c.globalAlpha = 1; c.stroke(); c.beginPath(); c.arc(40, 40, 15, 0, 7); c.fill(); c.stroke(); c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.arc(45, 44, 4, 0, 7); c.arc(35, 46, 2.5, 0, 7); c.fill(); c.fillStyle = 'rgba(255,255,255,0.7)'; c.beginPath(); c.arc(34, 34, 4, 0, 7); c.fill(); },
    rain(c) { const sk = c.strokeStyle, fl = c.fillStyle; for (const [x, y] of [[16, 8], [31, 4], [46, 10]]) { c.strokeStyle = fl; c.lineWidth = 3.4; c.beginPath(); c.moveTo(x + 4, y); c.lineTo(x - 2, y + 30); c.stroke(); c.strokeStyle = sk; c.lineWidth = 3; c.beginPath(); c.moveTo(x - 3, y + 42); c.lineTo(x - 9, y + 29); c.lineTo(x + 4, y + 30); c.closePath(); c.fill(); c.stroke(); } c.beginPath(); c.ellipse(32, 56, 24, 4.5, 0, 0, 7); c.globalAlpha = 0.5; c.fill(); c.globalAlpha = 1; },
    bulwark(c) { c.beginPath(); c.moveTo(32, 4); c.lineTo(55, 12); c.lineTo(53, 34); c.quadraticCurveTo(49, 50, 32, 60); c.quadraticCurveTo(15, 50, 11, 34); c.lineTo(9, 12); c.closePath(); c.fill(); c.stroke(); c.fillStyle = 'rgba(255,255,255,0.28)'; c.beginPath(); c.moveTo(32, 10); c.lineTo(32, 54); c.lineTo(15, 34); c.lineTo(14, 17); c.closePath(); c.fill(); c.fillStyle = '#fff6c8'; c.beginPath(); c.arc(32, 28, 6, 0, 7); c.fill(); c.stroke(); },
    vanish(c) { for (const [x, y, r] of [[20, 40, 11], [33, 33, 14], [46, 41, 10], [31, 46, 10]]) { c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.stroke(); } c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.arc(29, 29, 6, 0, 7); c.fill(); c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 2; c.beginPath(); c.moveTo(32, 6); c.lineTo(32, 16); c.moveTo(27, 11); c.lineTo(37, 11); c.stroke(); },
    harvest(c) { for (const s of [1, -1]) { c.save(); c.translate(32, 34); c.rotate(s * 0.78); c.beginPath(); c.rect(-22, -3.2, 44, 6.4); c.fill(); c.stroke(); for (const e of [-1, 1]) { c.beginPath(); c.arc(e * 22, -3.6, 4.4, 0, 7); c.arc(e * 22, 3.6, 4.4, 0, 7); c.fill(); c.stroke(); } c.restore(); } c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 2.2; c.beginPath(); c.moveTo(32, 4); c.lineTo(32, 11); c.moveTo(8, 12); c.lineTo(13, 17); c.moveTo(56, 12); c.lineTo(51, 17); c.stroke(); },
  };

  // colour: glyph fill. Returns an offscreen canvas.
  Ic.canvas = (name, color, size) => {
    const key = name + '|' + color + '|' + (size || S);
    if (cache[key]) return cache[key].bm || cache[key].cv; // the ImageBitmap once ready (Gecko pays per source canvas); the canvas stays for Ic.url
    const cv = document.createElement('canvas');
    cv.width = cv.height = size || S;
    const c = cv.getContext('2d');
    const k = (size || S) / S;
    c.scale(k, k);
    // medallion
    const g = c.createRadialGradient(32, 26, 4, 32, 32, 31);
    g.addColorStop(0, ED.U.mix(color, '#2a1d16', 0.55));
    g.addColorStop(1, '#120c09');
    c.fillStyle = g; c.beginPath(); c.arc(32, 32, 30, 0, 7); c.fill();
    c.strokeStyle = ED.U.mix(color, '#000000', 0.25); c.lineWidth = 2; c.beginPath(); c.arc(32, 32, 30, 0, 7); c.stroke();
    // glyph
    c.save();
    c.translate(32, 32); c.scale(0.72, 0.72); c.translate(-32, -32);
    c.fillStyle = color; c.strokeStyle = '#1a0d08'; c.lineWidth = 3; c.lineJoin = 'round'; c.lineCap = 'round';
    c.shadowColor = color; c.shadowBlur = 8 * Math.min(1, k);
    (P[name] || P.star)(c);
    c.restore();
    const e = cache[key] = { cv, bm: null, url: null };
    ED.Bmp.from(cv, (b) => { if (cache[key] === e) e.bm = b; else ED.Bmp.free(b); });
    return cv;
  };
  Ic.url = (name, color) => {
    const key = name + '|' + color + '|' + S;
    if (!cache[key]) Ic.canvas(name, color);
    const e = cache[key];
    if (!e.url) { // the first use embeds a data URL; a blob URL (shorter, one decode) replaces it for later uses once the encoder returns
      e.url = e.cv.toDataURL();
      try { e.cv.toBlob((b) => { if (b && cache[key] === e) e.url = URL.createObjectURL(b); }); } catch (err) { /* keep the data URL */ }
    }
    return e.url;
  };
  Ic.boonUrl = (id) => { const b = ED.BOONS[id]; return Ic.url(b.icon, ED.RARITY[b.rar].color); };
  Ic.relicUrl = (id) => { const r = ED.RELICS[id]; return Ic.url(r.icon, ED.RARITY[r.rar].color); };
  Ic.relicCanvas = (id, size) => { const r = ED.RELICS[id]; return Ic.canvas(r.icon, ED.RARITY[r.rar].color, size); };
})(globalThis.ED || (globalThis.ED = {}));
