"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initAuthCreds = exports.assertMeId = exports.addTransactionCapability = exports.makeCacheableSignalKeyStore = void 0;
const boom_1 = require("@hapi/boom");
const async_hooks_1 = require("async_hooks");
const async_mutex_1 = require("async-mutex");
const crypto_1 = require("crypto");
const node_cache_1 = __importDefault(require("node-cache"));
const uuid_1 = require("uuid");
const Defaults_1 = require("../Defaults");
const crypto_2 = require("./crypto");
const generics_1 = require("./generics");
const pre_key_manager_1 = require("./pre-key-manager");
/**
 * Adds caching capability to a SignalKeyStore
 * @param store the store to add caching to
 * @param logger to log trace events
 * @param _cache cache store to use
 */
function makeCacheableSignalKeyStore(store, logger, _cache) {
    const cache = _cache || new node_cache_1.default({
        stdTTL: Defaults_1.DEFAULT_CACHE_TTLS.SIGNAL_STORE,
        useClones: false,
        deleteOnExpire: true,
    });
    // mutex melindungi operasi cache (get/set tidak saling menyalip) - sama dengan rc14
    const cacheMutex = new async_mutex_1.Mutex();
    function getUniqueId(type, id) {
        return `${type}.${id}`;
    }
    return {
        async get(type, ids) {
            return cacheMutex.runExclusive(async () => {
                const data = {};
                const idsToFetch = [];
                for (const id of ids) {
                    const item = await cache.get(getUniqueId(type, id));
                    if (typeof item !== 'undefined') {
                        data[id] = item;
                    }
                    else {
                        idsToFetch.push(id);
                    }
                }
                if (idsToFetch.length) {
                    logger === null || logger === void 0 ? void 0 : logger.trace({ items: idsToFetch.length }, 'loading from store');
                    const fetched = await store.get(type, idsToFetch);
                    for (const id of idsToFetch) {
                        const item = fetched[id];
                        if (item) {
                            data[id] = item;
                            await cache.set(getUniqueId(type, id), item);
                        }
                    }
                }
                return data;
            });
        },
        async set(data) {
            return cacheMutex.runExclusive(async () => {
                let keys = 0;
                for (const type in data) {
                    for (const id in data[type]) {
                        await cache.set(getUniqueId(type, id), data[type][id]);
                        keys += 1;
                    }
                }
                logger === null || logger === void 0 ? void 0 : logger.trace({ keys }, 'updated cache');
                await store.set(data);
            });
        },
        async clear() {
            var _a;
            await cache.flushAll();
            await ((_a = store.clear) === null || _a === void 0 ? void 0 : _a.call(store));
        }
    };
}
exports.makeCacheableSignalKeyStore = makeCacheableSignalKeyStore;
/**
 * Adds DB-like transaction capability to the SignalKeyStore (https://en.wikipedia.org/wiki/Database_transaction).
 * Port dari Baileys rc14: konteks transaksi disimpan di AsyncLocalStorage (bukan counter global),
 * transaksi dengan key yang sama berjalan berurutan (mutex per key), penulisan di luar transaksi dilindungi
 * antrean per tipe key, dan penghapusan pre-key divalidasi.
 * @param state the key store to apply this capability to
 * @param logger logger to log events
 * @returns SignalKeyStore with transaction capability
 */
