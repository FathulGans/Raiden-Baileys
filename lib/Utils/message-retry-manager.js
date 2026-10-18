"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageRetryManager = exports.RetryReason = exports.TTLCache = void 0;

/** Jumlah pesan terkirim yang disimpan di memori untuk menangani retry receipt */
const RECENT_MESSAGES_SIZE = 512;
const MESSAGE_KEY_SEPARATOR = '\u0000';
/** Batas waktu pembuatan ulang sesi - 1 jam */
const RECREATE_SESSION_TIMEOUT = 60 * 60 * 1000;
const PHONE_REQUEST_DELAY = 3000;

/**
 * Cache LRU + TTL kecil tanpa dependensi (pengganti `lru-cache` yang dipakai rc14).
 * Urutan Map = urutan kedaluwarsa (TTL sama untuk semua entri), jadi entri kedaluwarsa
 * cukup dibuang dari depan. `dispose(value, key)` dipanggil saat entri dibuang
 * (kedaluwarsa, tergusur karena penuh, delete, clear), tidak saat ditimpa.
 */
class TTLCache {
    constructor({ max = Infinity, ttl = 0, updateAgeOnGet = false, dispose } = {}) {
        this.max = max;
        this.ttl = ttl;
        this.updateAgeOnGet = updateAgeOnGet;
        this.dispose = dispose;
        this.map = new Map();
    }
    _purge(now = Date.now()) {
        if (!this.ttl) return;
        for (const [key, entry] of this.map) {
            if (entry.exp > now) break;
            this.map.delete(key);
            if (this.dispose) this.dispose(entry.value, key);
        }
    }
    get size() {
        this._purge();
        return this.map.size;
    }
    has(key) {
        return this.get(key, true) !== undefined;
    }
    get(key, noRefresh = false) {
        const now = Date.now();
        const entry = this.map.get(key);
        if (!entry) return undefined;
        if (this.ttl && entry.exp <= now) {
            this.map.delete(key);
            if (this.dispose) this.dispose(entry.value, key);
            return undefined;
        }
        if (this.updateAgeOnGet && this.ttl && !noRefresh) {
            this.map.delete(key);
            entry.exp = now + this.ttl;
            this.map.set(key, entry);
        }
        return entry.value;
    }
    set(key, value) {
        const now = Date.now();
        this.map.delete(key); // timpa = pindah ke akhir
        this._purge(now);
        this.map.set(key, { value, exp: this.ttl ? now + this.ttl : Infinity });
        while (this.map.size > this.max) {
            const oldest = this.map.keys().next().value;
            const entry = this.map.get(oldest);
            this.map.delete(oldest);
            if (this.dispose) this.dispose(entry.value, oldest);
        }
        return this;
    }
    delete(key) {
        const entry = this.map.get(key);
        if (!entry) return false;
        this.map.delete(key);
        if (this.dispose) this.dispose(entry.value, key);
        return true;
    }
    clear() {
        const entries = [...this.map];
        this.map.clear();
        if (this.dispose) for (const [key, entry] of entries) this.dispose(entry.value, key);
    }
}
exports.TTLCache = TTLCache;

// Kode alasan retry, sama dengan kode error Signal di WhatsApp Web.
const RetryReason = {
    UnknownError: 0,
    SignalErrorNoSession: 1,
    SignalErrorInvalidKey: 2,
    SignalErrorInvalidKeyId: 3,
    /** Verifikasi MAC gagal - penyebab paling umum gagal dekripsi */
    SignalErrorInvalidMessage: 4,
    SignalErrorInvalidSignature: 5,
    SignalErrorFutureMessage: 6,
    /** MAC gagal eksplisit - sesi pasti tidak sinkron */
    SignalErrorBadMac: 7,
    SignalErrorInvalidSession: 8,
    SignalErrorInvalidMsgKey: 9,
    BadBroadcastEphemeralSetting: 10,
    UnknownCompanionNoPrekey: 11,
    AdvFailure: 12,
    StatusRevokeDelay: 13
};
for (const [name, code] of Object.entries({ ...RetryReason })) RetryReason[code] = name; // reverse mapping
exports.RetryReason = RetryReason;

/** Kode error MAC: butuh pembuatan ulang sesi segera */
const MAC_ERROR_CODES = new Set([RetryReason.SignalErrorInvalidMessage, RetryReason.SignalErrorBadMac]);

const emptyStats = () => ({
    totalRetries: 0,
    successfulRetries: 0,
    failedRetries: 0,
    mediaRetries: 0,
    sessionRecreations: 0,
    phoneRequests: 0
});

