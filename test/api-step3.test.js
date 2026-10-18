// Tes API tahap 3 memakai sock palsu (tanpa koneksi WhatsApp)
const assert = require('assert')
const path = require('path')
const Module = require('module')

const sent = []
const fakeQuery = async (node) => {
    sent.push(node)
    // balasan palsu sesuai jenis query
    const content = node.content && node.content[0]
    if (node.attrs && node.attrs.xmlns === 'bot') {
        return { tag: 'iq', attrs: {}, content: [{ tag: 'bot', attrs: {}, content: [
            { tag: 'section', attrs: { type: 'all' }, content: [
                { tag: 'bot', attrs: { jid: '1313555@bot', persona_id: 'p1' } },
                { tag: 'bot', attrs: { jid: '1313556@bot', persona_id: 'p2' } }
            ] },
            { tag: 'section', attrs: { type: 'featured' }, content: [
                { tag: 'bot', attrs: { jid: 'x@bot', persona_id: 'zz' } }
            ] }
        ] }] }
    }
    if (node.tag === 'call') {
        return { tag: 'call', attrs: {}, content: [{ tag: 'link_create', attrs: { token: 'TOKEN123' } }] }
    }
    return { tag: 'iq', attrs: {}, content: [] }
}

const usyncPath = require.resolve('../lib/Socket/usync')
const calls = { usync: [], appPatch: [] }
const fakeSock = {
    ev: { on() {}, off() {}, emit() {}, process() {}, buffer() {}, flush() {}, createBufferedFunction: f => f, isBuffering: () => false },
    ws: { on() {}, once() {}, off() {} },
    authState: { creds: { me: { id: '6281111111111:1@s.whatsapp.net', name: 'x' } }, keys: {} },
    generateMessageTag: () => 'TAG1',
    sendNode: async () => {},
    query: fakeQuery,
    onUnexpectedError() {},
    executeUSyncQuery: async (q) => { calls.usync.push(q); return { list: [{ id: 'a@s.whatsapp.net', disappearingMode: { duration: 86400 } }] } },
}
require.cache[usyncPath] = {
    id: usyncPath, filename: usyncPath, loaded: true,
    exports: { makeUSyncSocket: () => fakeSock }
}

const { makeChatsSocket } = require('../lib/Socket/chats')
const logger = { info() {}, debug() {}, warn() {}, error() {}, trace() {}, child() { return logger } }
const chats = makeChatsSocket({ logger, markOnlineOnConnect: false, fireInitQueries: false, appStateMacVerification: {}, shouldIgnoreJid: () => false, shouldSyncHistoryMessage: () => false, options: {} })

;(async () => {
    // privasi pesan & panggilan
    await chats.updateMessagesPrivacy('contacts')
    let n = sent.pop()
    assert.strictEqual(n.attrs.xmlns, 'privacy')
    assert.deepStrictEqual(n.content[0].content[0].attrs, { name: 'messages', value: 'contacts' })
    await chats.updateCallPrivacy('known')
    n = sent.pop()
    assert.deepStrictEqual(n.content[0].content[0].attrs, { name: 'calladd', value: 'known' })

    // bot list: hanya section "all"
    const bots = await chats.getBotListV2()
    assert.deepStrictEqual(bots, [{ jid: '1313555@bot', personaId: 'p1' }, { jid: '1313556@bot', personaId: 'p2' }])

    // call link
    const token = await chats.createCallLink('video', { startTime: 1700000000 })
    assert.strictEqual(token, 'TOKEN123')
    n = sent.pop()
    assert.strictEqual(n.attrs.to, '@call')
    assert.strictEqual(n.content[0].attrs.media, 'video')
    assert.strictEqual(n.content[0].content[0].attrs.start_time, '1700000000')
    await chats.createCallLink('audio')
    n = sent.pop()
    assert.strictEqual(n.content[0].content, undefined)

    // disappearing duration
    const list = await chats.fetchDisappearingDuration('a@s.whatsapp.net', 'b@s.whatsapp.net')
    assert.strictEqual(list[0].disappearingMode.duration, 86400)
    assert.strictEqual(calls.usync[0].users.length, 2)

    // semua nama terekspor
    for (const k of ['updateMessagesPrivacy', 'updateCallPrivacy', 'updateDisableLinkPreviewsPrivacy', 'getBotListV2', 'fetchDisappearingDuration', 'createCallLink']) {
        assert.strictEqual(typeof chats[k], 'function', k)
    }
    console.log('tes tahap 3 (chats) lulus')
})().catch(e => { console.error(e); process.exit(1) })
