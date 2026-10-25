/* M. World backend glue: public chat, online count and real songs, via Supabase.
   If config.js is empty, this file does nothing and the site stays in demo mode. */
(function () {
  const cfg = window.MWORLD || {};
  if (!cfg.url || !cfg.anonKey || !window.supabase) return;
  const sb = supabase.createClient(cfg.url, cfg.anonKey);

  const rnd = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now() + String(Math.random()).slice(2);
  function stored(k) {
    try { let v = localStorage.getItem(k); if (!v) { v = rnd(); localStorage.setItem(k, v); } return v; }
    catch (e) { return rnd(); }
  }
  const vid = stored('mw_vid');

  /* ---------- Songs ---------- */
  const audio = new Audio();
  audio.preload = 'auto';
  window.__mwAudio = audio;
  audio.setAttribute('controlsList', 'nodownload noplaybackrate');
  audio.disableRemotePlayback = true;
  document.addEventListener('contextmenu', e => { if (e.target.closest && e.target.closest('.radio, #floatPause')) e.preventDefault(); });
  audio.setAttribute('playsinline', '');
  let songs = [], idx = 0, on = false;

  const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  // Song files are private after supabase/update-v8.sql: the site asks for short-lived signed links.
  // If that is not set up yet (or signing fails) it falls back to the plain public link, so music never breaks.
  let signed = {};
  const publicUrl = p => sb.storage.from('songs').getPublicUrl(p).data.publicUrl;
  const urlOf = p => signed[p] || publicUrl(p);
  async function signAll(list) {
    try {
      const paths = list.map(x => x.file_path);
      const { data, error } = await sb.storage.from('songs').createSignedUrls(paths, 21600);
      if (error || !data) return;
      data.forEach(d => { if (d.signedUrl && !d.error) signed[d.path] = d.signedUrl; });
    } catch (e) {}
  }
  function setIcon(isOn) {
    $('play').querySelector('path').setAttribute('d', isOn ? PAUSE : PLAY);
    $('play').setAttribute('aria-label', isOn ? 'Pause' : 'Play');
    $('radio').classList.toggle('playing', isOn);
  }
  function show() {
    const s = songs[idx]; if (!s) return;
    $('track').textContent = s.title;
    $('artist').textContent = [s.artist, s.credit].filter(Boolean).join(' \u00b7 ');
    applyBg();
  }
  // Each song can have its own thumbnail (cover picture) shown in the player.
  // The big background photo always stays the theme photo.
  function applyBg() {
    const s = songs[idx], art = $('art'), hb = $('herobg');
    const url = PHOTOS[S[cur].id];
    if (!window.__wallPending) {
      if (url) { hb.style.backgroundImage = 'url("' + url + '")'; hb.hidden = false; } else hb.hidden = true;
    }
    if (s && s.wallpaper_path) {
      art.style.backgroundImage = 'url("' + sb.storage.from('wallpapers').getPublicUrl(s.wallpaper_path).data.publicUrl + '")';
      art.textContent = '';
    } else {
      art.style.backgroundImage = '';
      art.textContent = EM[S[cur].id] || '';
    }
    try { updateSession(); } catch (e) {}
  }
  let listened = 0, lastT = null, gotListen = false, gotDone = false;
  function load(i, autoplay) {
    listened = 0; lastT = null; gotListen = false; gotDone = false;
    idx = (i + songs.length) % songs.length;
    delete audio.dataset.retried;
    audio.src = urlOf(songs[idx].file_path);
    show();
    $('fill').style.width = '0%'; $('t1').textContent = '0:00'; $('t2').textContent = '0:00';
    if (autoplay) { on = true; setIcon(true); tryPlay(0); }
    updateSession();
  }
  // Phones are strict: if play() is refused right after a track change, retry once the new track is ready.
  function tryPlay(n) {
    const want = idx;
    audio.play().then(() => { if (want === idx && on) setIcon(true); }).catch(() => {
      if (!on) return;
      if (n < 2 && want === idx) {
        const retry = () => { audio.removeEventListener('canplay', retry); if (want === idx) tryPlay(n + 1); };
        audio.addEventListener('canplay', retry);
        setTimeout(() => audio.removeEventListener('canplay', retry), 8000);
      } else { on = false; setIcon(false); $('artist').textContent = 'Tap play to continue'; }
    });
  }
  // Lock-screen / notification controls keep playback alive when the phone screen is off.
  function updateSession() {
    if (!('mediaSession' in navigator) || !songs[idx] || !window.MediaMetadata) return;
    try {
      const sg = songs[idx];
      // Cover picture for the browser's media panel / phone lock screen: the song's own thumbnail,
      // otherwise the theme photo.
      let src = '';
      if (sg.wallpaper_path) src = sb.storage.from('wallpapers').getPublicUrl(sg.wallpaper_path).data.publicUrl;
      else if (PHOTOS[S[cur].id]) { try { src = new URL(PHOTOS[S[cur].id], location.href).href; } catch (e) {} }
      const meta = { title: sg.title, artist: sg.artist || 'M. World' };
      if (src) meta.artwork = [96, 128, 256, 512].map(n => ({ src, sizes: n + 'x' + n }));
      navigator.mediaSession.metadata = new MediaMetadata(meta);
    } catch (e) {}
  }
  if ('mediaSession' in navigator) {
    const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) {} };
    h('play', () => { audio.play().then(() => { on = true; setIcon(true); }).catch(() => {}); });
    h('pause', () => { audio.pause(); on = false; setIcon(false); });
    h('nexttrack', () => { if (songs.length) load(idx + 1, true); });
    h('previoustrack', () => { if (songs.length) load(idx - 1, true); });
  }
  // ---------- Share card: a picture of the current song to send on WhatsApp / Instagram ----------
  function loadImg(src) {
    return new Promise(res => {
      if (!src) return res(null);
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = () => res(im); im.onerror = () => res(null); im.src = src;
    });
  }
  function cover(ctx, im, x, y, w, h) {
    const r = Math.max(w / im.width, h / im.height), dw = im.width * r, dh = im.height * r;
    ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  function wrap(ctx, text, x, y, maxW, lh, maxLines) {
    const words = String(text).split(/\s+/); let line = '', n = 0;
    for (let i = 0; i < words.length; i++) {
      const t = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(t).width > maxW && line) {
        if (++n >= maxLines) { ctx.fillText(line.replace(/\s*\S*$/, '') + '…', x, y); return y + lh; }
        ctx.fillText(line, x, y); y += lh; line = words[i];
      } else line = t;
    }
    ctx.fillText(line, x, y); return y + lh;
  }
  async function makeCard() {
    const sg = songs[idx]; if (!sg) return null;
    const W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    try { await document.fonts.load('700 60px Poppins'); await document.fonts.load('500 36px Poppins'); } catch (e) {}
    const themeUrl = PHOTOS[S[cur].id] ? new URL(PHOTOS[S[cur].id], location.href).href : '';
    const thumbUrl = sg.wallpaper_path ? sb.storage.from('wallpapers').getPublicUrl(sg.wallpaper_path).data.publicUrl : '';
    const [bg, thumb] = await Promise.all([loadImg(themeUrl), loadImg(thumbUrl)]);
    c.fillStyle = '#1a0d08'; c.fillRect(0, 0, W, H);
    if (bg) cover(c, bg, 0, 0, W, H);
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(10,5,5,.55)'); g.addColorStop(.5, 'rgba(10,5,5,.72)'); g.addColorStop(1, 'rgba(10,5,5,.92)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // cover art
    const sz = 520, x0 = (W - sz) / 2, y0 = 190;
    c.save(); c.beginPath(); c.roundRect(x0, y0, sz, sz, 56); c.clip();
    if (thumb) cover(c, thumb, x0, y0, sz, sz);
    else { c.fillStyle = '#3a1f12'; c.fillRect(x0, y0, sz, sz); c.font = '260px serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(EM[S[cur].id] || '♪', W / 2, y0 + sz / 2 + 10); }
    c.restore();
    c.lineWidth = 4; c.strokeStyle = 'rgba(255,255,255,.55)'; c.beginPath(); c.roundRect(x0, y0, sz, sz, 56); c.stroke();
    c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = '#fff';
    c.font = '500 34px Poppins, sans-serif'; c.globalAlpha = .8; c.fillText('NOW PLAYING', W / 2, 140); c.globalAlpha = 1;
    c.font = '700 60px Poppins, sans-serif';
    let y = wrap(c, sg.title, W / 2, y0 + sz + 110, W - 160, 76, 3);
    c.font = '500 40px Poppins, sans-serif'; c.globalAlpha = .85;
    c.fillText(sg.artist || S[cur].tab, W / 2, y + 10); c.globalAlpha = 1;
    // footer
    c.font = '700 54px Poppins, sans-serif'; c.fillStyle = '#f5c66b'; c.fillText('M. World', W / 2, H - 120);
    c.font = '500 30px Poppins, sans-serif'; c.fillStyle = '#fff'; c.globalAlpha = .8;
    c.fillText(location.host + location.pathname.replace(/[^/]*$/, ''), W / 2, H - 70); c.globalAlpha = 1;
    return new Promise(res => cv.toBlob(res, 'image/png'));
  }
  $('shareBtn').onclick = async () => {
    const btn = $('shareBtn'); if (!songs.length) return;
    btn.disabled = true;
    const link = location.origin + location.pathname;
    const text = '♪ ' + songs[idx].title + ' on M. World';
    try {
      const blob = await makeCard();
      const file = blob && new File([blob], 'm-world-now-playing.png', { type: 'image/png' });
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: text + '\n' + link, title: 'M. World' });
      } else if (blob) {
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'm-world-now-playing.png';
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        try { await navigator.clipboard.writeText(text + '\n' + link); } catch (e) {}
      }
    } catch (e) { /* the person closed the share sheet */ }
    btn.disabled = false;
  };

  // ---------- Song requests ----------
  (function () {
    const dlg = $('rdlg'); if (!dlg) return;
    $('reqBtn').onclick = () => {
      $('rtheme').innerHTML = '<option value="">Any station</option>' + S.filter(t => !HIDDEN.has(t.id))
        .map(t => '<option value="' + t.id + '"' + (t.id === S[cur].id ? ' selected' : '') + '>' + t.tab + '</option>').join('');
      $('rmsg').textContent = ''; dlg.showModal();
    };
    $('rcancel').onclick = () => dlg.close();
    $('rform').addEventListener('submit', async e => {
      e.preventDefault();
      const title = $('rtitle').value.trim(); if (!title) return;
      let n = 0, day = new Date().toDateString();
      try { const o = JSON.parse(localStorage.getItem('mw_req') || '{}'); n = o.d === day ? o.n : 0; } catch (x) {}
      if (n >= 5) { $('rmsg').textContent = 'That is enough for today. Please come back tomorrow.'; return; }
      $('rsend').disabled = true;
      const { error } = await sb.from('song_requests').insert({
        title: title.slice(0, 120), artist: $('rartist').value.trim().slice(0, 80) || null,
        theme: $('rtheme').value || null, visitor: vid });
      $('rsend').disabled = false;
      if (error) { $('rmsg').textContent = 'Could not send right now. Please try again later.'; return; }
      try { localStorage.setItem('mw_req', JSON.stringify({ d: day, n: n + 1 })); } catch (x) {}
      $('rtitle').value = ''; $('rartist').value = '';
      $('rmsg').textContent = 'Thank you! Your request was sent.';
    });
  })();

  // Every time the site opens (or is refreshed) the playlist is shuffled, and the first song
  // is never the same one as last time, so listeners hear something different each visit.
  function shuffled(list, themeId) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    const key = 'mw_last_' + themeId;
    try {
      const last = localStorage.getItem(key);
      if (a.length > 1 && a[0].id === last) { const k = 1 + Math.floor(Math.random() * (a.length - 1)); [a[0], a[k]] = [a[k], a[0]]; }
      localStorage.setItem(key, a[0].id);
    } catch (e) {}
    return a;
  }
  async function loadTheme() {
    on = false; audio.pause(); audio.removeAttribute('src'); setIcon(false);
    songs = []; idx = 0;
    const id = S[cur].id;
    let { data, error } = await sb.rpc('ranked_songs', { p_theme: id });
    if (error) ({ data, error } = await sb.from('songs').select('*').eq('theme', id).order('created_at', { ascending: true }));
    if (S[cur].id !== id) return;                       // theme changed while loading
    if (error || !data || !data.length) {
      $('track').textContent = 'No songs yet';
      $('artist').textContent = 'Songs for this theme are coming soon';
      $('fill').style.width = '0%'; $('t1').textContent = '0:00'; $('t2').textContent = '0:00';
      return;
    }
    await signAll(data);
    if (S[cur].id !== id) return;
    songs = shuffled(data, id); load(0, false);
  }

  const origTune = tune;
  tune = function (i, d) { origTune(i, d); loadTheme(); applyBg(); };

  // Pause/play follows what the listener wants right now (not only what the audio is doing),
  // so a tap while a song is still loading on a slow phone connection pauses it at once.
  $('play').onclick = () => {
    if (!songs.length) return;
    if (on || !audio.paused) { on = false; audio.pause(); setIcon(false); return; }
    if (!audio.src) load(idx, false);
    on = true; setIcon(true);
    audio.play().catch(() => { on = false; setIcon(false); $('artist').textContent = 'Could not play this song'; });
  };
  $('prev').onclick = () => { if (songs.length) load(idx - 1, on); else tune(cur - 1, -1); };
  $('next').onclick = () => { if (songs.length) load(idx + 1, on); else tune(cur + 1, 1); };
  $('vol').addEventListener('click', () => { audio.muted = muted; });

  function logPlay(kind) {
    const s = songs[idx]; if (!s) return;
    sb.from('plays').insert({ song_id: s.id, kind, visitor: vid }).then(() => {}, () => {});
  }
  audio.addEventListener('timeupdate', () => {
    const t = audio.currentTime;
    if (lastT !== null && !audio.paused) { const d = t - lastT; if (d > 0 && d < 1.5) listened += d; }
    lastT = t;
    if (!gotListen && listened >= 20) { gotListen = true; logPlay('listen'); }
    if (audio.duration) $('fill').style.width = (audio.currentTime / audio.duration * 100) + '%';
    $('t1').textContent = fmt(audio.currentTime);
  });
  // The buttons always follow what the audio is really doing, even when the phone pauses it
  // itself (a call, another app, a headset being unplugged, the lock screen).
  audio.addEventListener('pause', () => { if (!audio.ended) { on = false; setIcon(false); } });
  audio.addEventListener('playing', () => { if (!audio.paused) { on = true; setIcon(true); } });
  audio.addEventListener('loadedmetadata', () => { $('t2').textContent = fmt(audio.duration); });
  audio.addEventListener('ended', () => {
    if (!songs.length) return;
    if (!gotDone && (gotListen || (audio.duration && listened >= audio.duration * 0.8))) { gotDone = true; logPlay('complete'); }
    load(idx + 1, true);
  });
  audio.addEventListener('error', () => {
    if (!audio.getAttribute('src')) return;
    // A signed link can expire if the site stays open for hours: get fresh links and retry once.
    if (songs[idx] && !audio.dataset.retried) {
      audio.dataset.retried = '1';
      const want = on;
      signAll(songs).then(() => { const t = audio.currentTime; audio.src = urlOf(songs[idx].file_path); try { audio.currentTime = t; } catch (e) {} if (want) audio.play().catch(() => {}); });
      return;
    }
    on = false; setIcon(false); $('artist').textContent = 'Could not load this song';
  });
  const bar = document.querySelector('.bar');
  bar.style.cursor = 'pointer';
  bar.addEventListener('click', e => {
    if (!audio.duration) return;
    const r = bar.getBoundingClientRect();
    audio.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * audio.duration;
  });

  /* ---------- Public live chat (fixed IDs) ---------- */
  const secret = stored('mw_secret') + stored('mw_secret2');
  let myId = null, isAdmin = false;
  async function sha(t) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
    return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
  }
  (async () => {
    try { myId = 'MW-' + (await sha(secret)).slice(0, 6).toUpperCase(); } catch (e) { myId = null; }
    try {
      const { data } = await sb.auth.getSession();
      if (data && data.session) { const r = await sb.rpc('is_admin'); if (r.data === true) isAdmin = true; }
    } catch (e) {}
    $('myid').textContent = isAdmin ? 'Admin \u2713' : (myId ? 'Your ID: ' + myId : 'Your ID: \u2013');
    loadChat();
  })();

  const seen = new Set();
  function render(m) {
    const adm = !!m.by_admin;
    const me = adm ? isAdmin : (myId !== null && m.name === myId);
    addMsg(String(m.name).slice(0, 20), String(m.text).slice(0, 200), me, m.created_at, adm);
  }
  async function loadChat() {
    const { data } = await sb.from('messages').select('id,name,text,created_at,by_admin').order('created_at', { ascending: false }).limit(50);
    $('msgs').querySelectorAll('.m').forEach(n => n.remove());
    seen.clear();
    (data || []).reverse().forEach(m => { seen.add(m.id); render(m); });
  }
  sb.channel('public-messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => {
      const m = p.new; if (!m || seen.has(m.id)) return; seen.add(m.id); render(m);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, () => loadChat())
    .subscribe();

  send = async function () {
    const t = cin.value.trim(); if (!t) return;
    if (Date.now() - last < 1500) return; last = Date.now();
    const { error } = await sb.from('messages').insert({ text: t.slice(0, 200), secret });
    if (!error) { cin.value = ''; return; }
    console.error('chat insert failed', error);
    const m = error.message || '';
    if (/slow down/.test(m)) note('Slow down a little.');
    else if (/secret|missing id|identity/.test(m) || error.code === '42703' || error.code === 'PGRST204') note('Chat setup is incomplete: run supabase/update-v2.sql in Supabase. (' + m + ')');
    else note('Message not sent: ' + m);
  };
  $('csend').onclick = send;

  /* ---------- Real online count ---------- */
  clearInterval(fake);
  const key = rnd();
  const pr = sb.channel('online-now', { config: { presence: { key } } });
  pr.on('presence', { event: 'sync' }, () => {
    $('live').textContent = Object.keys(pr.presenceState()).length + ' online';
  }).subscribe(st => { if (st === 'SUBSCRIBED') pr.track({ at: Date.now() }); });

  /* ---------- Simple analytics (visits and plays) ---------- */
  try {
    if (!sessionStorage.getItem('mw_visit')) {
      sessionStorage.setItem('mw_visit', '1');
      sb.from('visits').insert({ visitor: vid, theme: S[cur].id }).then(() => {}, () => {});
    }
  } catch (e) {}

  /* ---------- Private themes (hidden from visitors; the signed-in admin still sees them) ---------- */
  (async function () {
    try {
      const { data, error } = await sb.from('theme_settings').select('theme,is_public');
      if (error || !data) return;
      // Private themes are hidden from everyone, admin included. Add ?preview to the address to see them as the admin.
      let admin = false;
      if (/(^|[?&])preview(=|&|$)/.test(location.search)) {
        try {
          const ses = await sb.auth.getSession();
          if (ses.data && ses.data.session) { const r = await sb.rpc('is_admin'); admin = r.data === true; }
        } catch (e) {}
      }
      const priv = data.filter(t => t.is_public === false).map(t => t.theme);
      try { localStorage.setItem('mw_priv', JSON.stringify(priv)); } catch (e) {}
      HIDDEN.clear();
      if (!admin) priv.forEach(id => HIDDEN.add(id));
      syncMenu();
      [...document.getElementById('tabs').children].forEach((b, k) => {
        b.textContent = b.textContent.replace(/ \(private\)$/, '');
        if (admin && priv.includes(S[k].id)) b.textContent += ' (private)';
      });
      if (HIDDEN.has(S[cur].id)) tune(cur, 1);
    } catch (e) {}
  })();


  /* ---------- Custom wallpapers set by the admin ---------- */
  window.__applyBg = applyBg;
  (async function () {
    try {
      const { data, error } = await sb.from('wallpapers').select('theme,file_path,updated_at');
      if (!error && data) {
        const custom = {};
        data.forEach(w => {
          custom[w.theme] = sb.storage.from('wallpapers').getPublicUrl(w.file_path).data.publicUrl + '?v=' + encodeURIComponent(w.updated_at);
        });
        S.forEach(t => { const k = t.id; if (custom[k] || DEFAULT_PHOTOS[k]) PHOTOS[k] = custom[k] || DEFAULT_PHOTOS[k]; else delete PHOTOS[k]; });
        try { localStorage.setItem('mw_walls', JSON.stringify(custom)); } catch (e) {}
      }
    } catch (e) {}
    window.__wallPending = false;
    applyBg();
  })();


  loadTheme();
})();
