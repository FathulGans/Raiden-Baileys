// Tes langkah 2: auth-utils (addTransactionCapability, makeCacheableSignalKeyStore, assertMeId) + pre-key-manager
const assert = require('assert');
const Module = require('module');
// stub dependensi yang tidak terpasang: Mutex minimal dengan semantik async-mutex (runExclusive, isLocked)
class Mutex {
    constructor() { this.tail = Promise.resolve(); this.locked = 0; }
    isLocked() { return this.locked > 0; }
    runExclusive(fn) {
        this.locked++;
        const run = this.tail.then(fn);
        this.tail = run.then(() => { }, () => { });
        return run.finally(() => { this.locked--; });
    }
}
const stubs = {
    'async-mutex': { Mutex },
    '@hapi/boom': { Boom: class extends Error { constructor(m, o) { super(m); this.output = { statusCode: o && o.statusCode }; } } },
    'node-cache': class { constructor() { this.m = new Map(); } get(k) { return this.m.get(k); } set(k, v) { this.m.set(k, v); } flushAll() { this.m.clear(); } },
    'uuid': { v4: () => '00000000-0000-0000-0000-000000000000' },
    '../Defaults': { DEFAULT_CACHE_TTLS: { SIGNAL_STORE: 300 } },
    './crypto': { Curve: { generateKeyPair: () => ({}) }, signedKeyPair: () => ({}) },
    './generics': { delay: (ms) => new Promise(r => setTimeout(r, ms)), generateRegistrationId: () => 1 },
};
const orig = Module._load;
Module._load = function (r, ...a) { return r in stubs ? stubs[r] : orig.call(this, r, ...a); };
const { addTransactionCapability, makeCacheableSignalKeyStore, assertMeId, initAuthCreds } = require('../lib/Utils/auth-utils');
const { SerialQueue, PreKeyManager } = require('../lib/Utils/pre-key-manager');

