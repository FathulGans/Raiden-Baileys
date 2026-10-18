# Raiden-Baileys

<p align="center">
  <img src="https://kappa.lol/MNHfEm" width="500" alt="Raiden-Baileys banner"/>
</p>

<p align="center">
  <b>Pustaka Bot WhatsApp</b><br>
  Wrapper Baileys berkinerja tinggi untuk otomatisasi bot WhatsApp kalian
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-v20+-green?style=flat-square">
  <img src="https://img.shields.io/badge/Modified-Baileys-blue?style=flat-square">
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square">
</p>

---

## Overview

Raiden-Baileys adalah library open source berbasis Baileys yang telah dimodifikasi untuk kebutuhan automation dan integrasi WhatsApp skala besar.

Dirancang agar ringan, cepat, dan mudah digunakan, serta mendukung fitur-fitur terbaru WhatsApp bot, termasuk dukungan **LID** (PN ↔ LID) dan sinkronisasi dengan Baileys v7 rc14.

---

## Features

- Custom & automatic pairing
- Interactive message & action buttons
- Album message (multiple images)
- Event message
- Poll result message
- Product message
- Payment request message
- Group & chat management
- Privasi pesan/panggilan, call link, daftar bot, member label grup, `newsletterUpdate`
- Kontak, label, dan quick reply (`addOrEditContact`, `removeContact`, `addLabel`, `addOrEditQuickReply`, `removeQuickReply`)
- Multi-device support
- Dukungan LID: pemetaan PN ↔ LID persisten, sesi Signal kanonik LID
- Retry manager: cache pesan terkirim & auto session recreation
- Transaksi kunci Signal serial per akun (mutex + antrean per tipe key)
- Lightweight & scalable

---

## Installation

```bash
npm install raiden-baileys
```

Atau langsung dari GitHub:

```bash
npm install github:<username>/<repo>
```

> Butuh **Node.js 20+**. Fitur audio/video (thumbnail, waveform, konversi) membutuhkan **ffmpeg** terpasang di sistem.

---

## Quick Start

```js
const { default: makeWASocket, useMultiFileAuthState } = require('raiden-baileys')

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('session')
  const sock = makeWASocket({ auth: state, printQRInTerminal: true })

  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('messages.upsert', ({ messages }) => {
    console.log(messages[0])
  })
}

start()
```

### Opsi tambahan

| Opsi | Default | Fungsi |
| --- | --- | --- |
| `enableRecentMessageCache` | `true` | Cache pesan terkirim untuk retry |
| `enableAutoSessionRecreation` | `true` | Buat ulang sesi saat retry |
| `lidSessionMigration` | `true` | Migrasi sesi Signal PN → LID |

---

## Testing

```bash
node test/lid-step1.test.js
node test/lid-step3.test.js
node test/lid-step4.test.js
node test/wabinary-step1.test.js
node test/tx-step2.test.js
node test/decode-step4.test.js
node test/chat-modify-step2.test.js
node test/api-step3.test.js
node test/api-step3b.test.js
node test/rc14-modules.test.js
```

> Library ini **belum diuji** dengan koneksi WhatsApp sungguhan. Jika login gagal, periksa `DICT_VERSION` / token WABinary terlebih dahulu.

---

## Changelog

### [2.1.3] - 2026-10-18

#### Ditambahkan
- Communities (dari Baileys rc14): `communityMetadata`, `communityCreate`, `communityLeave`, `communityFetchAllParticipating`, `communityCreateGroup`, `communityLinkGroup`, `communityUnlinkGroup`, `communityFetchLinkedGroups`, pengaturan komunitas, undangan, dan permintaan bergabung. Socket teratas kini `makeCommunitiesSocket`; `extractCommunityMetadata` diekspor.
- `lib/Socket/mex.js` (`executeWMexQuery`), `USyncUsernameProtocol`, `Utils/sync-action-utils` (`processContactAction`, `emitSyncActionResults`), `Utils/tc-token-utils`, `Utils/reporting-utils`, `isStringNullOrEmpty`.
- Tes baru: `test/rc14-modules.test.js`.

