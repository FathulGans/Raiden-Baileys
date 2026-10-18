// Tes langkah 1: WABinary sinkron rc14 (token dict v3, AD_JID hosted, FB_JID, INTEROP_JID, jidDecode agent)
const assert = require('assert');
const fs = require('fs');
const c = require('../lib/WABinary/constants');
const { encodeBinaryNode } = require('../lib/WABinary/encode');
const { decodeBinaryNode } = require('../lib/WABinary/decode');
const J = require('../lib/WABinary/jid-utils');
const defSrc = fs.readFileSync(__dirname + '/../lib/Defaults/index.js', 'utf8'); // Defaults menarik dependensi npm; cukup baca source

(async () => {
    assert(/exports\.DICT_VERSION = 3;/.test(defSrc), 'DICT_VERSION harus 3');
    assert(/NOISE_WA_HEADER = Buffer\.from\(\[87, 65, 6, exports\.DICT_VERSION\]\)/.test(defSrc), 'header noise memakai DICT_VERSION');
    assert(/WA_ADV_HOSTED_ACCOUNT_SIG_PREFIX = Buffer\.from\(\[6, 5\]\)/.test(defSrc));
    assert.strictEqual(c.SINGLE_BYTE_TOKENS.length, 236);
    assert.deepStrictEqual(c.DOUBLE_BYTE_TOKENS.map(a => a.length), [256, 256, 256, 256]);
    assert.strictEqual(c.TAGS.INTEROP_JID, 245);
    assert.strictEqual(c.TAGS.FB_JID, 246);
    assert.strictEqual(J.META_AI_JID, '13135550002@c.us');

    const rt = async (node) => decodeBinaryNode(encodeBinaryNode(node));

    // roundtrip SETIAP token (single + double) sebagai nilai atribut dan sebagai tag
    let n = 0;
    for (const tok of Object.keys(c.TOKEN_MAP)) {
        if (!tok || tok.includes('@')) continue; // '' dan token berformat jid dibahas terpisah
        const out = await rt({ tag: 'iq', attrs: { type: tok }, content: undefined });
        assert.strictEqual(out.attrs.type, tok, 'token gagal roundtrip: ' + tok);
        n++;
    }
    assert(n > 1000, 'terlalu sedikit token diuji: ' + n);

    // encode token ke byte yang benar: single -> 1 byte indeks, double -> [236+dict, idx]
    const idx = c.TOKEN_MAP['s.whatsapp.net'];
    assert.strictEqual(idx.dict, undefined);
    const dbl = Object.entries(c.TOKEN_MAP).find(([, v]) => v.dict === 3 && v.index === 10);
    const raw = encodeBinaryNode({ tag: 'x', attrs: { a: dbl[0] } });
    const pos = raw.indexOf(Buffer.from([c.TAGS.DICTIONARY_3, 10]));
    assert(pos > 0, 'byte token double tidak ditemukan');

    // JID: PN, PN+device, LID+device, hosted, hosted.lid, grup, status
    for (const jid of ['62812@s.whatsapp.net', '62812:7@s.whatsapp.net', '1234:3@lid', '1234@lid', '62812:99@hosted', '1234:99@hosted.lid', '120363@g.us', 'status@broadcast']) {
        const out = await rt({ tag: 'message', attrs: { to: jid }, content: undefined });
        assert.strictEqual(out.attrs.to, jid, jid);
    }
    // byte AD_JID: domainType hosted = 128, hosted.lid = 129, lid = 1
    const ad = (jid) => { const b = encodeBinaryNode({ tag: 'x', attrs: { a: jid } }); const i = b.indexOf(c.TAGS.AD_JID); return [b[i + 1], b[i + 2]]; };
    assert.deepStrictEqual(ad('1:5@s.whatsapp.net'), [0, 5]);
    assert.deepStrictEqual(ad('1:5@lid'), [1, 5]);
    assert.deepStrictEqual(ad('1:5@hosted'), [128, 5]);
    assert.deepStrictEqual(ad('1:5@hosted.lid'), [129, 5]);

    // konten: biner, string, list anak, string besar (BINARY_20)
    const big = 'x'.repeat(300);
    const tree = { tag: 'iq', attrs: { id: 'ab12', xmlns: 'usync' }, content: [
        { tag: 'a', attrs: {}, content: Buffer.from([1, 2, 3]) },
        { tag: 'b', attrs: { k: big }, content: 'halo' },
    ] };
    const back = await rt(tree);
    assert.strictEqual(back.content[0].content.toString('hex'), '010203');
    assert.strictEqual(back.content[1].attrs.k, big);
    assert.strictEqual(back.content[1].content.toString(), 'halo');

    // decode FB_JID dan INTEROP_JID dari byte manual. string = BINARY_8 len + bytes
    const s = (str) => [c.TAGS.BINARY_8, str.length, ...Buffer.from(str)];
    const wrap = (jidBytes) => Buffer.from([0, c.TAGS.LIST_8, 3, ...s('t'), ...s('to'), ...jidBytes]);
    // node: LIST_8 3 -> header 't', 1 attr (to=<jid>)
    const fb = await decodeBinaryNode(wrap([c.TAGS.FB_JID, ...s('555'), 0x00, 0x09, ...s('msgr')]));
    const attrVal = (nd) => Object.values(nd.attrs)[0];
    assert.strictEqual(attrVal(fb), '555:9@msgr');
    const io = await decodeBinaryNode(wrap([c.TAGS.INTEROP_JID, ...s('777'), 0x00, 0x02, 0x00, 0x05, ...s('interop')]));
    assert.strictEqual(attrVal(io), '5-777:2@interop');

    // jidDecode: agent -> domainType; hosted tetap; encode tidak berubah
    assert.strictEqual(J.jidDecode('1_3:4@s.whatsapp.net').domainType, 3);
    assert.strictEqual(J.jidDecode('1:4@hosted.lid').domainType, 129);
    assert.strictEqual(J.jidDecode('1:4@lid').domainType, 1);
    assert.strictEqual(J.jidDecode('1:4@s.whatsapp.net').domainType, 0);
    assert.strictEqual(J.getServerFromDomainType('s.whatsapp.net', 129), 'hosted.lid');
    assert.strictEqual(J.getServerFromDomainType('s.whatsapp.net', 0), 's.whatsapp.net');
    console.log('tes langkah 1 lulus (' + n + ' token roundtrip)');
})().catch(e => { console.error(e); process.exit(1); });
