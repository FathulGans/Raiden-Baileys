"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PreKeyManager = exports.SerialQueue = void 0;
// Port dari Baileys rc14 (src/Utils/pre-key-manager.ts). `p-queue` (concurrency 1) diganti SerialQueue sederhana
// supaya tidak menambah dependensi.
/** Antrean dengan konkurensi 1: tugas jalan berurutan, tugas yang gagal tidak memblokir antrean */
class SerialQueue {
    constructor() {
        this.tail = Promise.resolve();
    }
    add(task) {
        const result = this.tail.then(() => task());
        this.tail = result.then(() => undefined, () => undefined);
        return result;
    }
}
exports.SerialQueue = SerialQueue;
/**
 * Mengelola operasi pre-key dengan kontrol konkurensi
 */
class PreKeyManager {
    constructor(store, logger) {
        this.store = store;
        this.logger = logger;
        this.queues = new Map();
    }
    /** Ambil/buat antrean untuk satu tipe key */
    getQueue(keyType) {
        if (!this.queues.has(keyType)) {
            this.queues.set(keyType, new SerialQueue());
        }
        return this.queues.get(keyType);
    }
    /** Proses operasi pre-key (update dan hapus) */
    async processOperations(data, keyType, transactionCache, mutations, isInTransaction) {
        const keyData = data[keyType];
        if (!keyData)
            return;
        return this.getQueue(keyType).add(async () => {
            transactionCache[keyType] = transactionCache[keyType] || {};
            mutations[keyType] = mutations[keyType] || {};
            const deletions = [];
            const updates = {};
            for (const keyId in keyData) {
                if (keyData[keyId] === null) {
                    deletions.push(keyId);
                }
                else {
                    updates[keyId] = keyData[keyId];
                }
            }
            // update tidak perlu validasi
            if (Object.keys(updates).length > 0) {
                Object.assign(transactionCache[keyType], updates);
                Object.assign(mutations[keyType], updates);
            }
            // penghapusan divalidasi
            if (deletions.length > 0) {
                await this.processDeletions(keyType, deletions, transactionCache, mutations, isInTransaction);
            }
        });
    }
    /** Proses penghapusan dengan validasi */
    async processDeletions(keyType, ids, transactionCache, mutations, isInTransaction) {
        var _a;
        if (isInTransaction) {
            // dalam transaksi: hanya boleh menghapus key yang ada di cache
            for (const keyId of ids) {
                if ((_a = transactionCache[keyType]) === null || _a === void 0 ? void 0 : _a[keyId]) {
                    transactionCache[keyType][keyId] = null;
                    mutations[keyType][keyId] = null;
                }
                else {
                    this.logger.warn(`Skipping deletion of non-existent ${keyType} in transaction: ${keyId}`);
                }
            }
        }
        else {
            // di luar transaksi: validasi ke store
            const existingKeys = await this.store.get(keyType, ids);
            for (const keyId of ids) {
                if (existingKeys[keyId]) {
                    transactionCache[keyType][keyId] = null;
                    mutations[keyType][keyId] = null;
                }
                else {
                    this.logger.warn(`Skipping deletion of non-existent ${keyType}: ${keyId}`);
                }
            }
        }
    }
    /** Validasi penghapusan pre-key di luar transaksi (menghapus permintaan hapus untuk key yang tidak ada) */
    async validateDeletions(data, keyType) {
        const keyData = data[keyType];
        if (!keyData)
            return;
        return this.getQueue(keyType).add(async () => {
            const deletionIds = Object.keys(keyData).filter(id => keyData[id] === null);
            if (deletionIds.length === 0)
                return;
            const existingKeys = await this.store.get(keyType, deletionIds);
            for (const keyId of deletionIds) {
                if (!existingKeys[keyId]) {
                    this.logger.warn(`Skipping deletion of non-existent ${keyType}: ${keyId}`);
                    delete data[keyType][keyId];
                }
            }
        });
    }
}
exports.PreKeyManager = PreKeyManager;
