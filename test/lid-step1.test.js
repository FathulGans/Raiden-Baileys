// Jalankan dari root repo fork: node test/lid-step1.test.js
const assert = require('assert');
const { LIDMappingStore } = require('../lib/Signal/lid-mapping');
const J = require('../lib/WABinary/jid-utils');

// key store in-memory (bentuk sama dengan SignalKeyStore)
const mem = {};
const keys = {
    get: async (type, ids) => Object.fromEntries(ids.map((id) => [id, mem[`${type}:${id}`]]).filter(([, v]) => v !== undefined)),
    set: async (data) => { for (const t in data) for (const id in data[t]) mem[`${t}:${id}`] = data[t][id]; }
};
const logger = { warn() {}, trace() {}, debug() {}, error() {} };

(async () => {
    // jid-utils
    assert.deepStrictEqual(J.jidDecode('123:5@hosted.lid'), { server: 'hosted.lid', user: '123', domainType: 129, device: 5 });
    assert.deepStrictEqual(J.jidDecode('123@lid').domainType, 1);
    assert.ok(J.isHostedPnUser('1@hosted') && J.isHostedLidUser('1@hosted.lid') && J.isPnUser('1@s.whatsapp.net'));
    assert.strictEqual(J.transferDevice('62811:7@s.whatsapp.net', '999@lid'), '999:7@lid');

    // store tanpa fallback
    let usyncCalls = 0;
    const store = new LIDMappingStore(keys, logger, async (jids) => {
        usyncCalls++;
        return jids.filter((j) => j.startsWith('62899')).map((pn) => ({ pn, lid: '555@lid' }));
    });
    await store.storeLIDPNMappings([{ pn: '62811@s.whatsapp.net', lid: '111@lid' }]);
    assert.strictEqual(await store.getLIDForPN('62811:3@s.whatsapp.net'), '111:3@lid');
    assert.strictEqual(await store.getLIDForPN('62811@s.whatsapp.net'), '111@lid');
    assert.strictEqual(await store.getPNForLID('111:3@lid'), '62811:3@s.whatsapp.net');
    assert.strictEqual(await store.getPNForLID('999@lid'), null);
    assert.strictEqual(await store.getPNForLID('62811@s.whatsapp.net'), null);

    // pasangan terbalik + tidak valid
    await store.storeLIDPNMappings([{ lid: '62822@s.whatsapp.net', pn: '222@lid' }, { pn: 'x@g.us', lid: 'y@lid' }]);
    assert.strictEqual(await store.getLIDForPN('62822@s.whatsapp.net'), '222@lid');

    // persisten (cache baru, key store sama)
    const store2 = new LIDMappingStore(keys, logger);
    assert.strictEqual(await store2.getLIDForPN('62811@s.whatsapp.net'), '111@lid');

    // fallback USync + dedup + tersimpan
    const [a, b] = await Promise.all([store.getLIDForPN('62899@s.whatsapp.net'), store.getLIDForPN('62899@s.whatsapp.net')]);
    assert.strictEqual(a, '555@lid'); assert.strictEqual(b, '555@lid');
    assert.strictEqual(usyncCalls, 1);
    assert.strictEqual(await store.getPNForLID('555@lid'), '62899@s.whatsapp.net');

    // hosted
    await store.storeLIDPNMappings([{ pn: '62833@hosted', lid: '333@hosted.lid' }]);
    assert.strictEqual(await store.getLIDForPN('62833:99@hosted'), '333:99@hosted.lid');

    console.log('semua tes lulus');
})().catch((e) => { console.error(e); process.exit(1); });