const logger = { trace() { }, debug() { }, info() { }, warn() { warns.push([].slice.call(arguments)); }, error() { } };
let warns = [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// store memori yang mencatat setiap set()
const makeStore = (init = {}) => {
    const data = JSON.parse(JSON.stringify(init)); const sets = [];
    return {
        data, sets, failSets: 0,
        async get(type, ids) { const o = {}; for (const id of ids) if (data[type] && data[type][id] != null) o[id] = data[type][id]; return o; },
        async set(d) {
            if (this.failSets > 0) { this.failSets--; throw new Error('db down'); }
            sets.push(JSON.parse(JSON.stringify(d)));
            for (const t in d) { data[t] = data[t] || {}; for (const id in d[t]) { if (d[t][id] === null) delete data[t][id]; else data[t][id] = d[t][id]; } }
        }
    };
};
const opts = { maxCommitRetries: 3, delayBetweenTriesMs: 1 };

(async () => {
    // --- SerialQueue: berurutan, error tidak memblokir
    const q = new SerialQueue(); const order = [];
    const p1 = q.add(async () => { await sleep(20); order.push(1); });
    const p2 = q.add(async () => { order.push(2); throw new Error('x'); });
    const p3 = q.add(async () => { order.push(3); return 'ok'; });
    await p1; await assert.rejects(p2, /x/); assert.strictEqual(await p3, 'ok');
    assert.deepStrictEqual(order, [1, 2, 3]);

    // --- transaksi dasar: baca ter-cache, tulis ditahan lalu satu commit
    let st = makeStore({ session: { a: 'A0' } });
    let tx = addTransactionCapability(st, logger, opts);
    assert.strictEqual(tx.isInTransaction(), false);
    const res = await tx.transaction(async () => {
        assert.strictEqual(tx.isInTransaction(), true);
        assert.deepStrictEqual(await tx.get('session', ['a', 'zz']), { a: 'A0' });
        await tx.set({ session: { a: 'A1', b: 'B1' } });
        assert.strictEqual(st.sets.length, 0, 'belum boleh ditulis sebelum commit');
        assert.deepStrictEqual(await tx.get('session', ['a', 'b']), { a: 'A1', b: 'B1' });   // baca dari cache transaksi
        return 42;
    });
    assert.strictEqual(res, 42);
    assert.strictEqual(st.sets.length, 1);
    assert.deepStrictEqual(st.data.session, { a: 'A1', b: 'B1' });
    assert.strictEqual(tx.isInTransaction(), false);

    // --- rollback: error di work -> tidak ada commit
    st = makeStore(); tx = addTransactionCapability(st, logger, opts);
    await assert.rejects(tx.transaction(async () => { await tx.set({ session: { a: 1 } }); throw new Error('boom'); }), /boom/);
    assert.strictEqual(st.sets.length, 0);
    assert.strictEqual(tx.isInTransaction(), false);

    // --- bersarang memakai konteks yang sama (satu commit)
    st = makeStore(); tx = addTransactionCapability(st, logger, opts);
    await tx.transaction(async () => {
        await tx.set({ session: { a: 1 } });
        await tx.transaction(async () => { await tx.set({ session: { b: 2 } }); }, 'lain');
    });
    assert.strictEqual(st.sets.length, 1);
    assert.deepStrictEqual(st.data.session, { a: 1, b: 2 });

    // --- key sama: serial; key beda: paralel; tanpa key: 'default' (serial)
    st = makeStore(); tx = addTransactionCapability(st, logger, opts);
    const log = [];
    const job = (name, ms, key) => tx.transaction(async () => { log.push(name + ':start'); await sleep(ms); log.push(name + ':end'); }, key);
    await Promise.all([job('A', 30, 'k1'), job('B', 1, 'k1')]);
    assert.deepStrictEqual(log, ['A:start', 'A:end', 'B:start', 'B:end']);
    log.length = 0;
    await Promise.all([job('C', 30, 'k1'), job('D', 1, 'k2')]);
    assert.deepStrictEqual(log.slice(0, 2), ['C:start', 'D:start']);
    log.length = 0;
    await Promise.all([job('E', 20), job('F', 1)]);
    assert.deepStrictEqual(log, ['E:start', 'E:end', 'F:start', 'F:end']);

    // --- isolasi konteks: set di luar transaksi (flow lain) langsung ke store, tidak ikut buffer transaksi
    st = makeStore(); tx = addTransactionCapability(st, logger, opts);
    let outside;
    await tx.transaction(async () => {
        outside = (async () => { await tx.set({ session: { x: 'luar' } }); })();   // dibuat di dalam konteks -> ikut konteks (ALS)
        await outside;
        assert.strictEqual(st.sets.length, 0);
    });
    st = makeStore(); tx = addTransactionCapability(st, logger, opts);
    const inTx = tx.transaction(async () => { await sleep(30); await tx.set({ session: { d: 'dalam' } }); });
    await sleep(5);
    await tx.set({ session: { x: 'luar' } });          // dipanggil dari konteks luar saat transaksi berjalan
    assert.deepStrictEqual(st.data.session, { x: 'luar' }, 'penulisan konteks luar harus langsung');
    await inTx;
    assert.deepStrictEqual(st.data.session, { x: 'luar', d: 'dalam' });

    // --- retry commit: gagal 2x lalu berhasil; gagal terus -> melempar error
    st = makeStore(); tx = addTransactionCapability(st, logger, opts);
    st.failSets = 2;
    await tx.transaction(async () => { await tx.set({ session: { a: 1 } }); });
    assert.deepStrictEqual(st.data.session, { a: 1 });
    st = makeStore(); tx = addTransactionCapability(st, logger, opts);
    st.failSets = 99;
    await assert.rejects(tx.transaction(async () => { await tx.set({ session: { a: 1 } }); }), /db down/);
    // mutex dilepas setelah gagal: transaksi berikutnya jalan
    st.failSets = 0;
    await tx.transaction(async () => { await tx.set({ session: { b: 1 } }); });
    assert.deepStrictEqual(st.data.session, { b: 1 });

    // --- pre-key: hapus di dalam transaksi hanya jika ada di cache (sudah di-get)
    warns = [];
    st = makeStore({ 'pre-key': { 1: { k: 1 }, 2: { k: 2 } } }); tx = addTransactionCapability(st, logger, opts);
    await tx.transaction(async () => {
        await tx.get('pre-key', ['1']);
        await tx.set({ 'pre-key': { 1: null, 2: null, 99: null } });   // 1 ada di cache; 2 tidak di-get; 99 tidak ada
    });
    assert.strictEqual(st.data['pre-key'][1], undefined, 'pre-key 1 harus terhapus');
    assert.deepStrictEqual(st.data['pre-key'][2], { k: 2 }, 'pre-key 2 tidak boleh terhapus (tidak ada di cache transaksi)');
    assert(warns.some(w => /non-existent pre-key in transaction: 2/.test(w[0])));
    // update pre-key dalam transaksi tidak divalidasi
    await tx.transaction(async () => { await tx.set({ 'pre-key': { 7: { k: 7 } } }); });
    assert.deepStrictEqual(st.data['pre-key'][7], { k: 7 });

    // --- pre-key di luar transaksi: validasi ke store; tipe lain dipecah per tipe
    warns = [];
    st = makeStore({ 'pre-key': { 1: { k: 1 } }, session: {} }); tx = addTransactionCapability(st, logger, opts);
    await tx.set({ 'pre-key': { 1: null, 5: null }, session: { s: 'S' } });
    assert.strictEqual(st.data['pre-key'][1], undefined);
    assert(warns.some(w => /non-existent pre-key: 5/.test(w[0])));
    assert.strictEqual(st.sets.length, 2, 'dipecah menjadi satu set per tipe');
    assert(st.sets.every(s => Object.keys(s).length === 1));
    assert.deepStrictEqual(st.data.session, { s: 'S' });

    // --- PreKeyManager langsung
    const pm = new PreKeyManager(makeStore({ 'pre-key': { 3: { k: 3 } } }), logger);
    const data = { 'pre-key': { 3: null, 4: null, 8: { k: 8 } } };
    await pm.validateDeletions(data, 'pre-key');
    assert.deepStrictEqual(Object.keys(data['pre-key']).sort(), ['3', '8']);

    // --- makeCacheableSignalKeyStore: cache hit, set memperbarui cache, clear
    const base = makeStore({ session: { a: 'A' } });
    let gets = 0; const origGet = base.get.bind(base); base.get = async (t, ids) => { gets++; return origGet(t, ids); };
    const cs = makeCacheableSignalKeyStore(base, logger);
    assert.deepStrictEqual(await cs.get('session', ['a']), { a: 'A' });
    assert.deepStrictEqual(await cs.get('session', ['a']), { a: 'A' });
    assert.strictEqual(gets, 1, 'pembacaan kedua dari cache');
    await cs.set({ session: { a: 'A2' } });
    assert.deepStrictEqual(await cs.get('session', ['a']), { a: 'A2' });
    assert.strictEqual(gets, 1);
    // get & set bersamaan tidak saling menyalip (get yang mulai duluan membaca nilai lama, set menunggu)
    const cs2 = makeCacheableSignalKeyStore((() => { const s = makeStore({ session: { a: 'old' } }); const g = s.get.bind(s); s.get = async (t, i) => { await sleep(20); return g(t, i); }; return s; })(), logger);
    const [g1] = await Promise.all([cs2.get('session', ['a']), cs2.set({ session: { a: 'new' } })]);
    assert.deepStrictEqual(g1, { a: 'old' });
    assert.deepStrictEqual(await cs2.get('session', ['a']), { a: 'new' });

    // --- assertMeId & initAuthCreds
    assert.strictEqual(assertMeId({ me: { id: '1@s.whatsapp.net' } }), '1@s.whatsapp.net');
    assert.throws(() => assertMeId({}), (e) => e.output.statusCode === 401);
    const creds = initAuthCreds();
    assert('additionalData' in creds && 'deviceId' in creds && 'registration' in creds, 'field mobile tetap ada');
    console.log('tes langkah 2 lulus');
})().catch(e => { console.error(e); process.exit(1); });
