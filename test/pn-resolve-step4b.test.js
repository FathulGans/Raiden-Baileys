// Tes langkah 4b: resolvePnForLid di messages-recv (diekstrak dari source, dijalankan dengan stub)
const assert = require('assert');
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../lib/Socket/messages-recv.js', 'utf8');
const m = src.match(/const resolvePnForLid = async \(lidJid, candidates\) => \{[\s\S]*?\n    \};\n/);
assert(m, 'resolvePnForLid tidak ditemukan');
// sinkronkan: pastikan penimpaan lama (fallback ke JID sendiri tanpa syarat) sudah hilang
assert(!/participant_pn \|\| authState\.creds\.me\.id/.test(src), 'fallback lama masih ada');
assert(!/remoteJid = node\.attrs\.sender_pn \|\| node\.attrs\.peer_recipient_pn/.test(src), 'penimpaan remoteJid lama masih ada');
const jid = require('../lib/WABinary/jid-utils');
const make = (me, store) => new Function('WABinary_1', 'authState', 'signalRepository', 'logger', m[0] + '\nreturn resolvePnForLid;')(
    jid, { creds: { me } }, { lidMapping: store }, { debug() {} });
(async () => {
    const store = { getPNForLID: async (l) => l.startsWith('111') ? '62811@s.whatsapp.net' : null };
    const f = make({ id: '6280:1@s.whatsapp.net', lid: '999:1@lid' }, store);
    // kandidat dari stanza menang; yang bukan PN diabaikan
    assert.strictEqual(await f('111@lid', [undefined, '62812@s.whatsapp.net']), '62812@s.whatsapp.net');
    assert.strictEqual(await f('111@lid', ['222@lid']), '62811@s.whatsapp.net');   // dari pemetaan
    // LID sendiri -> JID sendiri
    assert.strictEqual(await f('999:7@lid', []), '6280:1@s.whatsapp.net');
    // LID orang lain tanpa info -> undefined (BUKAN JID sendiri, bug lama)
    assert.strictEqual(await f('555@lid', [undefined]), undefined);
    // store error / tanpa store -> undefined
    assert.strictEqual(await make({ id: 'a@s.whatsapp.net' }, { getPNForLID: async () => { throw new Error('x'); } })('5@lid', []), undefined);
    assert.strictEqual(await make({ id: 'a@s.whatsapp.net' }, undefined)('5@lid', []), undefined);
    console.log('tes langkah 4b lulus');
})().catch(e => { console.error(e); process.exit(1); });
