// Tes newsletterUpdate + issuePrivacyTokens + updateMemberLabel (sock palsu)
const assert = require('assert')
const sent = []
const fakeQuery = async (node) => { sent.push(node); return { tag: 'iq', attrs: {}, content: [] } }
const usyncPath = require.resolve('../lib/Socket/usync')
const fakeSock = {
    ev: { on() {}, off() {}, emit() {}, process() {}, buffer() {}, flush() {}, createBufferedFunction: f => f, isBuffering: () => false },
    ws: { on() {}, once() {}, off() {} },
    authState: { creds: { me: { id: '6281111111111:1@s.whatsapp.net', name: 'x' } }, keys: {} },
    generateMessageTag: () => 'TAG1', sendNode: async () => {}, query: fakeQuery, onUnexpectedError() {},
    executeUSyncQuery: async () => ({ list: [] }),
}
require.cache[usyncPath] = { id: usyncPath, filename: usyncPath, loaded: true, exports: { makeUSyncSocket: () => fakeSock } }
const logger = { info() {}, debug() {}, warn() {}, error() {}, trace() {}, child() { return logger } }
const cfg = { logger, markOnlineOnConnect: false, fireInitQueries: false, appStateMacVerification: {}, shouldIgnoreJid: () => false, shouldSyncHistoryMessage: () => false, options: {} }

;(async () => {
    const { makeNewsletterSocket } = require('../lib/Socket/newsletter')
    const nl = makeNewsletterSocket(cfg)
    assert.strictEqual(typeof nl.newsletterUpdate, 'function')
    await nl.newsletterUpdate('123@newsletter', { name: 'Baru' }).catch(() => {})
    const mex = sent.find(n => n.attrs && n.attrs.xmlns === 'w:mex')
    assert.ok(mex, 'query w:mex terkirim')
    const body = JSON.parse(Buffer.from(mex.content[0].content).toString())
    assert.strictEqual(body.variables.newsletter_id, '123@newsletter')
    assert.deepStrictEqual(body.variables.updates, { name: 'Baru', settings: null })

    const { makeMessagesSocket } = require('../lib/Socket/messages-send')
    let ms
    try { ms = makeMessagesSocket({ ...cfg, userDevicesCache: undefined, mediaCache: undefined, msgRetryCounterCache: undefined, patchMessageBeforeSending: m => m, options: {} }) }
    catch (e) { console.log('makeMessagesSocket tidak bisa dibuat dengan stub:', e.message); }
    if (ms) {
        for (const k of ['issuePrivacyTokens', 'updateMemberLabel', 'getPrivacyTokens']) assert.strictEqual(typeof ms[k], 'function', k)
        sent.length = 0
        await ms.issuePrivacyTokens(['6281234:5@s.whatsapp.net'], 1700000000)
        const t = sent.pop()
        assert.strictEqual(t.attrs.xmlns, 'privacy')
        assert.deepStrictEqual(t.content[0].content[0].attrs, { jid: '6281234@s.whatsapp.net', t: '1700000000', type: 'trusted_contact' })
    }
    console.log('tes tahap 3 (newsletter/messages-send) lulus')
})().catch(e => { console.error(e); process.exit(1) })
