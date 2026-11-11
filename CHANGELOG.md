# Changelog

Semua perubahan penting pada **Raiden-Baileys** dicatat di sini.

## [2.2.4] - 2026-11-11

### Ditambahkan
- `sock.sendMetaStep(jid, { title, body, disabled })` dengan `meta.step()`, `meta.finish()`, `meta.update()`: pesan indikator langkah memakai `proto.BotProgressIndicatorMetadata`. Status langkah `PLANNED` / `EXECUTING` / `FINISHED`; opsi `reasoning`, `sections`, `sources`.

## [2.2.3] - 2026-11-11

### Ditambahkan
- WAProto diperbarui ke **WhatsApp 2.3000.1054022738** (sebelumnya 2.3000.1053411851): 9 tipe baru, 16 field baru, 12 nilai enum baru. Contoh: `Message.VpcRequestMessage`, `Message.PaymentDetailsMessage`, `GroupRootKey`, `GroupRootKeyRequest`, `ClientPayload.IntegrationAttestation`, `StatusAttribution.StatusTemplate`, `Account.PnLearnState`, field `Message.instantVideoMessage`, `ContextInfo.forwardReachScore`, `MemberLabel.showAdminBadge`.

### Catatan
- Tidak ada tipe, field, atau nilai enum lama yang dihapus. Hasil encode/decode pesan yang sudah ada tidak berubah.
- `Message.ChatSolidColorWallpaper.backgroundLightArgb` / `backgroundDarkArgb` tidak ditambahkan karena nomor field 1 dan 2 sudah dipakai `colorLight` / `colorDark`.

## [2.2.2] - 2026-11-06

### Ditambahkan
- WAProto diperbarui ke **WhatsApp 2.3000.1053411851** (sebelumnya 2.3000.1038158069): 44 tipe baru, 92 field baru, 95 nilai enum baru. Contoh tipe baru: `Message.RequestLocationMessage`, `Message.RequestLocationUpdateMessage`, `Message.ChatAnimatedWallpaper`, `Message.MusicMessage.Lyrics`, `Message.SharedDeviceContactHashKey`, `BotInterjectionMetadata`, `BizAIMetadataSync`.
- `getTypeUrl()` tersedia di semua tipe proto.

### Diperbaiki
- `proto.BotAvatarMetadata.toJSON()` tidak lagi error (bug sejak 2.2.0).

### Catatan
- Tidak ada tipe, field, atau nilai enum lama yang dihapus. Proto lama yang tidak ada di WhatsApp Web (mis. `ConsumerApplication`) tetap dipertahankan.
- `ChatSolidColorWallpaper` tetap memakai nama field lama `colorLight` / `colorDark` (WhatsApp Web menamainya `backgroundLightArgb` / `backgroundDarkArgb`, nomor field sama).
- Hasil encode/decode pesan yang sudah ada tidak berubah.

## [2.2.1] - 2026-11-06

### Diubah
- Dokumentasi README dan CHANGELOG dirapikan. Tidak ada perubahan kode.

## [2.2.0] - 2026-11-06

### Ditambahkan
- `sock.sendPrivateRelay(jid, message, options)`: kirim pesan ke sebagian perangkat saja (`mode` include/exclude, `target` nomor/PN/LID/device, `deviceMode` all/primary/secondary, `targetMe`, `ai`, `statusJidList`). Mendukung 1:1, grup, status, dan newsletter. Tipe `PrivateRelayOptions` di `index.d.ts`.
- `signalRepository.encryptGroupMessage({ ..., resetSenderKey })`: paksa sender key baru.
- Node relay otomatis bila belum ada di `additionalNodes`: `biz` untuk `productMessage` (`catalog_message`), `orderMessage` (`order_details`), tombol `payment_key_info`; `meta event_type=creation` untuk `eventMessage`; `meta polltype=creation` untuk semua varian `pollCreationMessage` yang dikirim lewat `relayMessage`.
- `sendMessage` konten baru: `photoPoll` (alias `sendImagePoll`, format `values`), `buttonLocation` (buttonsMessage header lokasi), `rawMessage` (proto.IMessage mentah).
- Poll bergambar kini mengirim `meta contenttype=image` pada induk dan `meta message_association_type=media_poll` pada tiap opsi.
- WAProto: enum `proto.Message.MediaKeyDomain` (`UNSET`, `E2EE_CHAT`, `STATUS`, `CAPI`, `BOT`) dan field `mediaKeyDomain` di `AudioMessage` (23), `DocumentMessage` (22), `ImageMessage` (33), `MMSThumbnailMetadata` (8), `StickerMessage` (23), `VideoMessage` (32). Tipe `proto.BotAvatarMetadata` dan field `BotMetadata.avatarMetadata` (1). Proto lain tidak berubah.

