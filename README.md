# Raiden-Baileys

<p align="center">
  <img src="https://raw.githubusercontent.com/FathulGans/Raiden-Baileys/main/assets/banner.png" width="500" alt="Raiden-Baileys banner"/>
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
- Private relay (`sendPrivateRelay`): kirim ke sebagian perangkat saja, include/exclude per nomor, LID, atau device
- Metadata relay otomatis: node `biz` untuk katalog, order, `payment_key_info`; node `meta` untuk poll dan event
- `photoPoll`, `buttonLocation`, dan `rawMessage` di `sendMessage`
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

## CommonJS & ESM

Paket ini mendukung **CJS** dan **ESM** sekaligus (dual package). Keduanya memuat kode yang sama, jadi tidak ada instance ganda.

```js
// CommonJS
const { default: makeWASocket, useMultiFileAuthState } = require('raiden-baileys')
```

```js
// ESM (.mjs, atau "type": "module" di package.json)
import makeWASocket, { useMultiFileAuthState, proto } from 'raiden-baileys'
// atau
import * as baileys from 'raiden-baileys'
```

Catatan:
- Import deep path memakai `exports`: `raiden-baileys/lib/Utils/crypto` (tanpa/dengan `.js`) dan `raiden-baileys/WAProto` tetap bisa. Import folder (misalnya `raiden-baileys/lib/Utils`) tidak bisa, tulis file-nya (`.../Utils/index`).
- Tipe TypeScript tersedia untuk keduanya (`lib/index.d.ts` untuk CJS, `lib/index.d.mts` untuk ESM).
- Setelah menambah export baru di `lib/index.js`, jalankan `npm run build:esm` untuk membuat ulang `lib/index.mjs`.

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

## Fitur dari @levvsync/baileys