class MessageRetryManager {
    constructor(logger, maxMsgRetryCount) {
        this.logger = logger;
        this.maxMsgRetryCount = maxMsgRetryCount;
        this.messageKeyIndex = new Map();
        this.recentMessagesMap = new TTLCache({
            max: RECENT_MESSAGES_SIZE,
            ttl: 5 * 60 * 1000,
            dispose: (_value, key) => {
                const separatorIndex = key.lastIndexOf(MESSAGE_KEY_SEPARATOR);
                if (separatorIndex > -1) {
                    const messageId = key.slice(separatorIndex + MESSAGE_KEY_SEPARATOR.length);
                    this.messageKeyIndex.delete(messageId);
                }
            }
        });
        this.sessionRecreateHistory = new TTLCache({ ttl: RECREATE_SESSION_TIMEOUT * 2 });
        this.retryCounters = new TTLCache({ ttl: 15 * 60 * 1000, updateAgeOnGet: true });
        this.baseKeys = new TTLCache({ max: 1024, ttl: 15 * 60 * 1000 });
        this.pendingPhoneRequests = {};
        this.statistics = emptyStats();
    }
    /** Simpan pesan terkirim ke cache untuk penanganan retry */
    addRecentMessage(to, id, message) {
        const keyStr = this.keyToString({ to, id });
        this.recentMessagesMap.set(keyStr, { message, timestamp: Date.now() });
        this.messageKeyIndex.set(id, keyStr);
        this.logger.debug(`Added message to retry cache: ${to}/${id}`);
    }
    /** Ambil pesan terkirim dari cache */
    getRecentMessage(to, id) {
        return this.recentMessagesMap.get(this.keyToString({ to, id }));
    }
    /**
     * Tentukan apakah sesi harus dibuat ulang berdasarkan riwayat dan kode error.
     * Error MAC (kode 4 dan 7) langsung memicu pembuatan ulang tanpa menunggu timeout.
     */
    shouldRecreateSession(jid, hasSession, errorCode) {
        if (!hasSession) {
            this.sessionRecreateHistory.set(jid, Date.now());
            this.statistics.sessionRecreations++;
            return { reason: "we don't have a Signal session with them", recreate: true };
        }
        if (errorCode !== undefined && MAC_ERROR_CODES.has(errorCode)) {
            this.sessionRecreateHistory.set(jid, Date.now());
            this.statistics.sessionRecreations++;
            this.logger.warn({ jid, errorCode: RetryReason[errorCode] }, 'MAC error detected, forcing immediate session recreation');
            return {
                reason: `MAC error (code ${errorCode}: ${RetryReason[errorCode]}), immediate session recreation`,
                recreate: true
            };
        }
        const now = Date.now();
        const prevTime = this.sessionRecreateHistory.get(jid);
        if (!prevTime || now - prevTime > RECREATE_SESSION_TIMEOUT) {
            this.sessionRecreateHistory.set(jid, now);
            this.statistics.sessionRecreations++;
            return { reason: 'retry count > 1 and over an hour since last recreation', recreate: true };
        }
        return { reason: '', recreate: false };
    }
    /** Parse kode error dari atribut `error` pada node retry. undefined kalau tidak ada. */
    parseRetryErrorCode(errorAttr) {
        if (errorAttr === undefined || errorAttr === '') {
            return undefined;
        }
        const code = parseInt(errorAttr, 10);
        if (Number.isNaN(code)) {
            return undefined;
        }
        if (code >= RetryReason.UnknownError && code <= RetryReason.StatusRevokeDelay) {
            return code;
        }
        return RetryReason.UnknownError;
    }
    isMacError(errorCode) {
        return errorCode !== undefined && MAC_ERROR_CODES.has(errorCode);
    }
    incrementRetryCount(messageId) {
        this.retryCounters.set(messageId, (this.retryCounters.get(messageId) || 0) + 1);
        this.statistics.totalRetries++;
        return this.retryCounters.get(messageId);
    }
    getRetryCount(messageId) {
        return this.retryCounters.get(messageId) || 0;
    }
    hasExceededMaxRetries(messageId) {
        return this.getRetryCount(messageId) >= this.maxMsgRetryCount;
    }
    markRetrySuccess(messageId) {
        this.statistics.successfulRetries++;
        this.retryCounters.delete(messageId);
        this.cancelPendingPhoneRequest(messageId);
        this.removeRecentMessage(messageId);
    }
    markRetryFailed(messageId) {
        this.statistics.failedRetries++;
        this.retryCounters.delete(messageId);
        this.cancelPendingPhoneRequest(messageId);
        this.removeRecentMessage(messageId);
    }
    /** Jadwalkan permintaan ke HP dengan delay */
    schedulePhoneRequest(messageId, callback, delay = PHONE_REQUEST_DELAY) {
        this.cancelPendingPhoneRequest(messageId);
        this.pendingPhoneRequests[messageId] = setTimeout(() => {
            delete this.pendingPhoneRequests[messageId];
            this.statistics.phoneRequests++;
            callback();
        }, delay);
        this.logger.debug(`Scheduled phone request for message ${messageId} with ${delay}ms delay`);
    }
    cancelPendingPhoneRequest(messageId) {
        const timeout = this.pendingPhoneRequests[messageId];
        if (timeout) {
            clearTimeout(timeout);
            delete this.pendingPhoneRequests[messageId];
            this.logger.debug(`Cancelled pending phone request for message ${messageId}`);
        }
    }
    clear() {
        this.recentMessagesMap.clear();
        this.messageKeyIndex.clear();
        this.sessionRecreateHistory.clear();
        this.retryCounters.clear();
        this.baseKeys.clear();
        for (const messageId of Object.keys(this.pendingPhoneRequests)) {
            this.cancelPendingPhoneRequest(messageId);
        }
        this.statistics = emptyStats();
    }
    saveBaseKey(addr, msgId, baseKey) {
        this.baseKeys.set(`${addr}:${msgId}`, baseKey);
    }
    hasSameBaseKey(addr, msgId, baseKey) {
        const stored = this.baseKeys.get(`${addr}:${msgId}`);
        if (!stored || stored.length !== baseKey.length) {
            return false;
        }
        for (let i = 0; i < stored.length; i++) {
            if (stored[i] !== baseKey[i])
                return false;
        }
        return true;
    }
    deleteBaseKey(addr, msgId) {
        this.baseKeys.delete(`${addr}:${msgId}`);
    }
    keyToString(key) {
        return `${key.to}${MESSAGE_KEY_SEPARATOR}${key.id}`;
    }
    removeRecentMessage(messageId) {
        const keyStr = this.messageKeyIndex.get(messageId);
        if (!keyStr) {
            return;
        }
        this.recentMessagesMap.delete(keyStr);
        this.messageKeyIndex.delete(messageId);
    }
}
exports.MessageRetryManager = MessageRetryManager;