### Catatan
- Target `"628xx:2"` tanpa `@` dibaca sebagai nomor + device.
- Private relay grup mengosongkan `sender-key-memory` setelah sender key diganti, agar pesan grup normal berikutnya tetap bisa didekripsi semua anggota. Perangkat ini sendiri tidak menerima SKDM.
- Perilaku pesan lain (teks, media, tombol, list, interactive) tidak berubah.

## [2.1.7] - 2026-11-02

### Diubah
- README: bagian Testing dihapus karena folder `test/` tidak ikut paket npm. Label asal port di changelog README dirapikan.

## [2.1.6] - 2026-11-02

### Diperbaiki
- Link banner README kini memakai file di repo sendiri (`assets/banner.png`), sehingga tampil di GitHub dan npm.

## [2.1.5] - 2026-11-02

### Ditambahkan
- Dukungan dual package **CJS + ESM**: `require('raiden-baileys')` dan `import ... from 'raiden-baileys'` sama-sama jalan. Entry ESM `lib/index.mjs` (default export + 319 named export) hanya membungkus `lib/index.js` lewat `createRequire`, jadi hanya ada satu instance modul.
- Field `exports` di `package.json` (kondisi `import`/`require`/`default`, plus `./WAProto`, `./lib/*`, `./package.json`) dan field `module`.
- Tipe ESM `lib/index.d.mts`.
- `scripts/gen-esm.js` (`npm run build:esm`) untuk membuat ulang `lib/index.mjs` dari export CJS.

### Catatan
- Kode di `lib/` tidak diubah, tetap CommonJS.
- Karena `exports` kini aktif, import folder seperti `raiden-baileys/lib/Utils` tidak lagi bisa; pakai `raiden-baileys/lib/Utils/index`. Import file (dengan atau tanpa `.js`) tetap bisa.

## [2.1.4] - 2026-10-31

### Ditambahkan
- Tipe pesan baru di `sendMessage` / `generateWAMessageContent`: `pin`, `keep`, `call` (scheduled call), `paymentInvite`, `ptv`, `order`, `groupInvite`, `event`, `inviteAdmin`, `requestPayment`, `album`, `groupStatus`, `orderStatus`, `buttonsMessage` (termasuk lokasi + thumbnail), `stickerPack`, `richMessage` (teks/kode/tabel/html/gambar/video/produk/post/reels/sumber/saran, `editrich`), `richMessageV2`, `interactiveButtons`, `shop`. Tombol biasa kini mendukung `title`, `contextInfo`, `mentions`.
- `sendMessage(jid, { album: [{ image }, { video }], caption })`: header album + item media terhubung (`messageAssociation`), jeda antar item lewat config `albumMessageItemDelayMs` (default 0). Format `albumMessage` lama (ClutchHandler) tetap jalan.
- `sendMessage` mengisi atribut stanza untuk pin (`edit=2`), keep (`edit=6`), node `meta polltype=creation` untuk polling, dan `media_id` dari hasil upload.
- `richMessage.editrich`: pesan rich diedit otomatis setelah terkirim (`editrich.delay` dalam ms). Di luar `sock.sendMessage`, berikan `options.conn` ke `generateWAMessage` atau panggil `setRichMessageConnection(sock)`.
- Ekspor baru: `toJid`, `prepareAlbumMessageContent`, `processLocationThumbnail`, `setRichMessageConnection`, `isJidNewsletter` & `isJidMetaAi` (alias), `isJidBot`, `getBotJid`.
- Grup: `groupRevokeInviteV4(groupJid, invitedJid)`; metadata grup kini berisi `descTime`, `linkedParent`, dan `participants[].lid`.
- Event `group.join-request` (`{ id, author, participant, action, method }`) saat ada permintaan bergabung grup.
- Dependensi `fflate` (untuk `stickerPack`). `jimp` dimuat opsional, hanya untuk thumbnail lokasi `buttonsMessage`.

