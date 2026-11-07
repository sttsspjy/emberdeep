// Share and invite (client only). Injects a Share button into the title menu (beside Settings / Credits) and an Invite button into the lobby code row (host, party open);
// both use navigator.share({ title, text, url }), else copy the link to the clipboard and say so in the screen's status line (title-msg / lobby-msg).
// Invite link: <game URL>#join=<CODE>. Deep link: a #join=<CODE> hash at boot (or a later hashchange on the title) opens the join screen with the code filled and,
// with a profile, joins at once; the hash is then cleared. Game URL: this page (http(s), not localhost), else the live site.
(function (ED) {
  'use strict';
  const T = ED.t, $ = (id) => document.getElementById(id);
  const LIVE = 'https://sttsspjy.github.io/emberdeep/';
  const S = ED.Share = {};

  S.gameUrl = () => {
    const l = location;
    if (!/^https?:$/.test(l.protocol) || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(l.hostname)) return LIVE;
    return l.origin + l.pathname.replace(/index\.html$/, '');
  };
  const say = (id, fn, err) => { if (ED.UI && ED.UI.say) ED.UI.say(id, fn, err); };

  // Clipboard copy: async API, else a hidden textarea + execCommand; resolves true on success.
  const copy = (s) => {
    const legacy = () => {
      const ta = document.createElement('textarea'); ta.value = s; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove(); return ok;
    };
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(s).then(() => true, () => legacy());
    return Promise.resolve(legacy());
  };
  // Native share sheet when present (needs the click's user activation); a cancel stays silent, any other failure falls back to copying the URL.
  S.send = (data, msgId, copiedFn) => {
    const fallback = () => copy(data.url).then((ok) => say(msgId, ok ? copiedFn : () => T('Copy this link: {0}', data.url), !ok));
    if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
      return navigator.share(data).catch((e) => (e && e.name === 'AbortError' ? null : fallback()));
    }
    return fallback();
  };

  const button = (id, en) => {
    const b = document.createElement('button');
    b.className = 'btn'; b.id = id; b.type = 'button'; b.setAttribute('data-i18n', en);
    return b;
  };

  S.shareGame = () => S.send({ title: 'Wickdeep', text: T('Survive the horde with me in Wickdeep.'), url: S.gameUrl() }, 'title-msg', () => T('Link copied.'));
  S.invite = () => {
    const lb = ED.Net && ED.Net.lobby, code = lb && lb.code;
    if (!code) return;
    S.send({ title: 'Wickdeep', text: T('Join my Wickdeep party. Code: {0}', code), url: S.gameUrl() + '#join=' + code }, 'lobby-msg', () => T('Invite link copied.'));
  };

  // Title: Share joins the Settings / Credits pair. Lobby: Invite after Copy, shown to the host while the party is open.
  const mount = () => {
    const pair = $('btn-credits') && $('btn-credits').parentNode;
    if (pair && !$('btn-share')) {
      const b = button('btn-share', 'Share'); b.textContent = T('Share'); b.onclick = S.shareGame; pair.appendChild(b);
    }
    const row = $('lobby-code-box');
    if (row && !$('btn-lobby-invite')) {
      const b = button('btn-lobby-invite', 'Invite'); b.textContent = T('Invite'); b.classList.add('btn-sm'); b.style.minHeight = '44px'; b.hidden = true; b.onclick = S.invite;
      row.appendChild(b);
    }
    const UI = ED.UI;
    if (UI && UI.renderLobby && !UI.renderLobby._share) {
      const base = UI.renderLobby;
      UI.renderLobby = function (st) {
        const r = base.apply(this, arguments);
        const lb = st || (ED.Net && ED.Net.lobby), b = $('btn-lobby-invite');
        if (b) b.hidden = !(lb && lb.role === 'host' && lb.status === 'open' && lb.code);
        return r;
      };
      UI.renderLobby._share = true;
    }
  };

  // #join=<CODE> -> join screen with the code; joins now when a profile exists. Returns true when the hash held a code.
  const joinCode = () => { const m = /(?:^#|&)join=([A-Za-z0-9]{5})(?:&|$)/.exec(location.hash); return m ? (ED.Net && ED.Net.cleanCode ? ED.Net.cleanCode(m[1]) : m[1].toUpperCase()) : ''; };
  S.deepLink = () => {
    const code = joinCode(), A = ED.App, UI = ED.UI;
    if (!code || !A || A.state !== 'title' || !UI) return false;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; }
    say('title-msg', ''); say('join-msg', '');
    UI.show('join');
    const inp = $('inp-join'); inp.value = code;
    if (A.hasProfile) UI.joinParty(); else { const go = $('btn-join-go'); if (go) go.focus(); }
    return true;
  };

  const boot = () => {
    mount();
    let n = 0;
    const wait = () => { // the app reaches 'title' after main.js boots; give up after ~30 s
      if (ED.App && ED.App.state === 'title') { S.deepLink(); return; }
      if (++n < 300) setTimeout(wait, 100);
    };
    if (joinCode()) wait();
    window.addEventListener('hashchange', () => { if (joinCode()) S.deepLink(); });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(globalThis.ED || (globalThis.ED = {}));
