import { db } from '../firebase-config.js';
import {
  ref, set, onValue, onDisconnect,
  serverTimestamp, remove, get,
} from 'firebase/database';
import { state } from './state.js';
import { COLORS, genId, safeColor } from './constants.js';
import { saveUserData, getDeviceId } from './storage.js';
import { showToast, showConnectionStatus, renderMembers, updateDistances, cancelFollow, recomputeMemberNumbers } from './ui.js';
import { initMap, updateMarker, removeMarker } from './map.js';
import { startGPS } from './gps.js';
import { getSelectedRoomId, renderActiveRoomInfo } from './room.js';
import { getCurrentMapStyleUrl } from './theme.js';

// ─── Fullscreen ───────────────────────────────────────────────────
// Harus dipanggil dalam user-gesture (onclick) agar browser mengizinkan.
export function enterFullscreen() {
  const el  = document.documentElement;
  const rfs = el.requestFullscreen
    || el.webkitRequestFullscreen
    || el.mozRequestFullScreen
    || el.msRequestFullscreen;
  if (rfs) {
    rfs.call(el).catch(err => {
      // Gagal di iOS Safari — PWA meta sudah menanganinya
      console.info('Fullscreen not supported or denied:', err.message);
    });
  }
}

// Sembunyikan tombol fullscreen saat sudah dalam mode fullscreen.
// Tombol kini berada di toolbar bawah, bukan absolut di atas peta.
export function syncFullscreenBtn() {
  const inFS = !!(
    document.fullscreenElement
    || document.webkitFullscreenElement
    || document.mozFullScreenElement
    || document.msFullscreenElement
  );
  const btn = document.getElementById('fullscreenBtn');
  if (btn && state.myId) {
    btn.style.display = inFS ? 'none' : 'flex';
  }
}

// ─── Wake Lock ────────────────────────────────────────────────────
// Cegah layar redup/mati selama sesi aktif.
export async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    if (state.wakeLock) return; // sudah aktif
    state.wakeLock = await navigator.wakeLock.request('screen');
    state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
  } catch (err) {
    // Bisa gagal saat baterai kritis atau browser tidak izinkan
    console.info('Wake lock failed:', err.message);
  }
}

export function releaseWakeLock() {
  if (state.wakeLock) { state.wakeLock.release(); state.wakeLock = null; }
}

// ─── Tab detection (BroadcastChannel) ────────────────────────────
// Mencegah user membuka dua tab aktif sekaligus.
// initTabDetection() dipanggil saat page load (sebelum login),
// tapi isTabActive baru di-set true setelah startSession() berhasil.
export function initTabDetection() {
  try {
    state.broadcastChannel = new BroadcastChannel('lokasi_bareng_tab');
    state.broadcastChannel.onmessage = (event) => {
      if (event.data.type === 'TAB_ACTIVE') {
        // Tab lain baru aktif — jika tab ini sudah aktif, minta tab baru keluar
        if (state.isTabActive && state.myId) {
          state.broadcastChannel.postMessage({ type: 'CLOSE_DUPLICATE' });
        }
      } else if (event.data.type === 'CLOSE_DUPLICATE') {
        showDuplicateTabWarning();
      } else if (event.data.type === 'LOGOUT') {
        performLogout();
      }
    };
  } catch (e) {
    console.warn('BroadcastChannel tidak tersedia');
  }
}

function showDuplicateTabWarning() {
  document.getElementById('duplicateTabOverlay').classList.add('show');
}

// ─── Logout ───────────────────────────────────────────────────────
export function performLogout() {
  console.log('🚪 Performing logout...');
  releaseWakeLock();

  // Hapus nama & emoji dari localStorage (form kosong saat login lagi)
  // Warna sengaja tidak dihapus agar user dapat warna yang sama berikutnya
  localStorage.removeItem('lokasi_name');
  localStorage.removeItem('lokasi_emoji');

  if (state.myId && state.roomId) {
    remove(ref(db, `rooms/${state.roomId}/members/${state.myId}`));
  }

  if (state.watchId) navigator.geolocation.clearWatch(state.watchId);
  if (state.simIntervalId) { clearInterval(state.simIntervalId); state.simIntervalId = null; }

  const u = new URL(location);
  u.searchParams.delete('room');
  history.replaceState({}, '', u.toString());

  showToast('👋 Berhasil logout');
  setTimeout(() => location.reload(), 1000);
}

export function handleLogout() {
  if (state.broadcastChannel) {
    state.broadcastChannel.postMessage({ type: 'LOGOUT' });
  }
  performLogout();
}

