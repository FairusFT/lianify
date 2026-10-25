// Music App — Express + SQLite + bcrypt + yt-dlp
// Fitur: multi-akun (maks 4), anti brute-force (5x → lock 15 menit),
// YouTube→MP3 (NCS/royalti-bebas), playlist, Spotify-like UI, dark/light.
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { execFile } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3006;
const HOST = '0.0.0.0';
const ROOT = __dirname;
const AUDIO_DIR = path.join(ROOT, 'data', 'audio');
const DB_PATH = path.join(ROOT, 'data', 'music.db');
const MAX_ACCOUNTS = 4;
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

fs.mkdirSync(AUDIO_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  file TEXT NOT NULL,
  cover TEXT DEFAULT NULL,
  added_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  fails INTEGER DEFAULT 0,
  locked_until INTEGER DEFAULT 0
);
`);

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT, 'public')));

// ────────────────── util ──────────────────
const randToken = () => crypto.randomBytes(32).toString('hex');
const now = () => Math.floor(Date.now() / 1000);
const sanitize = (s) => String(s || '').replace(/[^\w.\-]/g, '_').slice(0, 80);

function attemptKey(ip, username) {
  return `${ip}|${String(username || '').toLowerCase()}`;
}
function checkLock(ip, username) {
  const key = attemptKey(ip, username);
  const row = db.prepare('SELECT * FROM login_attempts WHERE key = ?').get(key);
  if (row && row.locked_until > now()) {
    return Math.ceil((row.locked_until - now()) / 60);
  }
  return 0;
}
function recordFail(ip, username) {
  const key = attemptKey(ip, username);
  const row = db.prepare('SELECT * FROM login_attempts WHERE key = ?').get(key);
  const fails = (row ? row.fails : 0) + 1;
  if (fails >= MAX_ATTEMPTS) {
    db.prepare(`INSERT INTO login_attempts (key, fails, locked_until) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET fails=excluded.fails, locked_until=excluded.locked_until`)
      .run(key, 0, now() + LOCK_MINUTES * 60);
    return true;
  }
  db.prepare(`INSERT INTO login_attempts (key, fails, locked_until) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET fails=excluded.fails, locked_until=0`)
    .run(key, fails, 0);
  return false;
}
function recordSuccess(ip, username) {
  db.prepare('DELETE FROM login_attempts WHERE key = ?').run(attemptKey(ip, username));
}
function auth(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!token) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!row || row.expires_at < now()) return null;
  return db.prepare('SELECT id, username FROM users WHERE id = ?').get(row.user_id);
}
function requireAuth(req, res, next) {
  const user = auth(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  req.user = user;
  next();
}

// ────────────────── auth routes ──────────────────
app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  const uname = String(username || '').trim().slice(0, 24);
  const pass = String(password || '');
  if (!/^[a-zA-Z0-9_.\-]{3,24}$/.test(uname))
    return res.status(400).json({ error: 'Username 3-24 karakter: huruf, angka, titik, strip, underscore.' });
  if (pass.length < 6)
    return res.status(400).json({ error: 'Password minimal 6 karakter.' });

  const ip = req.ip;
  const lock = checkLock(ip, '__register__');
  if (lock) return res.status(429).json({ error: `Terlalu banyak percobaan. Coba lagi ${lock} menit lagi.` });

  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count >= MAX_ACCOUNTS)
    return res.status(403).json({ error: `Batas maksimal ${MAX_ACCOUNTS} akun sudah tercapai.` });

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(uname);
  if (exists) return res.status(409).json({ error: 'Username sudah dipakai.' });

  const hash = bcrypt.hashSync(pass, 10);
  db.prepare('INSERT INTO users (username, pass_hash) VALUES (?, ?)').run(uname, hash);
  res.json({ ok: true, message: `Akun "${uname}" dibuat. Silakan login.` });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const uname = String(username || '').trim();
  const pass = String(password || '');
  const ip = req.ip;
  const lock = checkLock(ip, uname);
  if (lock) return res.status(429).json({ error: `Terlalu banyak percobaan gagal. Akun terkunci ${lock} menit lagi.` });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(uname);
  if (!user || !bcrypt.compareSync(pass, user.pass_hash)) {
    const locked = recordFail(ip, uname);
    return res.status(401).json({
      error: locked
        ? `5x gagal — akun dikunci ${LOCK_MINUTES} menit.`
        : 'Username atau password salah.',
      attemptsLeft: MAX_ATTEMPTS - (db.prepare('SELECT fails FROM login_attempts WHERE key = ?').get(attemptKey(ip, uname))?.fails || 0)
    });
  }
  recordSuccess(ip, uname);
  const token = randToken();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, user.id, now() + 30 * 86400);
  res.json({ token, username: user.username });
});

app.post('/api/logout', requireAuth, (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ ok: true });
});

// ────────────────── playlist routes ──────────────────
app.get('/api/playlists', requireAuth, (req, res) => {
  const pls = db.prepare('SELECT id, name FROM playlists WHERE user_id = ? ORDER BY id').all(req.user.id);
  const tracks = db.prepare(
    `SELECT t.id, t.playlist_id, t.title, t.file, t.cover FROM tracks t
     JOIN playlists p ON p.id = t.playlist_id
     WHERE p.user_id = ? ORDER BY t.id`).all(req.user.id);
  const byPl = {};
  for (const t of tracks) {
    (byPl[t.playlist_id] = byPl[t.playlist_id] || []).push(t);
  }
  res.json(pls.map((p) => ({ ...p, tracks: byPl[p.id] || [] })));
});

app.post('/api/playlists', requireAuth, (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Nama playlist tidak boleh kosong.' });
  const info = db.prepare('INSERT INTO playlists (user_id, name) VALUES (?, ?)').run(req.user.id, name);
  res.json({ id: info.lastInsertRowid, name, tracks: [] });
});

app.delete('/api/playlists/:id', requireAuth, (req, res) => {
  const pl = db.prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!pl) return res.status(404).json({ error: 'Playlist tidak ditemukan.' });
  const tracks = db.prepare('SELECT file FROM tracks WHERE playlist_id = ?').all(pl.id);
  for (const t of tracks) {
    const fp = path.join(AUDIO_DIR, t.file);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    const cp = path.join(AUDIO_DIR, t.file.replace(/\.\w+$/, '') + '.jpg');
    if (fs.existsSync(cp)) fs.unlinkSync(cp);
  }
  db.prepare('DELETE FROM tracks WHERE playlist_id = ?').run(pl.id);
  db.prepare('DELETE FROM playlists WHERE id = ?').run(pl.id);
  res.json({ ok: true });
});

app.delete('/api/tracks/:id', requireAuth, (req, res) => {
  const t = db.prepare(
    `SELECT t.* FROM tracks t JOIN playlists p ON p.id = t.playlist_id
     WHERE t.id = ? AND p.user_id = ?`).get(req.params.id, req.user.id);
  if (!t) return res.status(404).json({ error: 'Lagu tidak ditemukan.' });
  const fp = path.join(AUDIO_DIR, t.file);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  const cp = path.join(AUDIO_DIR, t.file.replace(/\.\w+$/, '') + '.jpg');
  if (fs.existsSync(cp)) fs.unlinkSync(cp);
  db.prepare('DELETE FROM tracks WHERE id = ?').run(t.id);
  res.json({ ok: true });
});

// ────────────────── youtube → mp3 ──────────────────
const YTDLP = 'python3';
const YTDLP_ARGS = ['-m', 'yt_dlp'];
function isYoutubeUrl(u) {
  try {
    const parsed = new URL(String(u));
    return /(^|\.)youtube\.com$/.test(parsed.hostname) || parsed.hostname === 'youtu.be';
  } catch { return false; }
}

app.post('/api/import', requireAuth, (req, res) => {
  const { url, playlistId } = req.body || {};
  if (!isYoutubeUrl(url)) return res.status(400).json({ error: 'Hanya link YouTube (youtube.com / youtu.be) yang diterima.' });
  const pl = db.prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?')
    .get(playlistId, req.user.id);
  if (!pl) return res.status(400).json({ error: 'Pilih playlist tujuan dulu.' });

  const id = crypto.randomBytes(8).toString('hex');
  const outTpl = path.join(AUDIO_DIR, id + '.%(ext)s');
  const cookiesFile = path.join(ROOT, 'data', 'cookies.txt');
  const cookieArgs = fs.existsSync(cookiesFile) ? ['--cookies', cookiesFile] : [];

  const args = [
    ...YTDLP_ARGS,
    '-f', 'bestaudio/best',
    '-x', '--audio-format', 'mp3',
    '--audio-quality', '0',
    '--no-playlist',
    '--js-runtime', 'node',
    '--remote-components', 'ejs:github',
    '--max-filesize', '40m',
    ...cookieArgs,
    '-o', outTpl,
    '--write-thumbnail', '--convert-thumbnails', 'jpg',
    '--print', 'before_dl:title',
    '--print', 'after_move:filepath',
    '--', String(url),
  ];

  execFile(YTDLP, args, { timeout: 180000, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
    const mp3Path = path.join(AUDIO_DIR, id + '.mp3');
    const jpgPath = path.join(AUDIO_DIR, id + '.jpg');
    if (err || !fs.existsSync(mp3Path)) {
      const detail = err
        ? `[${err.code || 'killed'}:${err.signal || '?'}] ${err.message}`.slice(0, 100)
        : 'mp3 tidak ada';
      console.error('IMPORT FAIL', id, detail, '| stderr:', String(stderr || '').slice(0, 200));
      return res.status(422).json({ error: 'Gagal mengunduh. Pastikan link valid & video < 40 MB. ' + String(stderr || '').split('\n')[0].slice(0, 140) });
    }
    const title = String(stdout || '').trim().split('\n')[0].slice(0, 200) || 'Tanpa judul';
    const cover = fs.existsSync(jpgPath) ? id + '.jpg' : null;
    const info = db.prepare('INSERT INTO tracks (playlist_id, title, file, cover) VALUES (?, ?, ?, ?)')
      .run(pl.id, title, id + '.mp3', cover);
    res.json({ id: info.lastInsertRowid, title, file: id + '.mp3', cover, playlist_id: pl.id });
  });
});

// ────────────────── media ──────────────────
app.get('/api/media/:file', (req, res) => {
  // token bisa lewat header (fetch) atau query (tag <audio>/<img> tidak bisa kirim header)
  const user = auth(req) || (req.query.token ? auth({ headers: { authorization: 'Bearer ' + req.query.token } }) : null);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  const file = sanitize(req.params.file);
  const fp = path.join(AUDIO_DIR, file);
  if (!file || !fs.existsSync(fp)) return res.status(404).end();
  res.setHeader('Content-Type', file.endsWith('.jpg') ? 'image/jpeg' : 'audio/mpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(fp);
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ username: req.user.username });
});

app.use((req, res) => res.status(404).json({ error: 'not found' }));

app.listen(PORT, HOST, () => {
  console.log(`Music App jalan di http://0.0.0.0:${PORT}`);
});
