"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeLidSessionResolver = void 0;
const jid_utils_1 = require("../WABinary/jid-utils");

/**
 * Menentukan ALAMAT PENYIMPANAN sesi Signal untuk sebuah JID.
 * Alamat hanya kunci lokal (protokol tidak berubah), jadi aturannya:
 *   - bila pemetaan PN<->LID diketahui, alamat kanonik = bentuk LID
 *   - sesi lama yang tersimpan di alamat PN dipindah (bukan disalin) ke alamat LID, sekali saja
 *   - tanpa pemetaan, JID dipakai apa adanya
 * Semua kegagalan dibuang ke JID asli supaya kirim/terima pesan tidak pernah putus karena ini.
 *
 * @param keys       SignalKeyStore (get/set)
 * @param lidMapping LIDMappingStore
 * @param toAddress  (jid) => string alamat Signal, mis. 'user.device'
 * @param enabled    false = matikan (selalu kembalikan JID asli)
 */
const makeLidSessionResolver = ({ keys, lidMapping, logger, toAddress, enabled = true }) => {
    const moving = new Map();

    const moveSession = (pnJid, lidJid) => {
        const from = toAddress(pnJid);
        const to = toAddress(lidJid);
        if (from === to) return Promise.resolve(false);
        const k = `${from}>${to}`;
        let p = moving.get(k);
        if (!p) {
            p = (async () => {
                const { [from]: fromSess } = await keys.get('session', [from]);
                if (!fromSess) return false;
                const { [to]: toSess } = await keys.get('session', [to]);
                if (toSess) return false; // sesi LID sudah ada, jangan ditimpa
                await keys.set({ session: { [to]: fromSess, [from]: null } });
                logger.debug({ from, to }, 'sesi dipindah ke alamat LID');
                return true;
            })().finally(() => moving.delete(k));
            moving.set(k, p);
        }
        return p;
    };

    const resolveAddressJid = async (jid) => {
        if (!enabled) return jid;
        try {
            const isPn = (0, jid_utils_1.isJidUser)(jid) || (0, jid_utils_1.isHostedPnUser)(jid);
            const isLid = (0, jid_utils_1.isLidUser)(jid) || (0, jid_utils_1.isHostedLidUser)(jid);
            if (!isPn && !isLid) return jid;
            let pnJid, lidJid;
            if (isPn) {
                pnJid = jid;
                lidJid = await lidMapping.getLIDForPN(jid, { localOnly: true });
            }
            else {
                lidJid = jid;
                pnJid = await lidMapping.getPNForLID(jid);
            }
            if (!pnJid || !lidJid) return jid;
            await moveSession(pnJid, lidJid);
            return lidJid;
        }
        catch (err) {
            logger.warn({ err, jid }, 'gagal menentukan alamat sesi LID, pakai JID asli');
            return jid;
        }
    };

    return { resolveAddressJid, moveSession };
};
exports.makeLidSessionResolver = makeLidSessionResolver;
