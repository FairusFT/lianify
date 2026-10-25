/* ═══ Lianify app.js ═══ */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  // ── state ──
  let token = localStorage.getItem('bb_token') || null;
  let username = localStorage.getItem('bb_user') || '';
  let playlists = [];
  let queue = [];            // daftar lagu aktif (playlist)
  let qIndex = -1;           // posisi di queue
  let current = null;        // track aktif
  let isPlaying = false;
  let loopMode = 0;           // 0=off, 1=ulang semua, 2=ulang satu lagu
  let curPlId = null;        // playlist yang sedang dibuka di modal

  const audio = new Audio();
  audio.preload = 'metadata';

  const toastEl = $('#toast');
  let toastTimer = null;
  function toast(msg, isErr = false) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('err', isErr);
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
  }

  // ── auth ──
  function showScreen(name) {
    $('#authScreen').classList.toggle('hidden', name !== 'auth');
    $('#regScreen').classList.toggle('hidden', name !== 'reg');
    $('#app').classList.toggle('hidden', name !== 'app');
  }

  $('#showRegister').addEventListener('click', (e) => { e.preventDefault(); showScreen('reg'); });
  $('#showLogin').addEventListener('click', (e) => { e.preventDefault(); showScreen('auth'); });

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#loginMsg');
    msg.textContent = 'Memproses…';
    try {
      const r = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: $('#loginUser').value.trim(), password: $('#loginPass').value })
      });
      const d = await r.json();
      if (!r.ok) { msg.textContent = d.error || 'Gagal login'; return; }
      token = d.token; username = d.username;
      localStorage.setItem('bb_token', token);
      localStorage.setItem('bb_user', username);
      enterApp();
    } catch { msg.textContent = 'Server tidak terjangkau.'; }
  });

  $('#regForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#regMsg');
    msg.textContent = 'Memproses…';
    try {
      const r = await fetch('/api/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: $('#regUser').value.trim(), password: $('#regPass').value })
      });
      const d = await r.json();
      if (!r.ok) { msg.textContent = d.error || 'Gagal daftar'; return; }
      msg.textContent = d.message;
      msg.style.color = 'var(--accent)';
      setTimeout(() => showScreen('auth'), 1200);
    } catch { msg.textContent = 'Server tidak terjangkau.'; }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    try { await fetch('/api/logout', { method: 'POST', headers: authHeaders() }); } catch {}
    token = null;
    localStorage.removeItem('bb_token');
    localStorage.removeItem('bb_user');
    localStorage.removeItem('bb_last_track');
    audio.pause();
    showScreen('auth');
  });

  function authHeaders() {
    return { 'Authorization': 'Bearer ' + token };
  }
  async function api(path, opts = {}) {
    const r = await fetch(path, { ...opts, headers: { ...(opts.headers || {}), ...authHeaders() } });
    if (r.status === 401) {
      token = null;
      localStorage.removeItem('bb_token');
      showScreen('auth');
      throw new Error('unauthorized');
    }
    return r;
  }

  // ── app entry ──
  async function enterApp() {
    showScreen('app');
    $('#userName').textContent = username;
    $('#userAvatar').textContent = username.slice(0, 1).toUpperCase();
    await loadPlaylists();
    restoreLastTrack();
  }

  // ── playlists ──
  async function loadPlaylists() {
    const r = await api('/api/playlists');
    playlists = await r.json();
    renderGrid();
    fillPlaylistSelect();
  }

  function renderGrid() {
    const grid = $('#plGrid');
    grid.innerHTML = '';
    for (const pl of playlists) {
      const card = document.createElement('div');
      card.className = 'pl-card';
      card.innerHTML = `
        <div class="pl-cover">🎵</div>
        <div class="pl-name"></div>
        <div class="pl-count">${pl.tracks.length} lagu</div>`;
      card.querySelector('.pl-name').textContent = pl.name;
      card.addEventListener('click', () => openPlaylist(pl.id));
      grid.appendChild(card);
    }
    const add = document.createElement('div');
    add.className = 'add-pl-card';
    add.innerHTML = '<span class="plus">＋</span><span>Playlist Baru</span>';
    add.addEventListener('click', async () => {
      const name = prompt('Nama playlist baru:');
      if (!name) return;
      const r = await api('/api/playlists', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (r.ok) { await loadPlaylists(); toast('Playlist dibuat'); }
      else toast((await r.json()).error || 'Gagal', true);
    });
    grid.appendChild(add);
  }

  function fillPlaylistSelect() {
    const sel = $('#ytPlaylist');
    sel.innerHTML = '<option value="">— pilih playlist —</option>' +
      playlists.map((p) => `<option value="${p.id}"></option>`).join('');
    sel.querySelectorAll('option:not(:first-child)').forEach((o, i) => o.textContent = playlists[i].name);
  }

  // ── playlist modal ──
  function openPlaylist(id) {
    const pl = playlists.find((p) => p.id === id);
    if (!pl) return;
    curPlId = id;
    $('#plTitle').textContent = pl.name;
    const list = $('#trackList');
    list.innerHTML = '';
    if (!pl.tracks.length) {
      const empty = document.createElement('div');
      empty.className = 'track';
      empty.innerHTML = '<div class="track-info"><div class="track-title" style="color:var(--sub)">Belum ada lagu — tambahkan via menu ➕</div></div>';
      list.appendChild(empty);
    }
    pl.tracks.forEach((t, i) => {
      const row = document.createElement('div');
      row.className = 'track' + (current && current.id === t.id ? ' active' : '');
      row.innerHTML = `
        <div class="track-cover">${t.cover ? '<img src="' + coverUrl(t.cover) + '" alt="">' : '♪'}</div>
        <div class="track-info">
          <div class="track-title"></div>
          <div class="track-idx">#${i + 1}</div>
        </div>
        <div class="track-actions">
          ${current && current.id === t.id ? '<span class="now-badge">🔊</span>' : ''}
          <button class="track-del" title="Hapus lagu">🗑</button>
        </div>`;
      row.querySelector('.track-title').textContent = t.title;
      row.querySelector('.track-del').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Hapus "${t.title}"?`)) return;
        const r = await api('/api/tracks/' + t.id, { method: 'DELETE' });
        if (r.ok) {
          if (current && current.id === t.id) { stopPlayback(); }
          await loadPlaylists();
          openPlaylist(curPlId);
          toast('Lagu dihapus');
        }
      });
      row.addEventListener('click', () => playPlaylist(pl, i));
      list.appendChild(row);
    });
    $('#plModal').classList.remove('hidden');
  }

  $('#plClose').addEventListener('click', () => $('#plModal').classList.add('hidden'));
  $('#plModal').addEventListener('click', (e) => { if (e.target === e.currentTarget) $('#plModal').classList.add('hidden'); });

  $('#delPlBtn').addEventListener('click', async () => {
    const pl = playlists.find((p) => p.id === curPlId);
    if (!pl) return;
    if (!confirm(`Hapus playlist "${pl.name}" beserta ${pl.tracks.length} lagunya?`)) return;
    const r = await api('/api/playlists/' + curPlId, { method: 'DELETE' });
    if (r.ok) {
      if (current && current.playlist_id === curPlId) stopPlayback();
      curPlId = null;
      $('#plModal').classList.add('hidden');
      await loadPlaylists();
      toast('Playlist dihapus');
    }
  });

  // ── player ──
  function mediaUrl(t) {
    return '/api/media/' + encodeURIComponent(t.file) + '?token=' + encodeURIComponent(token);
  }
  function coverUrl(cover) {
    return '/api/media/' + encodeURIComponent(cover) + '?token=' + encodeURIComponent(token);
  }
  function playPlaylist(pl, startIdx) {
    queue = pl.tracks.map((t) => ({ ...t, playlist_id: pl.id }));
    if (!queue.length) return;
    qIndex = Math.max(0, Math.min(startIdx, queue.length - 1));
    loadTrack(queue[qIndex]);
  }
  function loadTrack(t) {
    current = t;
    audio.src = mediaUrl(t);
    $('#npTitle').textContent = t.title;
    $('#npSub').textContent = `Playlist · #${qIndex + 1} dari ${queue.length}`;
    const c = $('#npCover');
    c.innerHTML = t.cover ? `<img src="${coverUrl(t.cover)}" alt="">` : '♫';
    $('#playBtn').textContent = '▶';
    audio.play().then(() => {
      isPlaying = true;
      $('#playBtn').textContent = '⏸';
      saveState();
    }).catch(() => { /* autoplay bisa diblok, user klik play */ });
    $('#seek').value = 0;
    updatePlaylistModalActive();
  }
  function stopPlayback() {
    current = null; qIndex = -1; queue = [];
    audio.pause(); audio.removeAttribute('src'); audio.load();
    $('#npTitle').textContent = 'Belum ada lagu';
    $('#npSub').textContent = 'Pilih lagu untuk mulai';
    $('#npCover').innerHTML = '♫';
    $('#playBtn').textContent = '▶';
    isPlaying = false;
    localStorage.removeItem('bb_last_track');
    updatePlaylistModalActive();
  }
  function updatePlaylistModalActive() {
    if (!$('#plModal').classList.contains('hidden') && current) openPlaylist(curPlId);
  }
  function saveState() {
    if (!current) return;
    localStorage.setItem('bb_last_track', JSON.stringify({
      id: current.id, title: current.title, file: current.file, cover: current.cover,
      playlist_id: current.playlist_id, time: audio.currentTime
    }));
  }
  async function restoreLastTrack() {
    const raw = localStorage.getItem('bb_last_track');
    if (!raw) return;
    try {
      const t = JSON.parse(raw);
      const pl = playlists.find((p) => p.id === t.playlist_id);
      if (!pl) return;
      const track = pl.tracks.find((x) => x.id === t.id);
      if (!track) return;
      queue = pl.tracks.map((x) => ({ ...x, playlist_id: pl.id }));
      qIndex = Math.max(0, pl.tracks.indexOf(track));
      current = track;
      audio.src = mediaUrl(track);
      $('#npTitle').textContent = track.title;
      $('#npSub').textContent = 'Lanjut dari terakhir';
      const c = $('#npCover');
      c.innerHTML = track.cover ? `<img src="${coverUrl(track.cover)}" alt="">` : '♫';
      audio.currentTime = t.time || 0;
      $('#playBtn').textContent = '▶';
      updatePlaylistModalActive();
    } catch {}
  }

  function togglePlay() {
    if (!current) { toast('Pilih lagu dulu'); return; }
    if (audio.paused) {
      audio.play();
      isPlaying = true;
      $('#playBtn').textContent = '⏸';
    } else {
      audio.pause();
      isPlaying = false;
      $('#playBtn').textContent = '▶';
    }
    saveState();
  }
  function next() { if (queue.length) { qIndex = (qIndex + 1) % queue.length; loadTrack(queue[qIndex]); } }
  function prev() {
    if (!queue.length) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    qIndex = (qIndex - 1 + queue.length) % queue.length;
    loadTrack(queue[qIndex]);
  }

  $('#playBtn').addEventListener('click', togglePlay);
  $('#nextBtn').addEventListener('click', next);
  $('#prevBtn').addEventListener('click', prev);
  $('#loopBtn').addEventListener('click', () => {
    loopMode = (loopMode + 1) % 3;
    const icons = ['🔁', '🔁', '🔂'];
    const titles = ['Mode ulang: mati', 'Mode ulang: semua lagu', 'Mode ulang: satu lagu'];
    $('#loopBtn').textContent = icons[loopMode];
    $('#loopBtn').title = titles[loopMode];
    $('#loopBtn').style.opacity = loopMode === 0 ? '0.45' : '1';
    $('#loopBtn').style.color = loopMode === 0 ? 'var(--sub)' : 'var(--accent)';
    toast(titles[loopMode]);
  });
  // init loop button
  $('#loopBtn').style.opacity = '0.45';

  audio.addEventListener('timeupdate', () => {
    if (audio.duration) {
      $('#seek').value = (audio.currentTime / audio.duration) * 1000;
      $('#curTime').textContent = fmt(audio.currentTime);
      $('#durTime').textContent = fmt(audio.duration);
    }
  });
  audio.addEventListener('ended', () => {
    if (loopMode === 2) {
      // ulang satu lagu
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }
    if (loopMode === 1) {
      // ulang seluruh playlist — next() sudah wrap ke awal
      next();
      return;
    }
    if (queue.length > 1) next();
    else if (queue.length === 1) {
      // single lagu tanpa loop: berhenti di akhir
      isPlaying = false;
      $('#playBtn').textContent = '▶';
    }
  });
  audio.addEventListener('error', () => {
    if (current) toast('Gagal memuat audio', true);
  });
  audio.addEventListener('pause', () => { isPlaying = false; $('#playBtn').textContent = '▶'; saveState(); });
  audio.addEventListener('play', () => { isPlaying = true; $('#playBtn').textContent = '⏸'; });

  $('#seek').addEventListener('input', (e) => {
    if (audio.duration) audio.currentTime = (e.target.value / 1000) * audio.duration;
  });
  $('#volume').addEventListener('input', (e) => {
    audio.volume = e.target.value / 100;
    localStorage.setItem('bb_volume', e.target.value);
  });
  const savedVol = localStorage.getItem('bb_volume');
  if (savedVol) { audio.volume = savedVol / 100; $('#volume').value = savedVol; }

  function fmt(s) {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }

  // ── import ──
  $('#importBtn').addEventListener('click', async () => {
    const url = $('#ytUrl').value.trim();
    const playlistId = Number($('#ytPlaylist').value);
    const msg = $('#importMsg');
    if (!url) { msg.textContent = 'Isi link dulu.'; msg.classList.add('err'); return; }
    if (!playlistId) { msg.textContent = 'Pilih playlist tujuan.'; msg.classList.add('err'); return; }
    msg.textContent = '⏳ Mengunduh & konversi… (bisa 1-3 menit)';
    msg.classList.remove('err');
    $('#importBtn').disabled = true;
    try {
      const r = await api('/api/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, playlistId })
      });
      const d = await r.json();
      if (!r.ok) { msg.textContent = d.error || 'Gagal'; msg.classList.add('err'); return; }
      msg.textContent = `✓ "${d.title}" masuk playlist`;
      $('#ytUrl').value = '';
      await loadPlaylists();
    } catch (e) {
      if (e.message !== 'unauthorized') { msg.textContent = 'Server tidak terjangkau'; msg.classList.add('err'); }
    } finally {
      $('#importBtn').disabled = false;
    }
  });

  // ── navigation ──
  $$('.nav-item').forEach((n) => n.addEventListener('click', () => {
    $$('.nav-item').forEach((x) => x.classList.remove('active'));
    n.classList.add('active');
    const v = n.dataset.view;
    $('#view-playlists').classList.toggle('hidden', v !== 'playlists');
    $('#view-import').classList.toggle('hidden', v !== 'import');
    $('#viewTitle').textContent = v === 'playlists' ? 'Playlist' : 'Tambah Musik';
    $('#sidebar').classList.remove('open');
  }));

  $('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

  // ── theme ──
  const savedTheme = localStorage.getItem('bb_theme');
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  updateThemeUi();
  function updateThemeUi() {
    const dark = document.documentElement.dataset.theme === 'dark';
    $('#themeToggle').innerHTML = dark ? '☀️ <span id="themeLabel">Terang</span>' : '🌙 <span id="themeLabel">Gelap</span>';
    document.querySelector('meta[name=theme-color]').setAttribute('content', dark ? '#121212' : '#f5f5f5');
  }
  $('#themeToggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('bb_theme', next);
    updateThemeUi();
  });

  // ── service worker (playlist persist setelah browser ditutup) ──
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // ── boot ──
  if (token) {
    api('/api/me').then((r) => r.ok ? enterApp() : null).catch(() => {});
  } else {
    showScreen('auth');
  }
})();