// ─── Start Tracking ───────────────────────────────────────────────
// Entry point dari tombol "Mulai Bagikan Lokasi".
// Memeriksa nama duplikat di Firebase sebelum membuat sesi.
export async function startTracking() {
  if (!db) {
    showToast('⚠️ Firebase belum siap. Isi konfigurasi VITE_FIREBASE_* terlebih dahulu.');
    return;
  }
  if (!navigator.onLine) {
    showToast('📴 Kamu sedang offline — fitur room butuh internet. Coba "Mode Navigasi Offline" di bawah.');
    return;
  }

  const name = document.getElementById('nameInput').value.trim();
  if (!name) { showToast('⚠️ Masukkan nama kamu dulu!'); return; }

  // Room aktif ditentukan oleh tab yang dipilih user (Buat Room = kode
  // acak yang sudah digenerate, Gabung Room = kode yang diketik user).
  const roomId = getSelectedRoomId();
  if (!roomId)           { showToast('⚠️ Masukkan kode room dulu!');      return; }
  if (roomId.length < 4) { showToast('⚠️ Kode room minimal 4 karakter!'); return; }

  // Harus dipanggil sebelum await — browser hanya izinkan fullscreen dalam user gesture sinkron
  enterFullscreen();
  requestWakeLock();

  const btn          = document.querySelector('.primary-btn');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<div class="loader-wrap" style="padding:0; flex-direction:row;">'
    + '<div class="spinner" style="width:16px;height:16px;border-width:2px;"></div>'
    + ' <span style="font-size:0.95rem">Memeriksa...</span></div>';

  try {
    const snapshot = await get(ref(db, `rooms/${roomId}/members`));
    if (snapshot.exists()) {
      const myDevId    = getDeviceId();
      const isNameTaken = Object.values(snapshot.val()).some(m =>
        m.name && m.name.toLowerCase() === name.toLowerCase() && m.deviceId !== myDevId,
      );
      if (isNameTaken) {
        showToast('⚠️ Nama sedang aktif digunakan di room ini!');
        btn.disabled  = false;
        btn.innerHTML = originalText;
        return;
      }
    }
  } catch (err) {
    console.error('Gagal memeriksa nama:', err);
  }

  btn.disabled  = false;
  btn.innerHTML = originalText;

  state.myName  = name;
  state.myId    = genId();
  state.roomId  = roomId;
  // FIX: gunakan warna tersimpan jika ada. Generate baru hanya saat pertama kali.
  if (!localStorage.getItem('lokasi_color')) {
    state.myColor = COLORS[state.colorIdx++ % COLORS.length];
  }
  saveUserData();

  document.getElementById('setupSection').style.display  = 'none';
  document.getElementById('loadingSection').style.display = '';
  document.getElementById('loadingText').textContent      = 'Bergabung dengan teman...';
  setTimeout(() => startSession(), 800);
}

// ─── Session ──────────────────────────────────────────────────────
// Inisialisasi peta, tulis presence ke Firebase, pasang listeners.
export function startSession() {
  if (!db) {
    showToast('⚠️ Firebase belum siap. Isi konfigurasi VITE_FIREBASE_* terlebih dahulu.');
    return;
  }

  console.log('🎬 Starting session...', { myId: state.myId, myName: state.myName, roomId: state.roomId });

  // FIX: isTabActive di-set setelah login, bukan saat page load
  state.isTabActive = true;
  if (state.broadcastChannel) {
    state.broadcastChannel.postMessage({ type: 'TAB_ACTIVE' });
  }

  // Tambah ?room= ke URL agar bisa dibagikan (trigger auto-login di tab baru)
  const u = new URL(location);
  u.searchParams.set('room', state.roomId);
  history.replaceState({}, '', u);

  document.getElementById('mainToolbar').style.display = 'flex'; // tampilkan toolbar bawah
  syncFullscreenBtn();
  renderActiveRoomInfo(); // tampilkan kode room aktif + tombol bagikan di sidebar

  // Init peta dengan callback drag (batalkan follow saat user geser peta),
  // pakai style sesuai tema aktif (light/dark) yang sedang dipilih user
  initMap(() => {
    if (state.followedUid) {
      cancelFollow();
      showToast('🗺️ Mode ikuti dibatalkan');
    }
  }, getCurrentMapStyleUrl());

  // Tulis presence ke Firebase + auto-hapus saat disconnect
  const myRef = ref(db, `rooms/${state.roomId}/members/${state.myId}`);
  set(myRef, {
    name:     state.myName,
    emoji:    state.myEmoji,
    color:    state.myColor,
    sharing:  true,
    lat:      null,
    lng:      null,
    ts:       serverTimestamp(),
    joinedAt: serverTimestamp(), // ← dasar urutan nomor anggota (recomputeMemberNumbers di ui.js); TIDAK disentuh writeLocation()
    deviceId: getDeviceId(),
  });
  onDisconnect(myRef).remove();

  // ── Listener utama: daftar anggota di room ────────────────────
  onValue(ref(db, `rooms/${state.roomId}/members`), snap => {
    const data = snap.val() || {};

    // Handle anggota yang keluar
    Object.keys(state.members).forEach(uid => {
      if (!data[uid] && uid !== state.myId) {
        const member = state.members[uid];
        showToast(`${member.emoji || '🧑'} ${member.name || 'Anggota'} keluar`);
        removeMarker(uid);          // hapus marker + trail + source MapLibre
        delete state.members[uid];
      }
    });

    // Handle anggota yang bergabung / update data (BELUM render marker di
    // sini — nomor anggota harus final dulu lewat recomputeMemberNumbers()
    // di bawah, baru marker/label boleh dibaca/digambar).
    Object.entries(data).forEach(([uid, m]) => {
      if (!state.members[uid] && uid !== state.myId) {
        showToast(`${m.emoji || '🧑'} ${m.name || 'Anggota'} bergabung!`);
        state.trailPts[uid] = [];
      }

      // OFFLINE GUARD: Firebase bisa kirim data parsial saat reconnect.
      // Pakai ?? agar field yang ada di cache lokal tidak tertimpa null dari server.
      const prev = state.members[uid] || {};
      state.members[uid] = {
        ...prev,
        ...m,
        name:  m.name  ?? prev.name  ?? 'Anggota',
        emoji: m.emoji ?? prev.emoji ?? '🧑',
        color: safeColor(m.color ?? prev.color ?? COLORS[0]), // FIX: validasi hex
        isMe:  uid === state.myId,
      };
      // Simpan joinedAt asli kita — dipakai lagi di reconnect handler
      // di bawah supaya nomor gak "loncat ke belakang" tiap koneksi putus-nyambung.
      if (uid === state.myId && m.joinedAt) state.myJoinedAt = m.joinedAt;
    });

    // Nomor dihitung ULANG dari nol berdasar joinedAt tiap kali data berubah —
    // hasilnya pasti identik di semua device (lihat ui.js untuk alasannya).
    recomputeMemberNumbers();

    // Baru sekarang render/gambar marker — nomornya sudah final.
    Object.entries(data).forEach(([uid, m]) => {
      if (m.lat && m.lng) updateMarker(uid);
    });

    renderMembers();
    updateDistances();
    document.getElementById('joinOverlay').classList.remove('show');
  });

  // ── Reconnect handler ─────────────────────────────────────────
  // Saat ganti jaringan, onDisconnect sudah berjalan → node terhapus.
  // Re-write presence saat koneksi kembali.
  onValue(ref(db, '.info/connected'), snap => {
    const connected = snap.val() === true;
    showConnectionStatus(connected);
    if (connected) {
      const myRef = ref(db, `rooms/${state.roomId}/members/${state.myId}`);
      set(myRef, {
        name:     state.myName,
        emoji:    state.myEmoji,
        color:    state.myColor,
        sharing:  state.sharingOn,
        lat:      state.myLat || null,
        lng:      state.myLng || null,
        ts:       serverTimestamp(),
        joinedAt: state.myJoinedAt ?? serverTimestamp(), // pertahankan urutan nomor asli; fallback cuma buat first-connect
        deviceId: getDeviceId(),
      });
      onDisconnect(myRef).remove();
    }
  });

  startGPS();
}

