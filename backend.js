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
  audio.setAttribute('playsinline', '');
  let songs = [], idx = 0, on = false;

  const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const urlOf = p => sb.storage.from('songs').getPublicUrl(p).data.publicUrl;
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
  // Each song can have its own wallpaper; otherwise the theme photo is shown.
  function applyBg() {
    const s = songs[idx], hb = $('herobg');
    let url = PHOTOS[S[cur].id];
    if (s && s.wallpaper_path) url = sb.storage.from('wallpapers').getPublicUrl(s.wallpaper_path).data.publicUrl;
    if (url) { hb.style.backgroundImage = 'url("' + url + '")'; hb.hidden = false; } else hb.hidden = true;
  }
  let listened = 0, lastT = null, gotListen = false, gotDone = false;
  function load(i, autoplay) {
    listened = 0; lastT = null; gotListen = false; gotDone = false;
    idx = (i + songs.length) % songs.length;
    audio.src = urlOf(songs[idx].file_path);
    show();
    $('fill').style.width = '0%'; $('t1').textContent = '0:00'; $('t2').textContent = '0:00';
    if (autoplay) tryPlay(0);
    updateSession();
  }
  // Phones are strict: if play() is refused right after a track change, retry once the new track is ready.
  function tryPlay(n) {
    const want = idx;
    audio.play().then(() => { on = true; setIcon(true); }).catch(() => {
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
    try { navigator.mediaSession.metadata = new MediaMetadata({ title: songs[idx].title, artist: songs[idx].artist || 'M. World' }); } catch (e) {}
  }
  if ('mediaSession' in navigator) {
    const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) {} };
    h('play', () => { audio.play().then(() => { on = true; setIcon(true); }).catch(() => {}); });
    h('pause', () => { audio.pause(); on = false; setIcon(false); });
    h('nexttrack', () => { if (songs.length) load(idx + 1, true); });
    h('previoustrack', () => { if (songs.length) load(idx - 1, true); });
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
    songs = data; load(0, false);
  }

  const origTune = tune;
  tune = function (i) { origTune(i); loadTheme(); };

  $('play').onclick = () => {
    if (!songs.length) return;
    if (on) { audio.pause(); on = false; setIcon(false); return; }
    if (!audio.src) load(idx, false);
    audio.play().then(() => { on = true; setIcon(true); })
      .catch(() => { $('artist').textContent = 'Could not play this song'; });
  };
  $('prev').onclick = () => { if (songs.length) load(idx - 1, on); else tune(cur - 1); };
  $('next').onclick = () => { if (songs.length) load(idx + 1, on); else tune(cur + 1); };
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
  audio.addEventListener('loadedmetadata', () => { $('t2').textContent = fmt(audio.duration); });
  audio.addEventListener('ended', () => {
    if (!songs.length) return;
    if (!gotDone && (gotListen || (audio.duration && listened >= audio.duration * 0.8))) { gotDone = true; logPlay('complete'); }
    load(idx + 1, true);
  });
  audio.addEventListener('error', () => {
    if (!audio.getAttribute('src')) return;
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

  /* ---------- Custom wallpapers set by the admin ---------- */
  (async function () {
    try {
      const { data, error } = await sb.from('wallpapers').select('theme,file_path,updated_at');
      if (error || !data) return;
      data.forEach(w => {
        const u = sb.storage.from('wallpapers').getPublicUrl(w.file_path).data.publicUrl;
        PHOTOS[w.theme] = u + '?v=' + encodeURIComponent(w.updated_at);
      });
      applyBg();
    } catch (e) {}
  })();

  loadTheme();
})();
