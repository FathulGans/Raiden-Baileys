"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LIDMappingStore = void 0;
exports.extractLidPnPairs = void 0;
const WABinary_1 = require("../WABinary/jid-utils");

const KEY_TYPE = 'lid-mapping';

/**
 * Penyimpan pemetaan PN <-> LID tingkat USER (device ditambahkan saat membaca).
 * Disimpan di key store: pnUser -> lidUser, dan `${lidUser}_reverse` -> pnUser.
 *
 * @param keys          SignalKeyStore (punya get(type, ids) dan set(data))
 * @param logger        logger pino
 * @param pnToLIDFunc   (opsional) async (jids[]) => [{ pn, lid }] untuk cadangan lewat USync
 * @param onNewMappings (opsional) (pairs[]) => void, dipanggil setelah pemetaan BARU tersimpan
 */
class LIDMappingStore {
    constructor(keys, logger, pnToLIDFunc, onNewMappings) {
        this.keys = keys;
        this.logger = logger;
        this.pnToLIDFunc = pnToLIDFunc;
        this.onNewMappings = onNewMappings;
        this.cache = new Map(); // pnUser -> lidUser, `${lidUser}_reverse` -> pnUser
        this.inflight = new Map(); // dedup query USync yang sedang berjalan
    }

    /** dipasang belakangan karena executeUSyncQuery baru ada di layer usync */
    setPnToLIDFunc(fn) {
        this.pnToLIDFunc = fn;
    }

    async storeLIDPNMappings(pairs) {
        const writes = {};
        const created = [];
        for (const { lid, pn } of pairs || []) {
            // terima urutan terbalik, seperti upstream
            const [a, b] = (0, WABinary_1.isLidUser)(lid) || (0, WABinary_1.isHostedLidUser)(lid) ? [lid, pn] : [pn, lid];
            const lidOk = (0, WABinary_1.isLidUser)(a) || (0, WABinary_1.isHostedLidUser)(a);
            const pnOk = (0, WABinary_1.isJidUser)(b) || (0, WABinary_1.isHostedPnUser)(b);
            if (!lidOk || !pnOk) {
                this.logger.warn({ lid, pn }, 'pemetaan LID-PN tidak valid');
                continue;
            }
            const lidUser = (0, WABinary_1.jidDecode)(a)?.user;
            const pnUser = (0, WABinary_1.jidDecode)(b)?.user;
            if (!lidUser || !pnUser) continue;
            if (this.cache.get(pnUser) === lidUser) continue;
            const { [pnUser]: stored } = await this.keys.get(KEY_TYPE, [pnUser]);
            if (stored === lidUser) {
                this.cache.set(pnUser, lidUser);
                this.cache.set(`${lidUser}_reverse`, pnUser);
                continue;
            }
            writes[pnUser] = lidUser;
            writes[`${lidUser}_reverse`] = pnUser;
            created.push({ lid: (0, WABinary_1.jidEncode)(lidUser, (0, WABinary_1.isHostedLidUser)(a) ? 'hosted.lid' : 'lid'), pn: (0, WABinary_1.jidEncode)(pnUser, (0, WABinary_1.isHostedPnUser)(b) ? 'hosted' : 's.whatsapp.net') });
            this.cache.set(pnUser, lidUser);
            this.cache.set(`${lidUser}_reverse`, pnUser);
        }
        if (Object.keys(writes).length) {
            await this.keys.set({ [KEY_TYPE]: writes });
            this.logger.trace({ count: Object.keys(writes).length / 2 }, 'pemetaan LID-PN disimpan');
        }
        if (created.length && this.onNewMappings) {
            try {
                this.onNewMappings(created);
            }
            catch (err) {
                this.logger.warn({ err }, 'onNewMappings melempar error');
            }
        }
    }

    async getLIDForPN(pn, opts) {
        const res = await this.getLIDsForPNs([pn], opts);
        return res?.[0]?.lid ?? null;
    }