#### Diubah
- `messages-recv`: ack kini dibangun `buildAckStanza` (Utils/stanza-ack) seperti rc14.
- `messages-recv`: notifikasi perubahan identitas kini ditangani `handleIdentityChange` (sesi disegarkan, dengan debounce, dilewati untuk perangkat pendamping, akun sendiri, dan pemrosesan offline). Sebelumnya hanya dicatat di log.
- `messages-recv`: pemroses node offline memakai `makeOfflineNodeProcessor` (error handler tidak lagi menghentikan antrean, event loop diberi jeda tiap 10 node).
- Banner konsol diganti dengan logo Raiden-Baileys (ANSI pixel art 60 kolom, muat di layar panel HP), tanpa box, dan teks info dirapikan.
- "Recode by" kini mencantumkan Kaze, Kelvin, Tayro.
- Lisensi, author, dan daftar contributors di `package.json`, `LICENSE`, dan README diperbarui (Kaze, Kelvin, Tayro).

#### Diperbaiki
- Types TypeScript: `package.json` menunjuk `lib/index.d.ts` yang tidak ada, dan `WAProto/index.d.ts` tidak ikut terpublish. Kini `lib/index.d.ts` ditambahkan (makeWASocket, auth, JID utils, helper pesan, re-export `proto`) dan `WAProto/*.d.ts` dimasukkan ke `files`.

### [2.1.2] - 2026-10-18

#### Ditambahkan
- API socket baru (disamakan dengan Baileys rc14): `updateMessagesPrivacy`, `updateCallPrivacy`, `updateDisableLinkPreviewsPrivacy`, `getBotListV2`, `fetchDisappearingDuration(...jids)`, `createCallLink(type, event?, timeoutMs?)`, `updateMemberLabel(jid, label)`, `issuePrivacyTokens(jids, timestamp?)`, `newsletterUpdate(jid, updates)`.
- API socket baru (disamakan dengan Baileys rc14): `addOrEditContact(jid, contact)`, `removeContact(jid)`, `addLabel(jid, { id, name, color, deleted })`, `addOrEditQuickReply({ shortcut, message })`, `removeQuickReply(timestamp)`.
- `chatModificationToAppPatch` mendukung `contact`, `addLabel`, `quickReply`, dan `disableLinkPreviews`; sinkronisasi app-state memancarkan event `settings.update` untuk pengaturan link preview.
- Tes baru: `test/chat-modify-step2.test.js`, `test/api-step3.test.js`, `test/api-step3b.test.js` (memakai sock palsu).

#### Diperbaiki
- `WAProto/index.js` diubah dari ESM ke CommonJS. Sebelumnya file ini berformat ESM (`import`/`export`) sementara seluruh `lib/` memakai `require`, sehingga di Node 20 sebelum 20.19 paket gagal dimuat. Kini berjalan di semua Node 20+.
- `fluent-ffmpeg` dipakai di `lib/Utils/MessageBuilder.js` dan `messages-media.js` tetapi **tidak tercantum di `package.json`**, sehingga pada instalasi baru `require('raiden-baileys')` bisa gagal dengan "Cannot find module". Kini dicantumkan di `dependencies`.
- `MessageBuilder.js` memuat `sharp` dan `fluent-ffmpeg` di baris paling atas padahal `sharp` bersifat opsional. Kini keduanya dimuat saat dibutuhkan, dengan pesan error yang jelas jika belum terpasang.

### [2.1.1] - 2026-10-18

#### Diubah
- Banner README memakai link langsung agar tampil di npm.
- Bagian "Catatan / Belum selesai" dihapus dari dokumentasi.

### [2.1.0] - 2026-10-18

#### Diubah
- Proyek diganti nama menjadi **Raiden-Baileys** (paket `raiden-baileys`).
- Banner konsol diganti dengan logo Raiden-Baileys (pixel art dua baris) dan kotak banner dirapikan.
- Banner README dipindah ke `assets/banner.png`.
- Versi paket naik ke 2.1.0.

### [2.0.0] - 2026-10-18

#### Ditambahkan
- **Dukungan LID (dari Baileys v7)**
  - `WABinary/jid-utils`: `hosted`, `hosted.lid`, `isPnUser`, `transferDevice`, `isJidMetaAI`, `META_AI_JID`, `getServerFromDomainType`; `jidDecode` membaca agent.
  - `Signal/lid-mapping`: `LIDMappingStore` (PN ↔ LID, persisten, fallback USync).
  - `Signal/lid-session`: alamat sesi Signal kanonik = LID, sesi PN lama dipindah otomatis.
  - Event baru `lid-mapping.update`.
