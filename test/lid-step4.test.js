// Jalankan dari root repo fork: node test/lid-step4.test.js
const assert = require('assert');
const { LIDMappingStore } = require('../lib/Signal/lid-mapping');
const { makeLidSessionResolver } = require('../lib/Signal/lid-session');
const { jidDecode } = require('../lib/WABinary/jid-utils');

const logger = { warn() {}, trace() {}, debug() {}, error() {} };
const toAddress = (jid) => { const d = jidDecode(jid); return `${d.user}.${d.device || 0}`; };

function setup({ enabled = true, pnToLID } = {}) {
    const mem = {};
    let sets = 0;
    const keys = {
        get: async (type, ids) => Object.fromEntries(ids.map((id) => [id, mem[`${type}:${id}`]]).filter(([, v]) => v !== undefined && v !== null)),
        set: async (data) => { sets++; for (const t in data) for (const id in data[t]) { if (data[t][id] === null) delete mem[`${t}:${id}`]; else mem[`${t}:${id}`] = data[t][id]; } }
    };
    const lidMapping = new LIDMappingStore(keys, logger, pnToLID);
    const r = makeLidSessionResolver({ keys, lidMapping, logger, toAddress, enabled });
    return { mem, keys, lidMapping, r, sets: () => sets };
}

(async () => {
    // 1. tanpa pemetaan -> apa adanya
    let s = setup();
    s.mem['session:62811.0'] = 'S';
    assert.strictEqual(await s.r.resolveAddressJid('62811@s.whatsapp.net'), '62811@s.whatsapp.net');
    assert.strictEqual(s.mem['session:62811.0'], 'S');

    // 2. PN + pemetaan + sesi PN -> pindah ke LID, device ikut
    s = setup();
    await s.lidMapping.storeLIDPNMappings([{ lid: '111@lid', pn: '62811@s.whatsapp.net' }]);
    s.mem['session:62811.3'] = 'S3';
    assert.strictEqual(await s.r.resolveAddressJid('62811:3@s.whatsapp.net'), '111:3@lid');
    assert.strictEqual(s.mem['session:111.3'], 'S3');
    assert.strictEqual(s.mem['session:62811.3'], undefined);

    // 3. LID masuk, sesi lama di alamat PN -> dipindah
    s = setup();
    await s.lidMapping.storeLIDPNMappings([{ lid: '111@lid', pn: '62811@s.whatsapp.net' }]);
    s.mem['session:62811.0'] = 'S0';
    assert.strictEqual(await s.r.resolveAddressJid('111@lid'), '111@lid');
    assert.strictEqual(s.mem['session:111.0'], 'S0');
    assert.strictEqual(s.mem['session:62811.0'], undefined);

    // 4. sesi LID sudah ada -> tidak ditimpa, sesi PN dibiarkan
    s = setup();
    await s.lidMapping.storeLIDPNMappings([{ lid: '111@lid', pn: '62811@s.whatsapp.net' }]);
    s.mem['session:62811.0'] = 'OLD'; s.mem['session:111.0'] = 'NEW';
    assert.strictEqual(await s.r.resolveAddressJid('62811@s.whatsapp.net'), '111@lid');
    assert.strictEqual(s.mem['session:111.0'], 'NEW');
    assert.strictEqual(s.mem['session:62811.0'], 'OLD');

    // 5. dimatikan -> tidak menyentuh apa pun
    s = setup({ enabled: false });
    await s.lidMapping.storeLIDPNMappings([{ lid: '111@lid', pn: '62811@s.whatsapp.net' }]);
    s.mem['session:62811.0'] = 'S';
    assert.strictEqual(await s.r.resolveAddressJid('62811@s.whatsapp.net'), '62811@s.whatsapp.net');
    assert.strictEqual(s.mem['session:62811.0'], 'S');

    // 6. grup/broadcast/newsletter -> apa adanya
    s = setup();
    for (const j of ['120363@g.us', 'status@broadcast', '1@newsletter']) assert.strictEqual(await s.r.resolveAddressJid(j), j);

    // 7. paralel -> satu kali pindah
    s = setup();
    await s.lidMapping.storeLIDPNMappings([{ lid: '111@lid', pn: '62811@s.whatsapp.net' }]);
    s.mem['session:62811.0'] = 'S';
    const before = s.sets();
    const out = await Promise.all([1, 2, 3, 4].map(() => s.r.resolveAddressJid('62811@s.whatsapp.net')));
    assert.deepStrictEqual(out, Array(4).fill('111@lid'));
    assert.strictEqual(s.sets() - before, 1);

    // 8. jalur kirim/terima tidak boleh memanggil USync (localOnly)
    let usync = 0;
    s = setup({ pnToLID: async () => { usync++; return []; } });
    assert.strictEqual(await s.r.resolveAddressJid('62899@s.whatsapp.net'), '62899@s.whatsapp.net');
    assert.strictEqual(usync, 0);
    // tetapi pemanggilan biasa tetap boleh memakai USync
    await s.lidMapping.getLIDForPN('62899@s.whatsapp.net');
    assert.strictEqual(usync, 1);

    // 9. error di store -> kembali ke JID asli, tidak melempar
    s = setup();
    s.lidMapping.getLIDForPN = async () => { throw new Error('boom'); };
    assert.strictEqual(await s.r.resolveAddressJid('62811@s.whatsapp.net'), '62811@s.whatsapp.net');

    console.log('tes langkah 4 lulus');
})().catch((e) => { console.error(e); process.exit(1); });