### Diubah
- Polling dengan `selectableCount: 1` dikirim sebagai `pollCreationMessageV3`, `toAnnouncementGroup: true` sebagai `pollCreationMessageV2` (sama dengan Baileys rc14).
- `normalizeMessageContent` ikut membuka `associatedChildMessage`, `groupStatusMessage`, `groupStatusMessageV2`, dan `botForwardedMessage`.

### Catatan
- `stickerPack`: jenis media `sticker-pack` belum ada di `MEDIA_PATH_MAP` / `MEDIA_HKDF_KEY_MAPPING` (sama seperti di levvleys), jadi upload paket stiker ke server WhatsApp kemungkinan gagal. Belum diuji ke server sungguhan.
- Tidak dibawa dari levvleys: penggantian alur LID/participant di `messages-recv`, dedup pesan di `chats`, `uploadFile`/`vid2jpg` (upload ke layanan pihak ketiga), auto-join channel di `newsletter`, banner/branding levvleys.

### Ditambahkan
- AnchorGuard (anti force-close): `makeWASocket({ AnchorGuard: true, AnchorGuardConfig: {...} })` memasang `sock.anchorGuard`; ekspor `createAnchorGuard`, `createAntiBugGuard`, `detectBug`, `ANCHORGUARD_DEFAULTS`. Pesan masuk yang terdeteksi bug dihapus (opsional blokir pengirim), pesan keluar yang terdeteksi bug ditolak.
- `useSqliteAuthState(pathOrFolder, { fileName, migrateFromFolder })`: auth state di satu file SQLite (`node:sqlite`, Node 22.5+), bisa migrasi dari folder `useMultiFileAuthState`.
- Builder pesan: `buildRichMenuMessage`/`sendRichMenu` dan `sock.richMenu(jid, content)`, `buildWebuiMessage`/`sendInlineWebUI` (HTML inline), `buildInteractiveMessage`/`buildCarouselMessage`/`buildNativeFlowButton`/`sendInteractiveMessage`/`sendCarouselMessage`, `buildButtonsMessage`/`buildListMessage`/`sendClassicMessage`, widget `A2UI` dan `sock.sendA2UI(jid, { a2ui, ... })`.
- Poll bergambar: `sock.sendImagePoll(jid, { name, options: [{ name, image }], selectableCount })`, `generateWAMessageFromImagePoll`, `hashImagePollOption`, konten `imagePoll`.
- Opsi konten `viewOnceV2` / `viewOnceV2Extension` (termasuk untuk teks).
- Opsi `sendMessage`: `isSecret` (hanya perangkat utama penerima), `protected` (tanpa perangkat pendamping penerima), `me` (hanya perangkat sendiri). Juga diterima `relayMessage`.
- Utilitas media (lazy, butuh `sharp`/`fluent-ffmpeg` bila dipakai): `resizeImage`, `convertToWhatsAppVideo`, `convertToOpusAudio`, `getVideoThumbnail`, `probeMedia`, `getMp4Duration`.
- `generateProfilePicture(media, { width, height, quality, full })`; `updateProfilePicture` dan `newsletterUpdatePicture` menerima argumen `dimensions` yang sama. Tanpa argumen hasilnya tetap 640x640 quality 50.
- Ekspor WABinary `ORDER_RESPONSE_NAME`, `FLOW_NAME`.

