// Tes langkah 4: decode-wa-message ala rc14 (addressing context, key *Alt, fromMe LID, hosted, getDecryptionJid, decrypt)
const assert = require('assert');
const Module = require('module');
const stubs = {
    '@hapi/boom': { Boom: class extends Error { constructor(m, o) { super(m); this.data = o && o.data; } } },
    '../../WAProto': { proto: {
        WebMessageInfo: { Status: { SERVER_ACK: 2 }, StubType: { CIPHERTEXT: 2 } },
        Message: { decode: (b) => JSON.parse(Buffer.from(b).toString()) },
        VerifiedNameCertificate: { decode: () => ({ details: 1 }), Details: { decode: () => ({ verifiedName: 'Biz' }) } },
    } },
    './generics': { unpadRandomMax16: (b) => b, BufferJSON: { replacer: undefined } },
};
const jidUtils = require('../lib/WABinary/jid-utils'); // kode asli, bukan stub
stubs['../WABinary'] = { ...jidUtils, getBinaryNodeChild: (n, tag) => Array.isArray(n.content) ? n.content.find(c => c.tag === tag) : undefined };
const orig = Module._load;
Module._load = function (r, ...a) { return r in stubs ? stubs[r] : orig.call(this, r, ...a); };
const d = require('../lib/Utils/decode-wa-message');

const ME = '6281111111111:5@s.whatsapp.net', MELID = '9991111@lid';
const dec = (attrs, content) => d.decodeMessageNode({ tag: 'message', attrs: { id: 'M1', t: '1', ...attrs }, content }, ME, MELID);