const addTransactionCapability = (state, logger, { maxCommitRetries, delayBetweenTriesMs }) => {
    const txStorage = new async_hooks_1.AsyncLocalStorage();
    // antrean untuk kontrol konkurensi (kunci = tipe data signal, jumlahnya terbatas)
    const keyQueues = new Map();
    // mutex transaksi dengan reference counting agar bisa dibersihkan
    const txMutexes = new Map();
    const txMutexRefCounts = new Map();
    const preKeyManager = new pre_key_manager_1.PreKeyManager(state, logger);
    function getQueue(key) {
        if (!keyQueues.has(key)) {
            keyQueues.set(key, new pre_key_manager_1.SerialQueue());
        }
        return keyQueues.get(key);
    }
    function getTxMutex(key) {
        if (!txMutexes.has(key)) {
            txMutexes.set(key, new async_mutex_1.Mutex());
            txMutexRefCounts.set(key, 0);
        }
        return txMutexes.get(key);
    }
    function acquireTxMutexRef(key) {
        var _a;
        const count = (_a = txMutexRefCounts.get(key)) !== null && _a !== void 0 ? _a : 0;
        txMutexRefCounts.set(key, count + 1);
    }
    function releaseTxMutexRef(key) {
        var _a;
        const count = ((_a = txMutexRefCounts.get(key)) !== null && _a !== void 0 ? _a : 1) - 1;
        txMutexRefCounts.set(key, count);
        // bersihkan bila tidak ada referensi lagi dan mutex tidak sedang terkunci
        if (count <= 0) {
            const mutex = txMutexes.get(key);
            if (mutex && !mutex.isLocked()) {
                txMutexes.delete(key);
                txMutexRefCounts.delete(key);
            }
        }
    }
    function isInTransaction() {
        return !!txStorage.getStore();
    }
    /** commit mutasi dengan retry; melempar error pada percobaan terakhir */
    async function commitWithRetry(mutations) {
        if (Object.keys(mutations).length === 0) {
            logger.trace('no mutations in transaction');
            return;
        }
        logger.trace('committing transaction');
        for (let attempt = 0; attempt < maxCommitRetries; attempt++) {
            try {
                await state.set(mutations);
                logger.trace({ mutationCount: Object.keys(mutations).length }, 'committed transaction');
                return;
            }
            catch (error) {
                const retriesLeft = maxCommitRetries - attempt - 1;
                logger.warn(`failed to commit mutations, retries left=${retriesLeft}`);
                if (retriesLeft === 0) {
                    throw error;
                }
                await (0, generics_1.delay)(delayBetweenTriesMs);
            }
        }
    }
    return {
        get: async (type, ids) => {
            var _a;
            const ctx = txStorage.getStore();
            if (!ctx) {
                // tanpa transaksi: baca langsung
                return state.get(type, ids);
            }
            // dalam transaksi: cek cache dulu
            const cached = ctx.cache[type] || {};
            const missing = ids.filter(id => !(id in cached));
            if (missing.length > 0) {
                ctx.dbQueries++;
                logger.trace({ type, count: missing.length }, 'fetching missing keys in transaction');
                const fetched = await getTxMutex(type).runExclusive(() => state.get(type, missing));
                ctx.cache[type] = ctx.cache[type] || {};
                Object.assign(ctx.cache[type], fetched);
            }
            const result = {};
            for (const id of ids) {
                const value = (_a = ctx.cache[type]) === null || _a === void 0 ? void 0 : _a[id];
                if (value !== undefined && value !== null) {
                    result[id] = value;
                }
            }
            return result;
        },
        set: async (data) => {
            const ctx = txStorage.getStore();
            if (!ctx) {
                // tanpa transaksi: tulis langsung dengan perlindungan antrean
                const types = Object.keys(data);
                for (const type of types) {
                    if (type === 'pre-key') {
                        await preKeyManager.validateDeletions(data, type);
                    }
                }
                await Promise.all(types.map(type => getQueue(type).add(async () => {
                    const typeData = { [type]: data[type] };
                    await state.set(typeData);
                })));
                return;
            }
            // dalam transaksi: perbarui cache dan mutasi
            logger.trace({ types: Object.keys(data) }, 'caching in transaction');
            for (const key in data) {
                ctx.cache[key] = ctx.cache[key] || {};
                ctx.mutations[key] = ctx.mutations[key] || {};
                if (key === 'pre-key') {
                    await preKeyManager.processOperations(data, key, ctx.cache, ctx.mutations, true);
                }
                else {
                    Object.assign(ctx.cache[key], data[key]);
                    Object.assign(ctx.mutations[key], data[key]);
                }
            }
        },
        isInTransaction,
        // `key` memilih mutex: transaksi dengan key sama berjalan berurutan. Pemanggil lama tanpa key
        // memakai satu mutex bersama ('default'), jadi semuanya serial.
        transaction: async (work, key = 'default') => {
            const existing = txStorage.getStore();
            // transaksi bersarang: pakai konteks yang ada
            if (existing) {
                logger.trace('reusing existing transaction context');
                return work();
            }
            const mutex = getTxMutex(key);
            acquireTxMutexRef(key);
            try {
                return await mutex.runExclusive(async () => {
                    const ctx = {
                        cache: {},
                        mutations: {},
                        dbQueries: 0
                    };
                    logger.trace('entering transaction');
                    try {
                        const result = await txStorage.run(ctx, work);
                        await commitWithRetry(ctx.mutations);
                        logger.trace({ dbQueries: ctx.dbQueries }, 'transaction completed');
                        return result;
                    }
                    catch (error) {
                        logger.error({ error }, 'transaction failed, rolling back');
                        throw error;
                    }
                });
            }
            finally {
                releaseTxMutexRef(key);
            }
        }
    };
};
exports.addTransactionCapability = addTransactionCapability;
/**
 * Mengembalikan JID user yang login, atau melempar Boom-401 bila creds belum terautentikasi.
 * Pakai ini sebagai pengganti `creds.me.id` supaya gagal cepat dengan error yang jelas.
 */
const assertMeId = (creds) => {
    var _a;
    const id = (_a = creds.me) === null || _a === void 0 ? void 0 : _a.id;
    if (!id) {
        throw new boom_1.Boom('Cannot proceed: socket is not authenticated yet (creds.me.id is missing)', { statusCode: 401 });
    }
    return id;
};
exports.assertMeId = assertMeId;
const initAuthCreds = () => {
    const identityKey = crypto_2.Curve.generateKeyPair();
    return {
        noiseKey: crypto_2.Curve.generateKeyPair(),
        pairingEphemeralKeyPair: crypto_2.Curve.generateKeyPair(),
        signedIdentityKey: identityKey,
        signedPreKey: (0, crypto_2.signedKeyPair)(identityKey, 1),
        registrationId: (0, generics_1.generateRegistrationId)(),
        advSecretKey: (0, crypto_1.randomBytes)(32).toString('base64'),
        processedHistoryMessages: [],
        nextPreKeyId: 1,
        firstUnuploadedPreKeyId: 1,
        accountSyncCounter: 0,
        accountSettings: {
            unarchiveChats: false
        },
        // mobile creds
        deviceId: Buffer.from((0, uuid_1.v4)().replace(/-/g, ''), 'hex').toString('base64url'),
        phoneId: (0, uuid_1.v4)(),
        identityId: (0, crypto_1.randomBytes)(20),
        registered: false,
        backupToken: (0, crypto_1.randomBytes)(20),
        registration: {},
        pairingCode: undefined,
        lastPropHash: undefined,
        routingInfo: undefined,
        additionalData: undefined,
    };
};
exports.initAuthCreds = initAuthCreds;
