/* M. World backend glue: public chat, online count and real songs, via Supabase.
   If config.js is empty, this file does nothing and the site stays in demo mode. */
(function () {
  const cfg = window.MWORLD || {};
  if (!cfg.url || !cfg.anonKey || !window.supabase) return;
  const sb = supabase.createClient(cfg.url, cfg.anonKey);

  /* ---------- Songs ---------- */
  const audio = new Audio();
  audio.preload = 'none';
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
  }
  function load(i, autoplay) {
    idx = (i + songs.length) % songs.length;
    audio.src = urlOf(songs[idx].file_path);
    show();
    $('fill').style.width = '0%'; $('t1').textContent = '0:00'; $('t2').textContent = '0:00';
    if (autoplay) {
      audio.play().then(() => { on = true; setIcon(true); }).catch(() => { on = false; setIcon(false); });
    }
  }
  async function loadTheme() {
    on = false; audio.pause(); audio.removeAttribute('src'); setIcon(false);
    songs = []; idx = 0;
    const id = S[cur].id;
    const { data, error } = await sb.from('songs').select('*').eq('theme', id).order('created_at', { ascending: true });
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

  audio.addEventListener('timeupdate', () => {
    if (audio.duration) $('fill').style.width = (audio.currentTime / audio.duration * 100) + '%';
    $('t1').textContent = fmt(audio.currentTime);
  });
  audio.addEventListener('loadedmetadata', () => { $('t2').textContent = fmt(audio.duration); });
  audio.addEventListener('ended', () => { if (songs.length) load(idx + 1, true); });
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

  /* ---------- Public live chat ---------- */
  const seen = new Set();
  function render(m) { addMsg(String(m.name).slice(0, 20), String(m.text).slice(0, 200), false, m.created_at); }
  async function loadChat() {
    const { data } = await sb.from('messages').select('*').order('created_at', { ascending: false }).limit(50);
    $('msgs').querySelectorAll('.m').forEach(n => n.remove());
    seen.clear();
    (data || []).reverse().forEach(m => { seen.add(m.id); render(m); });
  }
  loadChat();
  sb.channel('public-messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => {
      const m = p.new; if (!m || seen.has(m.id)) return; seen.add(m.id); render(m);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, () => loadChat())
    .subscribe();

  send = async function () {
    const t = cin.value.trim(); if (!t) return;
    if (Date.now() - last < 1500) return; last = Date.now();
    const name = ($('cname').value.trim() || 'Guest').slice(0, 20);
    const { error } = await sb.from('messages').insert({ name, text: t.slice(0, 200) });
    if (error) note('Message not sent. Try again in a moment.'); else cin.value = '';
  };
  $('csend').onclick = send;

  /* ---------- Real online count ---------- */
  clearInterval(fake);
  const key = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random());
  const pr = sb.channel('online-now', { config: { presence: { key } } });
  pr.on('presence', { event: 'sync' }, () => {
    $('live').textContent = Object.keys(pr.presenceState()).length + ' online';
  }).subscribe(st => { if (st === 'SUBSCRIBED') pr.track({ at: Date.now() }); });

  /* ---------- Simple analytics (visits and plays) ---------- */
  try {
    let vid = localStorage.getItem('mw_vid');
    if (!vid) { vid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); localStorage.setItem('mw_vid', vid); }
    if (!sessionStorage.getItem('mw_visit')) {
      sessionStorage.setItem('mw_visit', '1');
      sb.from('visits').insert({ visitor: vid, theme: S[cur].id }).then(() => {}, () => {});
    }
  } catch (e) {}
  let playedFor = null;
  audio.addEventListener('playing', () => {
    const s = songs[idx];
    if (!s || playedFor === s.id) return;
    playedFor = s.id;
    sb.from('plays').insert({ song_id: s.id }).then(() => {}, () => {});
  });

  loadTheme();
})();