### Diubah
- Node `<biz>` untuk pesan bertombol: tipe ditentukan dari SEMUA tombol native flow (bukan hanya yang pertama), sehingga flow `cta_catalog`, `mpm`, `call_request`, `view_catalog`, `wa_pay_detail`, `send_location` mendapat nama native_flow yang benar; `listMessage` kini memakai `<biz><list type="product_list" v="2"/></biz>` seperti WA Web.
- Atribut `mediatype` stanza: wrapper (viewOnce, groupStatus, botForwarded, groupMentioned, botInvoke, deviceSent) dibuka dulu; tambahan `ptv`, `location`, `sticker_pack`, `group_history`.

### Diperbaiki
- Thumbnail video via ffmpeg memakai `execFile` (tanpa shell). Sebelumnya `exec` dengan path yang disisipkan ke string perintah: path berspasi gagal dan karakter shell di path bisa dieksekusi.

### Catatan
- Tidak dibawa dari @rennzsync/baileys: ambil versi WA live saat import (`Defaults`, memakai top-level await ESM), perubahan default hemat RAM (`MSG_RETRY`, `syncFullHistory`, `enableRecentMessageCache`), `Store` versi mereka (raiden sudah punya Store sendiri), `whatsapp-rust-bridge`.

## [2.1.3] - 2026-10-18

### Ditambahkan
- Communities (dari Baileys rc14): `communityMetadata`, `communityCreate`, `communityLeave`, `communityFetchAllParticipating`, `communityCreateGroup`, `communityLinkGroup`, `communityUnlinkGroup`, `communityFetchLinkedGroups`, pengaturan komunitas, undangan, dan permintaan bergabung. Socket teratas kini `makeCommunitiesSocket`; `extractCommunityMetadata` diekspor.
- `lib/Socket/mex.js` (`executeWMexQuery`), `USyncUsernameProtocol`, `Utils/sync-action-utils` (`processContactAction`, `emitSyncActionResults`), `Utils/tc-token-utils`, `Utils/reporting-utils`, `isStringNullOrEmpty`.

### Diubah
- `messages-recv`: ack kini dibangun `buildAckStanza` (Utils/stanza-ack) seperti rc14.
- `messages-recv`: notifikasi perubahan identitas kini ditangani `handleIdentityChange` (sesi disegarkan, dengan debounce, dilewati untuk perangkat pendamping, akun sendiri, dan pemrosesan offline). Sebelumnya hanya dicatat di log.
- `messages-recv`: pemroses node offline memakai `makeOfflineNodeProcessor` (error handler tidak lagi menghentikan antrean, event loop diberi jeda tiap 10 node).
- Banner konsol diganti dengan logo Raiden-Baileys (ANSI pixel art 60 kolom, muat di layar panel HP), tanpa box, dan teks info dirapikan.
- "Recode by" kini mencantumkan Kaze, Kelvin, Tayro.
- Lisensi, author, dan daftar contributors di `package.json`, `LICENSE`, dan README diperbarui (Kaze, Kelvin, Tayro).

### Diperbaiki
- Types TypeScript: `package.json` menunjuk `lib/index.d.ts` yang tidak ada, dan `WAProto/index.d.ts` tidak ikut terpublish. Kini `lib/index.d.ts` ditambahkan (makeWASocket, auth, JID utils, helper pesan, re-export `proto`) dan `WAProto/*.d.ts` dimasukkan ke `files`.

## [2.1.2] - 2026-10-18

### Ditambahkan
- API socket baru (disamakan dengan Baileys rc14): `updateMessagesPrivacy`, `updateCallPrivacy`, `updateDisableLinkPreviewsPrivacy`, `getBotListV2`, `fetchDisappearingDuration(...jids)`, `createCallLink(type, event?, timeoutMs?)`, `updateMemberLabel(jid, label)`, `issuePrivacyTokens(jids, timestamp?)`, `newsletterUpdate(jid, updates)`.
- API socket baru (disamakan dengan Baileys rc14): `addOrEditContact(jid, contact)`, `removeContact(jid)`, `addLabel(jid, { id, name, color, deleted })`, `addOrEditQuickReply({ shortcut, message })`, `removeQuickReply(timestamp)`.
- `chatModificationToAppPatch` mendukung `contact`, `addLabel`, `quickReply`, dan `disableLinkPreviews`; sinkronisasi app-state memancarkan event `settings.update` untuk pengaturan link preview.

