// PWA shell (client only): after load registers sw.js (http(s) only; on localhost / 127.0.0.1 only with ?sw=1) and posts 'check' to the controlling worker.
// The worker's 'updated' (a complete new file set is cached) reloads the page only while the title screen is up with no party, overlay or focused text field; otherwise
// the new set loads on the next launch. ED.PWA = { on, updated }.
(function (ED) {
  'use strict';
  const P = ED.PWA = { on: false, updated: false };
  const sw = typeof navigator !== 'undefined' && navigator.serviceWorker;
  const loc = typeof location !== 'undefined' ? location : null;
  if (!sw || !loc || !/^https?:$/.test(loc.protocol)) return;
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(loc.hostname) && !/[?&]sw=1(?:&|$)/.test(loc.search)) return;
  P.on = true;

  const $ = (id) => document.getElementById(id);
  const idle = () => {
    const A = ED.App, t = $('scr-title'), lb = ED.Net && ED.Net.lobby, ae = document.activeElement;
    return !!(A && A.state === 'title' && t && !t.hidden && !(lb && lb.role) && !document.querySelector('#ui .overlay:not([hidden])') &&
      !(ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')));
  };
  try {
    sw.addEventListener('message', (e) => { if (e.data !== 'updated') return; P.updated = true; if (idle()) loc.reload(); });
    window.addEventListener('load', () => {
      sw.register('sw.js', { scope: './' }).then(() => { if (sw.controller) sw.controller.postMessage('check'); }).catch(() => {});
    });
  } catch (e) { P.on = false; }
})(globalThis.ED || (globalThis.ED = {}));
