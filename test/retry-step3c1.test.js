// Tes langkah 3c-i: extractE2ESessionFromRetryReceipt, validateSession, getSessionInfo
const assert = require('assert');
const Module = require('module');
const stubs = {
    '../Defaults': { KEY_BUNDLE_TYPE: Buffer.from([5]), DEFAULT_CACHE_TTLS: {} },
    './crypto': { generateSignalPubKey: b => Buffer.concat([Buffer.from([5]), b]) },
    'lodash': {},
    '../Utils': {},
    '../../WAProto': { proto: {} },
    '@hapi/boom': { Boom: class extends Error {} },
    './generics': { encodeBigEndian: () => Buffer.alloc(0) },
};
const orig = Module._load;
Module._load = function (r, ...a) { return r in stubs ? stubs[r] : orig.call(this, r, ...a); };
const { extractE2ESessionFromRetryReceipt: ex } = require('../lib/Utils/signal');

const be = (n, len) => { const b = Buffer.alloc(len); b.writeUIntBE(n, 0, len); return b; };
const mk = (over = {}) => ({
    tag: 'receipt', attrs: {}, content: [
        { tag: 'registration', attrs: {}, content: be(over.reg ?? 1234, 4) },
        { tag: 'keys', attrs: {}, content: [
            { tag: 'type', attrs: {}, content: Buffer.from([over.type ?? 5]) },
            { tag: 'identity', attrs: {}, content: Buffer.alloc(over.idLen ?? 32, 7) },
            ...(over.noPre ? [] : [{ tag: 'key', attrs: {}, content: [{ tag: 'id', attrs: {}, content: be(99, 3) }, { tag: 'value', attrs: {}, content: Buffer.alloc(32, 8) }] }]),
            { tag: 'skey', attrs: {}, content: [{ tag: 'id', attrs: {}, content: be(5, 3) }, { tag: 'value', attrs: {}, content: Buffer.alloc(32, 9) }, { tag: 'signature', attrs: {}, content: Buffer.alloc(64, 1) }] },
        ] },
    ]
});
const ok = ex(mk());
assert.strictEqual(ok.registrationId, 1234);
assert.strictEqual(ok.signedPreKey.keyId, 5);
assert.strictEqual(ok.preKey.keyId, 99);
assert.strictEqual(ok.identityKey.length, 33);
assert.strictEqual(ex(mk({ noPre: true })).preKey, undefined);
assert.strictEqual(ex({ tag: 'receipt', attrs: {}, content: [] }), null);   // tanpa <keys>
assert.strictEqual(ex(mk({ type: 4 })), null);                                // tipe bundle salah
assert.strictEqual(ex(mk({ idLen: 31 })), null);                              // identity pendek
console.log('tes langkah 3c-i lulus');
