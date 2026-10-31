// Tes fitur hasil port dari @rennzsync/baileys (baileys-main), tanpa server WhatsApp
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { proto } = require('../WAProto')
const Utils = require('../lib/Utils')
const WABinary = require('../lib/WABinary')

const logger = { info() {}, debug() {}, warn() {}, error() {}, trace() {}, child() { return logger } }
const enc = (m) => proto.Message.decode(proto.Message.encode(m).finish())

;(async () => {
    // --- builder rich-* & a2ui ---
    const menu = enc(proto.Message.fromObject(Utils.buildRichMenuMessage({ header: { title: 'Menu' }, body: { buttons: ['A', 'B'], toast: 'ok' }, footer: { text: 'Buka', url: 'https://example.com' } })))
    const data = JSON.parse(Buffer.from(menu.botForwardedMessage.message.richResponseMessage.unifiedResponse.data).toString())
    assert.strictEqual(data.sections.length, 3)

    const webui = enc(proto.Message.fromObject(Utils.buildWebuiMessage({ html: '<b>hi</b>', title: 'T' })))
    assert.strictEqual(webui.botForwardedMessage.message.richResponseMessage.submessages[0].messageText, 'T')

    const carousel = enc(proto.Message.fromObject(Utils.buildCarouselMessage({ text: 'x', cards: [{ text: 'c1', buttons: [{ displayText: 'Ya', id: 'y' }] }] })))
    assert.strictEqual(carousel.interactiveMessage.carouselMessage.cards.length, 1)
    assert.strictEqual(Utils.buildNativeFlowButton({ type: 'cta_url', displayText: 'W', url: 'https://a.b' }).name, 'cta_url')

    const classic = Utils.buildListMessage({ title: 'L', buttonText: 'Pilih', sections: [{ title: 's', rows: [{ title: 'r', rowId: '1' }] }] })
    assert.strictEqual(enc(proto.Message.fromObject(classic)).listMessage.sections[0].rows[0].rowId, '1')

    const ui = new Utils.A2UI()
    ui.root([ui.text('Halo', { variant: 'h1' })])
    const built = ui.build()
    assert.strictEqual(JSON.parse(built.data).createSurface.components[0].id, 'root')

    // --- imagePoll & viewOnceV2 ---
    let m = enc(await Utils.generateWAMessageContent({ imagePoll: { name: 'P', selectableCount: 1, options: [{ optionName: 'a', optionHash: Utils.hashImagePollOption('a', Buffer.alloc(32)) }] } }, { logger }))
    assert.strictEqual(m.pollCreationMessageV3.pollContentType, proto.Message.PollContentType.IMAGE)
    assert.strictEqual(m.pollCreationMessageV3.options[0].optionHash.length, 64)

    m = enc(await Utils.generateWAMessageContent({ text: 'rahasia', viewOnceV2: true }, { logger }))
    assert.strictEqual(m.viewOnceMessageV2.message.extendedTextMessage.viewOnce, true)
    m = enc(await Utils.generateWAMessageContent({ text: 'rahasia', viewOnceV2Extension: true }, { logger }))
    assert.ok(m.viewOnceMessageV2Extension.message.extendedTextMessage)

    // --- anchor guard ---
    assert.strictEqual(Utils.detectBug({ conversation: 'halo' }).flagged, false)
    assert.strictEqual(Utils.detectBug({ conversation: '​'.repeat(600) }).flagged, true)
    const sent = []
    const fakeSock = { ev: { on() {}, off() {} }, sendMessage: async (...a) => { sent.push(a); return 'ok' } }
    const guard = Utils.createAnchorGuard(fakeSock, {})
    await assert.rejects(fakeSock.sendMessage('x@s.whatsapp.net', { text: '​'.repeat(600) }))
    assert.strictEqual(await fakeSock.sendMessage('x@s.whatsapp.net', { text: 'aman' }), 'ok')
    guard.stop()

    // --- media-processor (tanpa ffmpeg) ---
    assert.strictEqual(Utils.getMp4Duration(Buffer.alloc(4)), 0)

    // --- sqlite auth state (butuh node:sqlite) ---
    let hasSqlite = true
    try { require('node:sqlite') } catch { hasSqlite = false }
    if (hasSqlite) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-sqlite-'))
        const { state, saveCreds, close } = await Utils.useSqliteAuthState(dir)
        await state.keys.set({ session: { 'a.1': Buffer.from([1, 2, 3]) }, 'pre-key': { 1: { public: Buffer.from([9]) } } })
        const got = await state.keys.get('session', ['a.1'])
        assert.deepStrictEqual([...got['a.1']], [1, 2, 3])
        const pk = await state.keys.get('pre-key', ['1'])
        assert.ok(Buffer.isBuffer(pk['1'].public))
        await saveCreds()
        close()
        fs.rmSync(dir, { recursive: true, force: true })
    } else {
        console.log('lewati tes sqlite: node:sqlite tidak tersedia')
    }

    // --- biz node list & ekspor WABinary ---
    assert.strictEqual(WABinary.getAdditionalNode('list')[0].content[0].attrs.type, 'product_list')
    assert.strictEqual(WABinary.FLOW_NAME.call_request, 'call_permission_request')

    // --- sendMessage: flag isSecret / me & biz node via getButtonType ---
    const sentNodes = []
    const usyncPath = require.resolve('../lib/Socket/usync')
    const me = '6281111111111:1@s.whatsapp.net'
    const peer = '6282222222222@s.whatsapp.net'
    const stubSock = {
        ev: { on() {}, off() {}, emit() {}, process() {}, buffer() {}, flush() {}, createBufferedFunction: f => f, isBuffering: () => false },
        ws: { on() {}, once() {}, off() {} },
        authState: { creds: { me: { id: me, name: 'x' } }, keys: { get: async () => ({}), set: async () => {}, transaction: async (fn) => fn() } },
        signalRepository: { encryptMessage: async ({ jid }) => ({ type: 'msg', ciphertext: Buffer.from(jid) }), jidToSignalProtocolAddress: j => j },
        generateMessageTag: () => 'TAG1', sendNode: async (n) => { sentNodes.push(n) }, query: async () => ({ tag: 'iq', attrs: {}, content: [] }), onUnexpectedError() {},
        // perangkat pendamping dari cache: peer:3, me:2 (device 0 tidak ikut, sama seperti extractDeviceJids ignoreZeroDevices)
        executeUSyncQuery: async () => ({ list: [] }),
        fetchPrivacySettings: async () => ({}), groupMetadata: async () => ({ participants: [] }), upsertMessage: async () => {},
        processingMutex: { mutex: f => f() }, groupToggleEphemeral: async () => {},
    }
    require.cache[usyncPath] = { id: usyncPath, filename: usyncPath, loaded: true, exports: { makeUSyncSocket: () => stubSock } }
    const { makeMessagesSocket } = require('../lib/Socket/messages-send')
    const cfg = { logger, markOnlineOnConnect: false, fireInitQueries: false, appStateMacVerification: {}, shouldIgnoreJid: () => false, shouldSyncHistoryMessage: () => false, options: {}, patchMessageBeforeSending: m => m, linkPreviewImageThumbnailWidth: 192, userDevicesCache: { get: (u) => u === '6282222222222' ? [{ user: u, device: 3 }] : [{ user: '6281111111111', device: 2 }], set() {} } }
    const ms = makeMessagesSocket(cfg)
    const lastMsg = () => sentNodes.filter(n => n.tag === 'message').pop()
    const recipients = (n) => (n.content.find(c => c.tag === 'participants')?.content || []).map(c => c.attrs.jid).sort()

    await ms.sendMessage(peer, { text: 'biasa' })
    assert.ok(recipients(lastMsg()).includes('6282222222222:3@s.whatsapp.net'), 'tanpa flag: perangkat pendamping ikut')
    await ms.sendMessage(peer, { text: 'rahasia' }, { isSecret: true })
    assert.deepStrictEqual(recipients(lastMsg()), ['6282222222222@s.whatsapp.net'])
    assert.strictEqual(lastMsg().attrs.device_fanout, 'false')
    await ms.sendMessage(peer, { text: 'ke diri sendiri' }, { me: true })
    assert.ok(recipients(lastMsg()).every(j => j.startsWith('6281111111111')))

    // list -> <biz><list/></biz>
    await ms.sendMessage(peer, { text: 'L', sections: [{ title: 's', rows: [{ title: 'r', rowId: '1' }] }], buttonText: 'Pilih' })
    const biz = lastMsg().content.find(c => c.tag === 'biz')
    assert.ok(biz && biz.content[0].tag === 'list', 'node biz list')

    // richMenu & sendA2UI terkirim
    await ms.richMenu(peer, { header: { title: 'M' } })
    assert.ok(lastMsg())
    await ms.sendA2UI(peer, { a2ui: ui, bodyText: 'w' })
    assert.ok(lastMsg().content.some(c => c.tag === 'biz'))

    console.log('tes port rennzsync lulus')
    process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
