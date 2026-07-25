import { COLORS } from './constants.js';

// ─── Shared mutable state ─────────────────────────────────────────
// Semua modul import objek ini dan baca/tulis propertinya secara langsung.
// Pendekatan objek tunggal menghindari masalah circular import yang terjadi
// jika setiap modul mengekspor let-binding tersendiri.
export const state = {
  // ── User ─────────────────────────────────────────────────────────
  myId:     null,
  myName:   null,
  myEmoji:  '🧑',
  myColor:  COLORS[0],

  // ── Room ─────────────────────────────────────────────────────────
  roomId:   null,
  sharingOn: true,
  offlineMode: false, // true = mode navigasi tanpa room/Firebase (lihat startOfflineNav di session.js)
  myJoinedAt: null,   // cache timestamp `joinedAt` asli dari Firebase, dipakai biar nomor gak reset saat reconnect

  // ── GPS ──────────────────────────────────────────────────────────
  watchId:       null,   // ID dari watchPosition (untuk clearWatch)
  simIntervalId: null,   // ID dari setInterval (mode demo)
  myLat:         null,
  myLng:         null,
  myHeading:     null,   // derajat 0–360 dari Utara (null saat diam / belum dapat)
  mySpeed:       0,      // m/s dari GPS — dipakai sebagai threshold validasi heading
  roadSnapOn:    true,   // true = titik GPS di-snap ke jalan terdekat (lihat road-snap.js)

  // ── Map (MapLibre GL JS) ──────────────────────────────────────────
  map:           null,
  mapReady:      false,
  firstFix:      true,   // true = peta belum pernah di-center ke posisi user
  colorIdx:      0,      // counter untuk auto-assign warna ke user baru
  navMode:       false,  // true = mode navigasi aktif (peta rotate + marker segitiga)
  buildings3D:   false,  // true = peta tilt utk menampilkan gedung 3D (fill-extrusion)

  // ── Follow mode ───────────────────────────────────────────────────
  followedUid:   null,   // UID anggota yang sedang di-follow
  isFollowFlying: false, // true saat animasi flyTo() awal masih berjalan

  // ── Rute navigasi (OSRM, mobil saja) ──────────────────────────────
  routeMode:     'idle', // 'idle' | 'picking' (nunggu tap peta) | 'active' (rute tampil)
  routeDest:     null,   // {lat, lng} titik tujuan hasil tap peta
  routeInfo:     null,   // {distance, duration} meter & detik, hasil terakhir dari OSRM
  routeLastCalc: null,   // {lat, lng, time} posisi+waktu hitung terakhir, buat throttle re-route

  // ── Member data ───────────────────────────────────────────────────
  members:       {},     // uid → {name, emoji, color, lat, lng, sharing, isMe}
  markers:       {},     // uid → maplibregl.Marker (HTML marker)
  trails:        {},     // uid → true jika trail source/layer sudah ditambahkan
  trailPts:      {},     // uid → Array<{lat, lng}>
  memberNumbers: {},     // uid → nomor urut, dihitung ulang dari 0 tiap update anggota
                          // (lihat recomputeMemberNumbers() di ui.js) — SENGAJA gak ada
                          // counter lokal di sini, biar semua device selalu hasilin
                          // angka yang sama persis dari data yang sama.

  // ── Tab management (BroadcastChannel) ────────────────────────────
  broadcastChannel: null,
  isTabActive:      false,

  // ── Wake Lock ─────────────────────────────────────────────────────
  wakeLock: null,

  // ── UI state ─────────────────────────────────────────────────────
  toastTimer:       null,
  _prevConnected:   true,
  membersCollapsed: false,
  showLabels:       true,   // true = label nama anggota tampil di atas marker
};