Fitur berikut di-port dari [`@levvsync/baileys`](https://www.npmjs.com/package/@levvsync/baileys) 0.0.3 dan disesuaikan dengan internal Raiden.

### Private relay

Kirim `proto.IMessage` hanya ke sebagian perangkat. Fungsi mengembalikan message id.

```js
// semua perangkat kecuali device 2 milik 628xxx
await sock.sendPrivateRelay('628xxx@s.whatsapp.net', { conversation: 'halo' }, {
  mode: 'exclude',          // 'exclude' (default) | 'include'
  target: ['628xxx:2'],     // nomor, JID PN, JID LID, opsional ":device"
})

// hanya HP utama penerima
await sock.sendPrivateRelay(jid, message, { mode: 'include', target: ['628xxx'], deviceMode: 'primary' })

// grup: anggota target tidak menerima pesan
await sock.sendPrivateRelay('1203...@g.us', message, { target: ['628yyy'] })
```

| Opsi | Default | Fungsi |
| --- | --- | --- |
| `mode` | `'exclude'` | `include` = hanya target, `exclude` = semua kecuali target |
| `target` | `[]` | Daftar nomor / JID. Alias PN ↔ LID ikut dicocokkan |
| `deviceMode` | `'all'` | `all`, `primary` (device 0), `secondary` (perangkat pendamping) |
| `targetMe` | - | `true`/`false` memaksa perangkat sendiri ikut/tidak |
| `hideDecryptFail` | `true` | Atribut `decrypt-fail="hide"` |
| `ai` | `false` | Tambah node `<bot biz_bot="1"/>` |
| `statusJidList` | - | Wajib untuk `status@broadcast` |

Catatan grup: private relay membuat sender key baru, lalu mengosongkan `sender-key-memory` grup itu. Pesan grup normal berikutnya mengirim ulang sender key ke semua anggota.

### Metadata relay otomatis

`relayMessage` dan `sendMessage` kini menambah node berikut bila belum ada di `additionalNodes`:

| Isi pesan | Node |
| --- | --- |
| `productMessage` | `<biz native_flow_name="catalog_message"/>` |
| `orderMessage` | `<biz native_flow_name="order_details"/>` |
| tombol `payment_key_info` | `<biz><interactive type="native_flow"><native_flow name="payment_key_info"/></interactive></biz>` |
| `pollCreationMessage` (V1/V2/V3/V5) | `<meta polltype="creation"/>` |
| `eventMessage` | `<meta event_type="creation"/>` |

### photoPoll

Alias `sock.sendImagePoll` lewat `sendMessage`.

```js
await sock.sendMessage(jid, {
  photoPoll: {
    name: 'Pilih menu',
    selectableCount: 1,
    values: [
      { name: 'Nasi goreng', image: { url: './nasgor.jpg' } },
      { name: 'Mie ayam', image: { url: './mieayam.jpg' } },
    ],
  },
})
```

### buttonLocation

Tombol dengan header lokasi. `thumbnail` berupa URL, path, atau Buffer (butuh paket opsional `jimp`).

```js
await sock.sendMessage(jid, {
  buttonLocation: {
    text: 'Kantor kami',
    footer: 'Raiden',
    title: 'Kantor Pusat',
    address: 'Jl. Contoh No. 1',
    thumbnail: 'https://example.com/peta.jpg',
    buttons: [
      { id: 'rute', text: 'Rute' },
      { id: 'menu', text: 'Menu', type: 'single_select', params: { title: 'Menu', sections: [] } },
    ],
  },
})
```

### rawMessage

Kirim `proto.IMessage` mentah lewat `sendMessage`. Isi pesan tidak diubah oleh builder Raiden.

```js
await sock.sendMessage(jid, { rawMessage: { conversation: 'pesan mentah' } })
```

---

## Changelog

### [2.1.4] - 2026-10-31

#### Ditambahkan
- Tipe pesan baru di `sendMessage` / `generateWAMessageContent`: `pin`, `keep`, `call` (scheduled call), `paymentInvite`, `ptv`, `order`, `groupInvite`, `event`, `inviteAdmin`, `requestPayment`, `album`, `groupStatus`, `orderStatus`, `buttonsMessage` (termasuk lokasi + thumbnail), `stickerPack`, `richMessage` (teks/kode/tabel/html/gambar/video/produk/post/reels/sumber/saran, `editrich`), `richMessageV2`, `interactiveButtons`, `shop`. Tombol biasa kini mendukung `title`, `contextInfo`, `mentions`.
- `sendMessage(jid, { album: [{ image }, { video }], caption })`: header album + item media terhubung (`messageAssociation`), jeda antar item lewat config `albumMessageItemDelayMs` (default 0). Format `albumMessage` lama (ClutchHandler) tetap jalan.
- `sendMessage` mengisi atribut stanza untuk pin (`edit=2`), keep (`edit=6`), node `meta polltype=creation` untuk polling, dan `media_id` dari hasil upload.
- `richMessage.editrich`: pesan rich diedit otomatis setelah terkirim (`editrich.delay` dalam ms). Di luar `sock.sendMessage`, berikan `options.conn` ke `generateWAMessage` atau panggil `setRichMessageConnection(sock)`.
- Ekspor baru: `toJid`, `prepareAlbumMessageContent`, `processLocationThumbnail`, `setRichMessageConnection`, `isJidNewsletter` & `isJidMetaAi` (alias), `isJidBot`, `getBotJid`.
- Grup: `groupRevokeInviteV4(groupJid, invitedJid)`; metadata grup kini berisi `descTime`, `linkedParent`, dan `participants[].lid`.
- Event `group.join-request` (`{ id, author, participant, action, method }`) saat ada permintaan bergabung grup.
- Dependensi `fflate` (untuk `stickerPack`). `jimp` dimuat opsional, hanya untuk thumbnail lokasi `buttonsMessage`.

#### Diubah
- Polling dengan `selectableCount: 1` dikirim sebagai `pollCreationMessageV3`, `toAnnouncementGroup: true` sebagai `pollCreationMessageV2` (sama dengan Baileys rc14).
- `normalizeMessageContent` ikut membuka `associatedChildMessage`, `groupStatusMessage`, `groupStatusMessageV2`, dan `botForwardedMessage`.

#### Catatan
- `stickerPack`: jenis media `sticker-pack` belum ada di `MEDIA_PATH_MAP` / `MEDIA_HKDF_KEY_MAPPING` (sama seperti di levvleys), jadi upload paket stiker ke server WhatsApp kemungkinan gagal. Belum diuji ke server sungguhan.
- Tidak dibawa dari levvleys: penggantian alur LID/participant di `messages-recv`, dedup pesan di `chats`, `uploadFile`/`vid2jpg` (upload ke layanan pihak ketiga), auto-join channel di `newsletter`, banner/branding levvleys.

#### Ditambahkan
- AnchorGuard (anti force-close): `makeWASocket({ AnchorGuard: true, AnchorGuardConfig: {...} })` memasang `sock.anchorGuard`; ekspor `createAnchorGuard`, `createAntiBugGuard`, `detectBug`, `ANCHORGUARD_DEFAULTS`. Pesan masuk yang terdeteksi bug dihapus (opsional blokir pengirim), pesan keluar yang terdeteksi bug ditolak.
- `useSqliteAuthState(pathOrFolder, { fileName, migrateFromFolder })`: auth state di satu file SQLite (`node:sqlite`, Node 22.5+), bisa migrasi dari folder `useMultiFileAuthState`.
- Builder pesan: `buildRichMenuMessage`/`sendRichMenu` dan `sock.richMenu(jid, content)`, `buildWebuiMessage`/`sendInlineWebUI` (HTML inline), `buildInteractiveMessage`/`buildCarouselMessage`/`buildNativeFlowButton`/`sendInteractiveMessage`/`sendCarouselMessage`, `buildButtonsMessage`/`buildListMessage`/`sendClassicMessage`, widget `A2UI` dan `sock.sendA2UI(jid, { a2ui, ... })`.
- Poll bergambar: `sock.sendImagePoll(jid, { name, options: [{ name, image }], selectableCount })`, `generateWAMessageFromImagePoll`, `hashImagePollOption`, konten `imagePoll`.
- Opsi konten `viewOnceV2` / `viewOnceV2Extension` (termasuk untuk teks).
- Opsi `sendMessage`: `isSecret` (hanya perangkat utama penerima), `protected` (tanpa perangkat pendamping penerima), `me` (hanya perangkat sendiri). Juga diterima `relayMessage`.
- Utilitas media (lazy, butuh `sharp`/`fluent-ffmpeg` bila dipakai): `resizeImage`, `convertToWhatsAppVideo`, `convertToOpusAudio`, `getVideoThumbnail`, `probeMedia`, `getMp4Duration`.
- `generateProfilePicture(media, { width, height, quality, full })`; `updateProfilePicture` dan `newsletterUpdatePicture` menerima argumen `dimensions` yang sama. Tanpa argumen hasilnya tetap 640x640 quality 50.
- Ekspor WABinary `ORDER_RESPONSE_NAME`, `FLOW_NAME`.

#### Diubah
- Node `<biz>` untuk pesan bertombol: tipe ditentukan dari SEMUA tombol native flow (bukan hanya yang pertama), sehingga flow `cta_catalog`, `mpm`, `call_request`, `view_catalog`, `wa_pay_detail`, `send_location` mendapat nama native_flow yang benar; `listMessage` kini memakai `<biz><list type="product_list" v="2"/></biz>` seperti WA Web.
- Atribut `mediatype` stanza: wrapper (viewOnce, groupStatus, botForwarded, groupMentioned, botInvoke, deviceSent) dibuka dulu; tambahan `ptv`, `location`, `sticker_pack`, `group_history`.

#### Diperbaiki
- Thumbnail video via ffmpeg memakai `execFile` (tanpa shell). Sebelumnya `exec` dengan path yang disisipkan ke string perintah: path berspasi gagal dan karakter shell di path bisa dieksekusi.

#### Catatan
- Tidak dibawa dari @rennzsync/baileys: ambil versi WA live saat import (`Defaults`, memakai top-level await ESM), perubahan default hemat RAM (`MSG_RETRY`, `syncFullHistory`, `enableRecentMessageCache`), `Store` versi mereka (raiden sudah punya Store sendiri), `whatsapp-rust-bridge`.

### [2.1.3] - 2026-10-18

#### Ditambahkan
- Communities (dari Baileys rc14): `communityMetadata`, `communityCreate`, `communityLeave`, `communityFetchAllParticipating`, `communityCreateGroup`, `communityLinkGroup`, `communityUnlinkGroup`, `communityFetchLinkedGroups`, pengaturan komunitas, undangan, dan permintaan bergabung. Socket teratas kini `makeCommunitiesSocket`; `extractCommunityMetadata` diekspor.
- `lib/Socket/mex.js` (`executeWMexQuery`), `USyncUsernameProtocol`, `Utils/sync-action-utils` (`processContactAction`, `emitSyncActionResults`), `Utils/tc-token-utils`, `Utils/reporting-utils`, `isStringNullOrEmpty`.

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

## Credits

Lihat [CREDITS.md](CREDITS.md).

## License

MIT © Kaze, Kelvin, Tayro
