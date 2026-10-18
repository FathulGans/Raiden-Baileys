# Ringkasan perubahan (fork baileys-main + LID dari Baileys v7)

Sudah diterapkan di pohon ini (tidak perlu menjalankan patch lagi):
1. WABinary/jid-utils.js  : hosted/hosted.lid, isPnUser, transferDevice
2. Signal/lid-mapping.js  : LIDMappingStore (PN<->LID, persisten, fallback USync)
3. lid-step3.patch        : wiring ke libsignal/socket/usync/messages-recv/process-message/history,
                            event `lid-mapping.update`
4. lid-step4.patch + Signal/lid-session.js : alamat sesi Signal kanonik = LID, sesi PN lama dipindah
5. WAProto/index.js       : diganti dengan versi rc14 (index.d.ts TETAP milik fork)
6. Langkah 3 (sinkron rc14, retry): Utils/message-retry-manager.js (baru, TTLCache buatan sendiri tanpa lru-cache),
   Defaults enableRecentMessageCache/enableAutoSessionRecreation (default aktif), messages-send (cache pesan terkirim,
   dibersihkan saat koneksi close, sock.messageRetryManager), messages-recv (sendRetryRequest: hitung retry via manager,
   buat ulang sesi, phone request terjadwal; sendMessagesAgain: cache dulu, bundle sesi dari retry receipt, cek reg id,
   deteksi tabrakan base key), libsignal (validateSession, getSessionInfo, alamat sesi kanonik LID),
   Utils/signal (extractE2ESessionFromRetryReceipt). Matikan dengan makeWASocket({ enableRecentMessageCache: false }).
   Tes: retry-step3a, retry-step3c1. BELUM ada tes untuk messages-recv/libsignal (butuh dependensi penuh + koneksi).
   CATATAN: hanya bagian retry yang dimasukkan. DICT_VERSION 3, WA_ADV_* prefix, dan pre-key-manager (langkah 1-2 rc14)
   SENGAJA tidak ikut karena pohon ini belum memakai token WABinary rc14.
7. Langkah 4 (sinkron rc14, decode): Utils/decode-wa-message.js ditulis ulang ala rc14: extractAddressingContext,
   getDecryptionJid (LID bila ada pemetaan lokal), key.remoteJidAlt/participantAlt/*Username/addressingMode,
   fromMe memperhitungkan LID sendiri (grup, broadcast, chat), hosted/hosted.lid, recipient Meta AI, id/from wajib,
   tag plaintext, unavailable view_once (key.isViewOnce, tanpa stub), retryCount dari <enc count>.
   Ekspor baru: NACK_REASONS, SERVER_ERROR_CODES, MISSING_KEYS_ERROR_TEXT, ACCOUNT_RESTRICTED_TEXT,
   NO_MESSAGE_FOUND_ERROR_TEXT (sebelumnya dipakai messages-recv tapi tidak terdefinisi), DECRYPTION_RETRY_CONFIG.
   jid-utils: isJidMetaAI. Tipe IMessageKey di index.d.ts ditambah field *Alt. Tes: node test/decode-step4.test.js
   Dipertahankan dari fork: cabang newsletter, stub "tidak ada pesan" = [teks, stanza JSON], key.participant tidak diubah di decode.
   TIDAK dibawa: storeMappingFromEnvelope+migrateSession (pemetaan sudah disimpan di messages-recv sebelum dekripsi,
   migrasi sesi ditangani lid-session).
8. Langkah 4b: messages-recv handleMessage tidak lagi mengganti key.participant LID orang lain dengan JID sendiri
   (bug fork) dan tidak lagi membuat key.remoteJid jadi undefined saat PN tak diketahui. Helper resolvePnForLid:
   kandidat PN dari stanza -> LID sendiri -> pemetaan lokal -> kalau tidak ada, LID dibiarkan. Saat diganti ke PN,
   LID asli disimpan di participantAlt/remoteJidAlt. Tes: node test/pn-resolve-step4b.test.js
   (hanya menguji helper; alur handleMessage penuh belum teruji tanpa dependensi + koneksi).
9. Langkah 1 (sinkron rc14, WABinary): constants.js dibangkitkan dari rc14 (single 236 + double 4x256 token identik,
   TAGS INTEROP_JID/FB_JID; SINGLE_BYTE_MAX/STREAM_END milik fork dipertahankan), DICT_VERSION 2->3 (header noise
   [87,65,6,3]), decode.js (readAdJid hosted/hosted.lid, readFbJid, readInteropJid), jid-utils (META_AI_JID,
   getServerFromDomainType, jidDecode membaca agent), Defaults WA_ADV_* prefix. encode.js sudah identik rc14.
   Tabel token lama (dict v2) ada di /tmp saja; rollback = zip langkah 4b + jangan pakai file ini.
   Tes: node test/wabinary-step1.test.js (roundtrip semua token). BELUM diuji ke server WhatsApp sungguhan:
   kalau login gagal tepat setelah langkah ini, curigai DICT_VERSION/token dulu.
10. Langkah 2 (sinkron rc14, kunci Signal): Utils/pre-key-manager.js (baru, SerialQueue pengganti p-queue) dan
   Utils/auth-utils.js (makeCacheableSignalKeyStore pakai mutex; addTransactionCapability ditulis ulang:
   AsyncLocalStorage, mutex per key dengan ref-count, antrean per tipe key, validasi hapus pre-key, retry commit
   melempar error di percobaan terakhir; assertMeId; initAuthCreds + additionalData, field mobile fork tetap).
   transaction(work, key='default'). 6 pemanggil sekarang mengirim key seperti rc14 (meId atau label), jadi
   transaksi berjalan serial per akun. Dampak: kirim ke banyak chat paralel menunggu bergantian saat satu transaksi
   menunggu jaringan (sama dengan rc14). Perubahan semantik: set() di dalam transaksi kini async (await!),
   penghapusan pre-key yang tidak ada di cache transaksi dilewati dengan peringatan.
   Tes: node test/tx-step2.test.js (pakai stub Mutex). libsignal.js rc14 membungkus operasi per-jid dalam transaksi
   (belum dibawa ke fork ini).

Tombol pengaman: makeWASocket({ lidSessionMigration: false }) mematikan langkah 4.
Tes: node test/lid-step1.test.js && node test/lid-step3.test.js && node test/lid-step4.test.js

Belum dilakukan / belum teruji:
- Belum diuji dengan koneksi WhatsApp sungguhan.
- Auto-follow channel tersembunyi di lib/Socket/newsletter.js (~baris 102) MASIH ADA.
- Sender key grup belum dimigrasi ke LID.
- (selesai) WABinary/constants + DICT_VERSION sudah sama dengan rc14; domainType hosted 128/129 sudah dicek terhadap rc14.
- Versi WA di lib/Defaults/baileys-version.json sengaja TIDAK disamakan (punya fork lebih baru dari rc14).
- engine-requirements.js masih ">=20"; WAProto ESM butuh Node 22.12+ (atau 20.19+).
