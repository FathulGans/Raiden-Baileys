# Raiden-Baileys

<p align="center">
  <img src="https://kappa.lol/MNHfEm" width="300" alt="Raiden-Baileys banner"/>
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

> Butuh **Node.js 20+** (disarankan 22.12+ atau 20.19+ karena WAProto berformat ESM).

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
```

> Library ini **belum diuji** dengan koneksi WhatsApp sungguhan. Jika login gagal, periksa `DICT_VERSION` / token WABinary terlebih dahulu.

---

## Changelog

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

#### Catatan / Belum selesai
- Belum diuji dengan koneksi WhatsApp sungguhan; `handleMessage` penuh, `messages-recv`, dan `libsignal` belum punya tes.
- Sender key grup belum dimigrasi ke LID.
- `libsignal.js` rc14 (operasi per-jid dalam transaksi) belum dibawa.
- Versi WA di `baileys-version.json` sengaja tidak disamakan dengan rc14.
- `engine-requirements.js` masih `>=20`; WAProto ESM butuh Node 22.12+ (atau 20.19+).
- `lib/Socket/newsletter.js` (~baris 102) masih berisi auto-follow channel tersembunyi.

---

## Contact

- WhatsApp : [+62 815-4950-1054](https://wa.me/6281549501054)
- Instagram: [@qwerty267_](https://instagram.com/qwerty267_)

---

## License

MIT © Kaze
