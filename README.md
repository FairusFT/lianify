# Lianify — Web Music App

Web music player mirip Spotify: playlist, YouTube→MP3, multi-akun, dark/light theme, resume otomatis.

## Fitur

- **Player lengkap** — play/pause, next, prev, seek bar, volume, mode ulang (🔁 semua / 🔂 satu lagu)
- **Playlist** — buat & hapus playlist, hapus lagu, cover otomatis dari YouTube
- **YouTube→MP3** — tempel link YouTube, judul + thumbnail diambil otomatis
- **Multi-akun** — maks 4 akun, password di-hash bcrypt, sesi token 30 hari
- **Anti brute-force** — 5x login gagal → lock 15 menit (per username + IP)
- **Dark/light theme** + responsive (HP/tablet/laptop)
- **Resume** — posisi lagu tersimpan, lanjut saat browser dibuka lagi

## Teknologi

Node.js + Express + SQLite (`node:sqlite`) + bcryptjs + yt-dlp + ffmpeg. Tanpa build step.

## Instalasi

```bash
npm install
node server.js
# buka http://localhost:3006
```

Port default 3006. Ubah dengan: `PORT=5000 node server.js`

## Mengunduh Lagu dari YouTube (PENTING — wajib baca)

YouTube memblokir download dari server tanpa identitas login. Supaya fitur import jalan, kamu perlu cookies dari akun YouTube-mu sendiri. Ikuti langkah ini persis:

### 1. Install ekstensi

Install ekstensi **"Get cookies.txt LOCALLY"** (harus yang ada kata **LOCALLY**-nya) dari Chrome Web Store. Jangan pakai versi lain yang tidak punya kata LOCALLY — banyak fork yang mencuri cookies.

### 2. Aktifkan di Incognito

1. Buka jendela **Incognito** (Ctrl+Shift+N)
2. Klik ikon puzzle 🧩 di kanan atas → cari **Get cookies.txt LOCALLY** → klik tombol detail → nyalakan **"Allow in Incognito"**

### 3. Login & export

1. Di jendela Incognito itu, buka youtube.com → **login akun YouTube** (disarankan akun kedua, bukan akun utama)
2. Buka tab baru: `https://www.youtube.com/robots.txt`
3. Klik ikon ekstensi Get cookies.txt LOCALLY → **Export**
4. **Tutup SEMUA jendela Incognito** (ini penting — mencegah YouTube merotasi cookies)

### 4. Simpan cookies ke server

Salin file hasil export (biasanya `www.youtube.com_cookies.txt`) ke:

```
data/cookies.txt
```

Server otomatis mendeteksi file ini. Tidak perlu restart.

### Kenapa harus dari Incognito?

YouTube **merotasi (mengganti) cookies** setiap kali kamu membuka tab YouTube di browser normal. Cookies yang di-export dari browsing biasa jadi basi dalam hitungan menit. Cookies dari jendela Incognito yang langsung ditutup tidak dirotasi — bisa tahan 1–2 minggu.

## ⚠️ Bahaya File Cookies — Baca Ini

**File cookies.txt = kunci sesi akun YouTube-mu.** Siapa pun yang memegang file ini bisa bertindak seolah-olah mereka login sebagai kamu: melihat riwayat tontonan, menambah/menghapus playlist, like, subscribe, dan komentar atas namamu.

Aturan wajib:

1. **Jangan pernah** upload cookies.txt ke GitHub, repo publik, atau kirim ke orang lain
2. **Jangan pernah** taruh file ini di dalam folder yang di-commit git (folder `data/` sudah di-ignore)
3. **Pakai akun Google kedua** (bukan akun utama) untuk export cookies — kalau bocor, kerugiannya minimal
4. Kalau file pernah bocor atau kamu curiga: segera **logout semua perangkat** di Google (Sign out all devices) — sesi cookies langsung mati
5. Hapus file `data/cookies.txt` dari server kalau sudah tidak dipakai

Cookies expire otomatis dalam 1–2 minggu. Kalau import mulai gagal lagi, ulangi langkah di atas dari awal.

> Hanya gunakan untuk musik legal: NCS (NoCopyrightSounds), royalti-bebas, atau konten milik sendiri. Mengunduh musik ber-copyright melanggar ToS YouTube.

## Struktur

```
server.js          # Express + node:sqlite + bcryptjs
public/            # UI (index.html, style.css, app.js, sw.js, manifest.json)
data/
  music.db         # SQLite: users, sessions, playlists, tracks, login_attempts
  audio/           # MP3 + cover JPG
  cookies.txt      # (opsional — lihat panduan di atas, JANGAN di-commit)
```

## API

- `POST /api/register` `{username, password}`
- `POST /api/login` `{username, password}` → `{token}`
- `GET/POST/DELETE /api/playlists[/:id]`
- `DELETE /api/tracks/:id`
- `POST /api/import` `{url, playlistId}`
- `GET /api/media/:file?token=...`

## Keamanan

- Password: bcrypt (10 rounds)
- Sesi: token random 32 byte, expired 30 hari
- Login: 5 percobaan gagal → lock 15 menit
- Register: maks 4 akun
- URL: hanya youtube.com/youtu.be (anti SSRF)
- File: sanitasi nama, tidak ada path traversal
- SQL: prepared statements (node:sqlite)
- Media: token wajib (via header atau query param)
