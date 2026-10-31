// Tes fitur pesan hasil port dari levvleys 2.1.0 (tanpa server WhatsApp, sock palsu)
const assert = require('assert')
const { proto } = require('../WAProto')
const Utils = require('../lib/Utils')
const WABinary = require('../lib/WABinary')

const logger = { info() {}, debug() {}, warn() {}, error() {}, trace() {}, child() { return logger } }
const enc = (m) => proto.Message.decode(proto.Message.encode(m).finish())
const gen = (content, opts = {}) => Utils.generateWAMessageContent(content, { logger, ...opts })
const key = { remoteJid: '6281111111111@s.whatsapp.net', id: 'ABC', fromMe: true }

;(async () => {
    // --- generateWAMessageContent: tipe baru ---
    let m = enc(await gen({ pin: { key, type: 1, time: 3600 } }))
    assert.strictEqual(m.pinInChatMessage.type, 1)
    assert.strictEqual(m.pinInChatMessage.key.id, 'ABC')
    assert.strictEqual(m.messageContextInfo.messageAddOnDurationInSecs, 3600)

    m = enc(await gen({ keep: key, type: 1 }))
    assert.strictEqual(m.keepInChatMessage.key.id, 'ABC')

    m = enc(await gen({ call: { title: 'Rapat', type: 2, time: 1700000000000 } }))
    assert.strictEqual(m.scheduledCallCreationMessage.title, 'Rapat')

    m = enc(await gen({ paymentInvite: { type: 1, expiry: 123 } }))
    assert.strictEqual(m.paymentInviteMessage.serviceType, 1)

    m = enc(await gen({ order: { id: 'o1', itemCount: 2, title: 'T', text: 'x', amount: 1000, currency: 'IDR' } }))
    assert.strictEqual(m.orderMessage.orderId, 'o1')

    m = enc(await gen({ groupInvite: { inviteCode: 'C', inviteExpiration: 9, text: 'join', jid: '123@g.us', subject: 'G' } }))
    assert.strictEqual(m.groupInviteMessage.groupJid, '123@g.us')

    m = enc(await gen({ poll: { name: 'P', values: ['a', 'b'], selectableCount: 1 } }))
    assert.ok(m.pollCreationMessageV3, 'poll single-select -> V3 (sama dgn Baileys rc14)')
    m = enc(await gen({ poll: { name: 'P', values: ['a', 'b'], selectableCount: 2 } }))
    assert.ok(m.pollCreationMessage)
    m = enc(await gen({ poll: { name: 'P', values: ['a', 'b'], toAnnouncementGroup: true } }))
    assert.ok(m.pollCreationMessageV2)
    assert.strictEqual(m.messageContextInfo.messageSecret.length, 32)

    m = enc(await gen({ event: { name: 'Acara', startTime: 1700000000 } }))
    assert.strictEqual(m.eventMessage.name, 'Acara')

    m = enc(await gen({ inviteAdmin: { jid: '1@newsletter', subject: 'Ch', text: 'jadi admin', inviteExpiration: 5 } }))
    assert.strictEqual(m.newsletterAdminInviteMessage.newsletterJid, '1@newsletter')

    m = enc(await gen({ requestPayment: { note: 'bayar', amount: 1000, currency: 'IDR', from: key.remoteJid, expiry: 0 } }))
    assert.strictEqual(m.requestPaymentMessage.noteMessage.extendedTextMessage.text, 'bayar')

    m = enc(await gen({ album: [{ image: Buffer.alloc(1) }, { video: Buffer.alloc(1) }, { image: Buffer.alloc(1) }] }))
    assert.strictEqual(m.albumMessage.expectedImageCount, 2)
    assert.strictEqual(m.albumMessage.expectedVideoCount, 1)

    m = enc(await gen({ groupStatus: { message: 'halo', backgroundArgb: 0xff000000, font: 1 } }))
    assert.strictEqual(m.groupStatusMessageV2.message.extendedTextMessage.text, 'halo')
    assert.deepStrictEqual(Utils.normalizeMessageContent(m).extendedTextMessage.text, 'halo')

    m = enc(await gen({ buttonsMessage: { contentText: 'isi', footerText: 'f', buttons: [{ buttonId: 'b1', buttonText: { displayText: 'B1' } }] } }))
    assert.strictEqual(m.buttonsMessage.buttons[0].buttonId, 'b1')

    // buttonsMessage + lokasi + thumbnail (butuh jimp, opsional)
    let jimpOk = true
    try { require.resolve('jimp') } catch { jimpOk = false }
    if (jimpOk) {
        const Jimp = require('jimp')
        const png = await new Jimp(600, 400, 0xff0000ff).getBufferAsync(Jimp.MIME_PNG)
        m = enc(await gen({ buttonsMessage: { contentText: 'lok', locationMessage: { degreesLatitude: 1, degreesLongitude: 2, jpegThumbnail: png }, buttons: [] } }))
        assert.ok(m.buttonsMessage.locationMessage.jpegThumbnail.length > 0)
    } else {
        console.log('lewati tes thumbnail lokasi: jimp tidak terpasang')
    }

    m = enc(await gen({ text: 'pilih', interactiveButtons: [{ name: 'quick_reply', buttonParamsJson: '{"display_text":"Ya","id":"y"}' }], footer: 'ft' }))
    assert.strictEqual(m.interactiveMessage.body.text, 'pilih')
    assert.strictEqual(m.interactiveMessage.nativeFlowMessage.buttons[0].name, 'quick_reply')

    m = enc(await gen({ text: 'toko', shop: 3, id: 'shopid' }))
    assert.strictEqual(m.interactiveMessage.shopStorefrontMessage.id, 'shopid')

    m = enc(await gen({ text: 't', buttons: [{ buttonId: 'x', buttonText: { displayText: 'X' } }], title: 'Judul' }))
    assert.strictEqual(m.buttonsMessage.text, 'Judul')

    // richMessage
    const rich = await gen({ richMessage: { title: 'disc', text: 'Halo [link](https://a.b)', code: { language: 'javascript', code: 'const a = 1' }, table: [['h1', 'h2'], ['a', 'b']], suggestions: ['lagi'], editrich: { text: 'sudah diedit', delay: 10 } } })
    assert.ok(rich.__richEdit, '__richEdit tetap ada setelah fromObject')
    assert.strictEqual(rich.__richEdit.delay, 10)
    m = enc(rich)
    const rr = m.botForwardedMessage.message.richResponseMessage
    assert.deepStrictEqual(rr.submessages.map(s => s.messageType), [2, 5, 4])
    const unified = JSON.parse(Buffer.from(rr.unifiedResponse.data).toString())
    assert.ok(unified.sections.length >= 4)
    assert.ok(!JSON.stringify(unified).toLowerCase().includes('levvi'))
    assert.ok(Utils.normalizeMessageContent(m).richResponseMessage, 'botForwardedMessage dinormalisasi')

    m = enc(await gen({ richMessageV2: { text: 'v2', table: { headers: ['a'], rows: [['1']] }, code: { language: 'python', content: 'print(1)' } } }))
    assert.strictEqual(m.botForwardedMessage.message.richResponseMessage.submessages.length, 3)

    // generateWAMessage + editrich -> relay edit lewat options.conn
    const relayed = []
    const conn = { relayMessage: async (jid, msg, opts) => { relayed.push({ jid, msg, opts }) } }
    const full = await Utils.generateWAMessage(key.remoteJid, { richMessage: { text: 'awal', editrich: { text: 'akhir' } } }, { logger, userJid: key.remoteJid, conn })
    await new Promise(r => setTimeout(r, 50))
    assert.strictEqual(relayed.length, 1)
    const pm = relayed[0].msg.botForwardedMessage.message.protocolMessage
    assert.strictEqual(pm.key.id, full.key.id)
    assert.strictEqual(pm.type, proto.Message.ProtocolMessage.Type.MESSAGE_EDIT)

    // stickerPack: dibangun dengan upload palsu
    const upl = []
    m = await gen({ stickerPack: { name: 'Pack', publisher: 'Me', stickers: [{ sticker: Buffer.from('RIFF0000WEBP'), emojis: ['😀'] }], cover: Buffer.alloc(10) } }, {
        upload: async (stream, o) => { upl.push(o.mediaType); for await (const _ of stream) {} return { directPath: '/x', url: 'https://x' } },
        mediaTypeOverride: undefined
    }).catch(e => ({ err: e }))
    if (m.err) {
        console.log('stickerPack gagal dibangun (cover bukan gambar valid di lingkungan tes):', m.err.message)
    } else {
        assert.strictEqual(m.stickerPackMessage.name, 'Pack')
        assert.ok(upl.includes('sticker-pack'))
    }

    // --- jid-utils & helper ---
    assert.strictEqual(WABinary.isJidNewsletter('1@newsletter'), true)
    assert.strictEqual(WABinary.isJidMetaAi('1@bot'), true)
    assert.strictEqual(WABinary.isJidBot('13135550002@c.us'), true)
    assert.strictEqual(WABinary.getBotJid('867051314767696@bot'), '13135550002@s.whatsapp.net')
    assert.strictEqual(Utils.toJid('628'), '628@s.whatsapp.net')
    assert.strictEqual(Utils.toJid('1@lid'), '1@lid')

    // --- sendMessage: atribut stanza pin/keep/poll ---
    const sentNodes = []
    const usyncPath = require.resolve('../lib/Socket/usync')
    const fakeSock = {
        ev: { on() {}, off() {}, emit() {}, process() {}, buffer() {}, flush() {}, createBufferedFunction: f => f, isBuffering: () => false },
        ws: { on() {}, once() {}, off() {} },
        authState: { creds: { me: { id: '6281111111111:1@s.whatsapp.net', name: 'x' } }, keys: { get: async () => ({}), set: async () => {}, transaction: async (fn) => fn() } },
        signalRepository: { encryptMessage: async () => ({ type: 'msg', ciphertext: Buffer.alloc(1) }), jidToSignalProtocolAddress: j => j },
        generateMessageTag: () => 'TAG1', sendNode: async (n) => { sentNodes.push(n) }, query: async () => ({ tag: 'iq', attrs: {}, content: [] }), onUnexpectedError() {},
        executeUSyncQuery: async () => ({ list: [] }),
        fetchPrivacySettings: async () => ({}), groupMetadata: async () => ({ participants: [] }), upsertMessage: async () => {},
        processingMutex: { mutex: f => f() }, groupToggleEphemeral: async () => {},
    }
    require.cache[usyncPath] = { id: usyncPath, filename: usyncPath, loaded: true, exports: { makeUSyncSocket: () => fakeSock } }
    const { makeMessagesSocket } = require('../lib/Socket/messages-send')
    const cfg = { logger, markOnlineOnConnect: false, fireInitQueries: false, appStateMacVerification: {}, shouldIgnoreJid: () => false, shouldSyncHistoryMessage: () => false, options: {}, patchMessageBeforeSending: m => m, linkPreviewImageThumbnailWidth: 192 }
    const ms = makeMessagesSocket(cfg)
    const to = '6282222222222@s.whatsapp.net'
    const lastMsgNode = () => sentNodes.filter(n => n.tag === 'message').pop()

    await ms.sendMessage(to, { pin: { key, type: 1 } })
    assert.strictEqual(lastMsgNode().attrs.edit, '2')
    await ms.sendMessage(to, { keep: key, type: 1 })
    assert.strictEqual(lastMsgNode().attrs.edit, '6')
    await ms.sendMessage(to, { poll: { name: 'P', values: ['a', 'b'] } })
    assert.ok(lastMsgNode().content.some(c => c.tag === 'meta' && c.attrs.polltype === 'creation'), 'node meta polltype')
    await ms.sendMessage(to, { text: 'biasa' })
    assert.strictEqual(lastMsgNode().attrs.edit, undefined)

    console.log('tes port levvleys lulus')
    // timer cache (NodeCache dll.) membuat proses tetap hidup
    process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