### Diperbaiki
- `WAProto/index.js` diubah dari ESM ke CommonJS. Sebelumnya file ini berformat ESM (`import`/`export`) sementara seluruh `lib/` memakai `require`, sehingga di Node 20 sebelum 20.19 paket gagal dimuat. Kini berjalan di semua Node 20+.
- `fluent-ffmpeg` dipakai di `lib/Utils/MessageBuilder.js` dan `messages-media.js` tetapi **tidak tercantum di `package.json`**, sehingga pada instalasi baru `require('raiden-baileys')` bisa gagal dengan "Cannot find module". Kini dicantumkan di `dependencies`.
- `MessageBuilder.js` memuat `sharp` dan `fluent-ffmpeg` di baris paling atas padahal `sharp` bersifat opsional. Kini keduanya dimuat saat dibutuhkan, dengan pesan error yang jelas jika belum terpasang.

## [2.1.1] - 2026-10-18

### Diubah
- Banner README memakai link langsung agar tampil di npm.
- Bagian "Catatan / Belum selesai" dihapus dari dokumentasi.

## [2.1.0] - 2026-10-18

### Diubah
- Proyek diganti nama menjadi **Raiden-Baileys** (paket `raiden-baileys`).
- Banner konsol diganti dengan logo Raiden-Baileys (pixel art dua baris) dan kotak banner dirapikan.
- Banner README dipindah ke `assets/banner.png`.
- Versi paket naik ke 2.1.0.

## [2.0.0] - 2026-10-18

### Ditambahkan
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

### Diubah
- **WAProto** diganti dengan versi rc14 (`index.d.ts` tetap milik fork).
- **WABinary**: `constants.js` dibangkitkan ulang dari rc14, `DICT_VERSION` 2 → 3 (header noise `[87,65,6,3]`), `decode.js` mendukung `readAdJid` hosted/hosted.lid, `readFbJid`, `readInteropJid`; prefix `WA_ADV_*` di Defaults.
- **decode-wa-message** ditulis ulang ala rc14: `extractAddressingContext`, `getDecryptionJid` (LID bila ada pemetaan), `fromMe` memperhitungkan LID sendiri, recipient Meta AI, tag plaintext, `view_once` tidak tersedia, `retryCount` dari `<enc count>`.
- **auth-utils**: `makeCacheableSignalKeyStore` memakai mutex; `addTransactionCapability` ditulis ulang (AsyncLocalStorage, mutex per key dengan ref-count, antrean per tipe key, validasi hapus pre-key, retry commit melempar error di percobaan terakhir); `initAuthCreds` + `additionalData`.
- `transaction(work, key = 'default')`: transaksi kini serial per akun, jadi kirim paralel ke banyak chat bisa menunggu bergantian.
- `libsignal`: `validateSession`, `getSessionInfo`, alamat sesi kanonik LID. `signal`: `extractE2ESessionFromRetryReceipt`.
- Identitas proyek: nama proyek menjadi **Raiden-Baileys** (paket `raiden-baileys`); author, keywords, README, dan banner konsol diganti ke **Kaze** (WA +6281549501054, IG @qwerty267_).

### Diperbaiki
- `messages-recv.handleMessage` tidak lagi mengganti `key.participant` LID orang lain dengan JID sendiri.
- `key.remoteJid` tidak lagi menjadi `undefined` saat PN tidak diketahui (helper `resolvePnForLid`; LID asli disimpan di `participantAlt` / `remoteJidAlt`).
- Konstanta yang dipakai `messages-recv` tapi sebelumnya tidak terdefinisi kini diekspor.

### Perubahan perilaku (breaking)
- `set()` di dalam transaksi kini **async** (wajib `await`).
- Penghapusan pre-key yang tidak ada di cache transaksi dilewati dengan peringatan.