// ─── Mode Navigasi Offline (tanpa room, tanpa Firebase) ────────────
// Entry point alternatif dari modal join (tombol "Mode Navigasi Offline"),
// bypass total alur room/Firebase supaya app tetap kepake buat lihat posisi
// sendiri di peta cache walau gak ada koneksi internet sama sekali.
// writeLocation()/writeSharing() di firebase-write.js otomatis no-op karena
// state.roomId tetap null selamanya di mode ini — gak perlu guard tambahan
// di gps.js.
export function startOfflineNav() {
  enterFullscreen();
  requestWakeLock();

  state.offlineMode = true;
  state.myId        = state.myId || genId();
  state.myName      = state.myName || 'Saya';
  state.sharingOn   = true; // wajib true biar updateMarker()/jumpTo() jalan (lihat gps.js)
  if (!localStorage.getItem('lokasi_color')) {
    state.myColor = COLORS[state.colorIdx++ % COLORS.length];
  }

  // "Member" lokal buat diri sendiri — gak pernah dikirim ke Firebase, cuma
  // supaya updateMarker(uid)/renderMembers() yang generic per-uid tetap
  // bisa dipakai apa adanya (sama seperti alur room biasa).
  state.members[state.myId] = {
    name: state.myName, emoji: state.myEmoji, color: state.myColor,
    lat: null, lng: null, sharing: true, isMe: true,
    joinedAt: Date.now(), // gak ada Firebase di mode ini, tapi tetap diisi biar
                          // recomputeMemberNumbers() (ui.js) bisa dipakai apa adanya
  };
  recomputeMemberNumbers();

  state.isTabActive = true;
  if (state.broadcastChannel) {
    state.broadcastChannel.postMessage({ type: 'TAB_ACTIVE' });
  }

  document.getElementById('joinOverlay').classList.remove('show');
  document.getElementById('mainToolbar').style.display = 'flex';
  document.getElementById('sidebarRoom').style.display  = 'flex'; // wadah .offline-nav-label (normalnya di-toggle renderActiveRoomInfo())
  document.body.classList.add('offline-nav-mode'); // CSS sembunyikan UI yang butuh room (lihat style.css)
  syncFullscreenBtn();

  initMap(() => {
    if (state.followedUid) cancelFollow();
  }, getCurrentMapStyleUrl());

  startGPS();
  showToast('🗺️ Mode navigasi offline aktif — lokasi tidak dibagikan ke siapa pun');
}