(async () => {
    // eksport konstanta (dipakai messages-recv)
    assert.strictEqual(d.NACK_REASONS.ParsingError, 487);
    assert.strictEqual(typeof d.MISSING_KEYS_ERROR_TEXT, 'string');
    assert.strictEqual(d.NO_MESSAGE_FOUND_ERROR_TEXT, 'Message absent from node');

    // extractAddressingContext
    let c = d.extractAddressingContext({ attrs: { from: '1@lid', sender_pn: '62812@s.whatsapp.net' } });
    assert.deepStrictEqual([c.addressingMode, c.senderAlt], ['lid', '62812@s.whatsapp.net']);
    c = d.extractAddressingContext({ attrs: { from: '62812@s.whatsapp.net', sender_lid: '1@lid' } });
    assert.deepStrictEqual([c.addressingMode, c.senderAlt], ['pn', '1@lid']);
    c = d.extractAddressingContext({ attrs: { from: 'g@g.us', participant: '1@lid', addressing_mode: 'lid', participant_pn: '62813@s.whatsapp.net', recipient_pn: 'r@s.whatsapp.net' } });
    assert.deepStrictEqual([c.senderAlt, c.recipientAlt], ['62813@s.whatsapp.net', 'r@s.whatsapp.net']);

    // chat LID dari orang lain -> remoteJidAlt = PN, participant tidak diubah
    let r = dec({ from: '1234@lid', sender_pn: '62812@s.whatsapp.net' });
    assert.strictEqual(r.fullMessage.key.remoteJid, '1234@lid');
    assert.strictEqual(r.fullMessage.key.remoteJidAlt, '62812@s.whatsapp.net');
    assert.strictEqual(r.fullMessage.key.addressingMode, 'lid');
    assert.strictEqual(r.fullMessage.key.fromMe, false);
    assert.strictEqual(r.fullMessage.key.participantAlt, undefined);

    // grup LID: participantAlt, bukan remoteJidAlt
    r = dec({ from: 'g@g.us', participant: '1234@lid', participant_pn: '62812@s.whatsapp.net', addressing_mode: 'lid' });
    assert.strictEqual(r.fullMessage.key.participantAlt, '62812@s.whatsapp.net');
    assert.strictEqual(r.fullMessage.key.remoteJidAlt, undefined);
    assert.strictEqual(r.fullMessage.key.participant, '1234@lid');
    assert.strictEqual(r.author, '1234@lid');
    assert.strictEqual(r.sender, 'g@g.us');

    // fromMe via LID sendiri di grup (dulu false) dan di chat dengan recipient
    assert.strictEqual(dec({ from: 'g@g.us', participant: '9991111:7@lid' }).fullMessage.key.fromMe, true);
    r = dec({ from: '9991111:7@lid', recipient: '1234@lid' });
    assert.strictEqual(r.fullMessage.key.fromMe, true);
    assert.strictEqual(r.fullMessage.key.remoteJid, '1234@lid');
    assert.throws(() => dec({ from: '5555@lid', recipient: '1234@lid' }), /not from me/);
    // recipient Meta AI tidak memicu error "not from me"
    r = dec({ from: '5555@lid', recipient: '1313555@bot' });
    assert.strictEqual(r.fullMessage.key.fromMe, false);
    assert.strictEqual(r.fullMessage.key.remoteJid, '5555@lid');
    // peer-routed tanpa recipient dari device sendiri -> fromMe
    assert.strictEqual(dec({ from: ME }).fullMessage.key.fromMe, true);
    // hosted
    assert.strictEqual(dec({ from: '777:99@hosted.lid' }).fullMessage.key.remoteJid, '777:99@hosted.lid');
    assert.strictEqual(dec({ from: '62811:99@hosted' }).author, '62811:99@hosted');
    // status broadcast dengan LID sendiri
    assert.strictEqual(dec({ from: 'status@broadcast', participant: '9991111:3@lid' }).fullMessage.key.fromMe, true);
    // newsletter: tanpa *Alt/addressingMode, fromMe dari is_sender, server id
    r = dec({ from: '120363@newsletter', server_id: '42', is_sender: 'true' });
    assert.strictEqual(r.fullMessage.key.fromMe, true);
    assert.strictEqual(r.fullMessage.newsletterServerId, 42);
    assert.strictEqual(r.fullMessage.key.addressingMode, undefined);
    // wajib ada id & from
    assert.throws(() => d.decodeMessageNode({ tag: 'message', attrs: { from: '1@lid' } }, ME, MELID), /missing id/);
    assert.throws(() => d.decodeMessageNode({ tag: 'message', attrs: { id: 'x' } }, ME, MELID), /missing from/);
    // meLid kosong tidak membuat semua LID dianggap "saya"
    assert.strictEqual(d.decodeMessageNode({ tag: 'message', attrs: { id: 'x', t: '1', from: 'g@g.us', participant: '1@lid' } }, ME, '').fullMessage.key.fromMe, false);

    // getDecryptionJid
    const repo = { lidMapping: { getLIDForPN: async (pn, o) => { assert.strictEqual(o.localOnly, true); return pn.startsWith('62812') ? '1234@lid' : null; } } };
    assert.strictEqual(await d.getDecryptionJid('62812:3@s.whatsapp.net', repo), '1234@lid');
    assert.strictEqual(await d.getDecryptionJid('62899@s.whatsapp.net', repo), '62899@s.whatsapp.net');
    assert.strictEqual(await d.getDecryptionJid('5@lid', repo), '5@lid');
    assert.strictEqual(await d.getDecryptionJid('62812@s.whatsapp.net', {}), '62812@s.whatsapp.net');
    assert.strictEqual(await d.getDecryptionJid('62812@s.whatsapp.net', { lidMapping: { getLIDForPN: async () => { throw new Error('x'); } } }), '62812@s.whatsapp.net');

    // decrypt: pkmsg memakai jid LID hasil mapping; retryCount; plaintext
    const calls = [];
    const repo2 = { ...repo, decryptMessage: async (o) => { calls.push(o); return Buffer.from(JSON.stringify({ conversation: 'hai' })); },
        processSenderKeyDistributionMessage: async () => {} };
    const log = { error() {} };
    const node = { tag: 'message', attrs: { id: 'M2', t: '1', from: '62812:3@s.whatsapp.net' }, content: [{ tag: 'enc', attrs: { type: 'pkmsg', count: '2' }, content: new Uint8Array([1]) }] };
    let m = d.decryptMessageNode(node, ME, MELID, repo2, log);
    await m.decrypt();
    assert.strictEqual(calls[0].jid, '1234@lid');
    assert.strictEqual(m.fullMessage.message.conversation, 'hai');
    assert.strictEqual(m.fullMessage.retryCount, 2);
    m = d.decryptMessageNode({ tag: 'message', attrs: { id: 'M3', t: '1', from: '1@lid' }, content: [{ tag: 'plaintext', attrs: {}, content: Buffer.from(JSON.stringify({ conversation: 'pt' })) }] }, ME, MELID, repo2, log);
    await m.decrypt();
    assert.strictEqual(m.fullMessage.message.conversation, 'pt');
    // gagal dekripsi -> stub CIPHERTEXT + pesan error
    const bad = { ...repo2, decryptMessage: async () => { throw new Error('No session record'); } };
    m = d.decryptMessageNode(node, ME, MELID, bad, log); await m.decrypt();
    assert.strictEqual(m.fullMessage.messageStubType, 2);
    assert.deepStrictEqual(m.fullMessage.messageStubParameters, ['No session record']);
    // tanpa enc -> stub [teks, stanza]; view_once unavailable -> tanpa stub
    m = d.decryptMessageNode({ tag: 'message', attrs: { id: 'M4', t: '1', from: '1@lid' }, content: [] }, ME, MELID, repo2, log); await m.decrypt();
    assert.strictEqual(m.fullMessage.messageStubParameters[0], d.NO_MESSAGE_FOUND_ERROR_TEXT);
    assert.strictEqual(m.fullMessage.messageStubParameters.length, 2);
    m = d.decryptMessageNode({ tag: 'message', attrs: { id: 'M5', t: '1', from: '1@lid' }, content: [{ tag: 'unavailable', attrs: { type: 'view_once' } }] }, ME, MELID, repo2, log); await m.decrypt();
    assert.strictEqual(m.fullMessage.key.isViewOnce, true);
    assert.strictEqual(m.fullMessage.messageStubType, undefined);
    console.log('tes langkah 4 lulus');
})().catch(e => { console.error(e); process.exit(1); });
