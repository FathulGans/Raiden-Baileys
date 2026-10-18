// Jalankan dari root repo fork: node test/lid-step3.test.js
const assert = require('assert');
const { LIDMappingStore, extractLidPnPairs } = require('../lib/Signal/lid-mapping');

const mem = {};
const keys = {
    get: async (type, ids) => Object.fromEntries(ids.map((id) => [id, mem[`${type}:${id}`]]).filter(([, v]) => v !== undefined)),
    set: async (data) => { for (const t in data) for (const id in data[t]) mem[`${t}:${id}`] = data[t][id]; }
};
const logger = { warn() {}, trace() {}, debug() {}, error() {} };

(async () => {
    // extractLidPnPairs
    assert.deepStrictEqual(extractLidPnPairs({ from: '111@lid', sender_pn: '62811@s.whatsapp.net' }), [{ lid: '111@lid', pn: '62811@s.whatsapp.net' }]);
    assert.deepStrictEqual(extractLidPnPairs({ from: '1@g.us', participant: '111@lid', participant_pn: '62811@s.whatsapp.net' }), [{ lid: '111@lid', pn: '62811@s.whatsapp.net' }]);
    assert.deepStrictEqual(extractLidPnPairs({ from: '62811@s.whatsapp.net', sender_lid: '111@lid' }), [{ lid: '111@lid', pn: '62811@s.whatsapp.net' }]);
    assert.deepStrictEqual(extractLidPnPairs({ from: '1@g.us' }), []);
    assert.deepStrictEqual(extractLidPnPairs(undefined), []);

    // onNewMappings hanya untuk pemetaan BARU
    const events = [];
    const store = new LIDMappingStore(keys, logger, undefined, (p) => events.push(...p));
    await store.storeLIDPNMappings([{ lid: '111@lid', pn: '62811:4@s.whatsapp.net' }]);
    await store.storeLIDPNMappings([{ lid: '111@lid', pn: '62811@s.whatsapp.net' }]); // sama -> tidak ada event
    assert.deepStrictEqual(events, [{ lid: '111@lid', pn: '62811@s.whatsapp.net' }]);

    // setPnToLIDFunc dipasang belakangan
    assert.strictEqual(await store.getLIDForPN('62877@s.whatsapp.net'), null);
    store.setPnToLIDFunc(async (jids) => jids.map((pn) => ({ pn, lid: '777@lid' })));
    assert.strictEqual(await store.getLIDForPN('62877@s.whatsapp.net'), '777@lid');
    assert.strictEqual(events.length, 2);

    // callback yang error tidak boleh menggagalkan penyimpanan
    const s2 = new LIDMappingStore(keys, logger, undefined, () => { throw new Error('x'); });
    await s2.storeLIDPNMappings([{ lid: '888@lid', pn: '62888@s.whatsapp.net' }]);
    assert.strictEqual(await s2.getPNForLID('888@lid'), '62888@s.whatsapp.net');

    console.log('tes langkah 3 lulus');
})().catch((e) => { console.error(e); process.exit(1); });