    /** opts.localOnly = true -> jangan pernah memanggil USync (untuk jalur kirim/terima yang sensitif latensi) */
    async getLIDsForPNs(pns, opts) {
        const out = [];
        const missing = [];
        for (const pn of pns) {
            if (!(0, WABinary_1.isJidUser)(pn) && !(0, WABinary_1.isHostedPnUser)(pn)) continue;
            const decoded = (0, WABinary_1.jidDecode)(pn);
            if (!decoded?.user) continue;
            let lidUser = this.cache.get(decoded.user);
            if (!lidUser) {
                const { [decoded.user]: stored } = await this.keys.get(KEY_TYPE, [decoded.user]);
                if (stored) {
                    lidUser = stored;
                    this.cache.set(decoded.user, stored);
                    this.cache.set(`${stored}_reverse`, decoded.user);
                }
            }
            if (lidUser) out.push({ pn, lid: this._buildLid(lidUser, decoded) });
            else missing.push(pn);
        }
        if (missing.length && this.pnToLIDFunc && !(opts && opts.localOnly)) {
            const key = missing.slice().sort().join(',');
            let p = this.inflight.get(key);
            if (!p) {
                p = this.pnToLIDFunc(missing.map((m) => (0, WABinary_1.jidNormalizedUser)(m)))
                    .catch((err) => {
                        this.logger.warn({ err }, 'USync PN->LID gagal');
                        return undefined;
                    })
                    .finally(() => this.inflight.delete(key));
                this.inflight.set(key, p);
            }
            const found = await p;
            if (found?.length) {
                await this.storeLIDPNMappings(found);
                for (const pn of missing) {
                    const decoded = (0, WABinary_1.jidDecode)(pn);
                    const lidUser = this.cache.get(decoded.user);
                    if (lidUser) out.push({ pn, lid: this._buildLid(lidUser, decoded) });
                }
            }
        }
        return out.length ? out : null;
    }

    async getPNForLID(lid) {
        if (!(0, WABinary_1.isLidUser)(lid) && !(0, WABinary_1.isHostedLidUser)(lid)) return null;
        const decoded = (0, WABinary_1.jidDecode)(lid);
        if (!decoded?.user) return null;
        const rk = `${decoded.user}_reverse`;
        let pnUser = this.cache.get(rk);
        if (!pnUser) {
            const { [rk]: stored } = await this.keys.get(KEY_TYPE, [rk]);
            if (!stored) {
                this.logger.trace({ lid }, 'pemetaan balik tidak ditemukan');
                return null;
            }
            pnUser = stored;
            this.cache.set(rk, stored);
            this.cache.set(pnUser, decoded.user);
        }
        const server = (0, WABinary_1.isHostedLidUser)(lid) ? 'hosted' : 's.whatsapp.net';
        return (0, WABinary_1.jidEncode)(pnUser, server, decoded.device);
    }

    _buildLid(lidUser, pnDecoded) {
        const server = pnDecoded.server === 'hosted' ? 'hosted.lid' : 'lid';
        return (0, WABinary_1.jidEncode)(lidUser, server, pnDecoded.device);
    }
}
exports.LIDMappingStore = LIDMappingStore;

/**
 * Ambil pasangan LID<->PN dari atribut stanza pesan masuk.
 * Nama atribut diambil dari pemakaian di fork (sender_pn, participant_pn, peer_recipient_pn)
 * dan dari ingatan tentang upstream (sender_lid, participant_lid) -> cek di rc14.
 * Hasilnya divalidasi lagi oleh storeLIDPNMappings.
 */
const extractLidPnPairs = (attrs) => {
    const out = [];
    if (!attrs) return out;
    const isLid = (j) => (0, WABinary_1.isLidUser)(j) || (0, WABinary_1.isHostedLidUser)(j);
    const isPn = (j) => (0, WABinary_1.isJidUser)(j) || (0, WABinary_1.isHostedPnUser)(j);
    const add = (a, b) => {
        if (!a || !b) return;
        if (isLid(a) && isPn(b)) out.push({ lid: a, pn: b });
        else if (isPn(a) && isLid(b)) out.push({ lid: b, pn: a });
    };
    add(attrs.from, attrs.sender_pn);
    add(attrs.from, attrs.sender_lid);
    add(attrs.participant, attrs.participant_pn);
    add(attrs.participant, attrs.participant_lid);
    add(attrs.recipient, attrs.peer_recipient_pn);
    add(attrs.recipient, attrs.peer_recipient_lid);
    return out;
};
exports.extractLidPnPairs = extractLidPnPairs;