- **Retry manager** (`Utils/message-retry-manager.js`): cache pesan terkirim, hitung retry, buat ulang sesi otomatis, phone request terjadwal, deteksi tabrakan base key. Opsi `enableRecentMessageCache` dan `enableAutoSessionRecreation` (default aktif).
- **Pre-key manager** (`Utils/pre-key-manager.js`) berbasis `SerialQueue`, tanpa `p-queue`.
- Export baru di decode: `NACK_REASONS`, `SERVER_ERROR_CODES`, `MISSING_KEYS_ERROR_TEXT`, `ACCOUNT_RESTRICTED_TEXT`, `NO_MESSAGE_FOUND_ERROR_TEXT`, `DECRYPTION_RETRY_CONFIG`.
- Field `remoteJidAlt`, `participantAlt`, `*Username`, `addressingMode` pada `key`; tipe `IMessageKey` diperbarui.
- Tombol pengaman: `makeWASocket({ lidSessionMigration: false })` dan `makeWASocket({ enableRecentMessageCache: false })`.
- Suite tes: `lid-step1/3/4`, `retry-step3a/3c1`, `decode-step4`, `pn-resolve-step4b`, `wabinary-step1`, `tx-step2`.
- README baru dengan banner baru dan changelog digabung di dalamnya.

#### Diubah
- **WAProto** diganti dengan versi rc14 (`index.d.ts` tetap milik fork).
- **WABinary**: `constants.js` dibangkitkan ulang dari rc14, `DICT_VERSION` 2 → 3 (header noise `[87,65,6,3]`), `decode.js` mendukung `readAdJid` hosted/hosted.lid, `readFbJid`, `readInteropJid`; prefix `WA_ADV_*` di Defaults.
- **decode-wa-message** ditulis ulang ala rc14: `extractAddressingContext`, `getDecryptionJid` (LID bila ada pemetaan), `fromMe` memperhitungkan LID sendiri, recipient Meta AI, tag plaintext, `view_once` tidak tersedia, `retryCount` dari `<enc count>`.
- **auth-utils**: `makeCacheableSignalKeyStore` memakai mutex; `addTransactionCapability` ditulis ulang (AsyncLocalStorage, mutex per key dengan ref-count, antrean per tipe key, validasi hapus pre-key, retry commit melempar error di percobaan terakhir); `initAuthCreds` + `additionalData`.
- `transaction(work, key = 'default')`: transaksi kini serial per akun, jadi kirim paralel ke banyak chat bisa menunggu bergantian.
- `libsignal`: `validateSession`, `getSessionInfo`, alamat sesi kanonik LID. `signal`: `extractE2ESessionFromRetryReceipt`.
- Identitas proyek: nama proyek menjadi **Raiden-Baileys** (paket `raiden-baileys`); author, keywords, README, dan banner konsol diganti ke **Kaze** (WA +6281549501054, IG @qwerty267_).

#### Diperbaiki
- `messages-recv.handleMessage` tidak lagi mengganti `key.participant` LID orang lain dengan JID sendiri.
- `key.remoteJid` tidak lagi menjadi `undefined` saat PN tidak diketahui (helper `resolvePnForLid`; LID asli disimpan di `participantAlt` / `remoteJidAlt`).
- Konstanta yang dipakai `messages-recv` tapi sebelumnya tidak terdefinisi kini diekspor.

#### Perubahan perilaku (breaking)
- `set()` di dalam transaksi kini **async** (wajib `await`).
- Penghapusan pre-key yang tidak ada di cache transaksi dilewati dengan peringatan.

---

## Contact

- WhatsApp : [+62 815-4950-1054](https://wa.me/6281549501054)
- Instagram: [@qwerty267_](https://instagram.com/qwerty267_)

---

## Contributors

- Kaze ([FathulGans](https://github.com/FathulGans))
- [Kelvin](https://github.com/vfmarket24-alt)
- Tayro

---

## License

MIT © Kaze, Kelvin, Tayro
