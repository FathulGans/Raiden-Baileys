// Tes modul hasil port rc14: stanza-ack, identity-change-handler, offline-node-processor,
// sync-action-utils, USyncUsernameProtocol, mex, communities (sock palsu, tanpa server WhatsApp)
const assert = require('assert')
// muat Utils (index) lebih dulu: urutan require langsung ke Utils/generics memicu sirkular lama dengan Defaults
const { isStringNullOrEmpty } = require('../lib/Utils')
const { buildAckStanza } = require('../lib/Utils/stanza-ack')
const { handleIdentityChange } = require('../lib/Utils/identity-change-handler')
const { makeOfflineNodeProcessor } = require('../lib/Utils/offline-node-processor')
const { processContactAction, emitSyncActionResults } = require('../lib/Utils/sync-action-utils')
const { USyncUsernameProtocol } = require('../lib/WAUSync/Protocols/USyncUsernameProtocol')
const { executeWMexQuery } = require('../lib/Socket/mex')

const logger = { info() {}, debug() {}, warn() {}, error() {}, trace() {} }

;(async () => {
    // --- stanza-ack
    const ack = buildAckStanza({ tag: 'message', attrs: { id: 'A1', from: 'x@g.us', participant: 'p@s.whatsapp.net', type: 'text' } }, 0, 'me@s.whatsapp.net')
    assert.deepStrictEqual(ack, { tag: 'ack', attrs: { id: 'A1', to: 'x@g.us', class: 'message', participant: 'p@s.whatsapp.net', type: 'text', from: 'me@s.whatsapp.net' } })
    const nack = buildAckStanza({ tag: 'receipt', attrs: { id: 'B', from: 'y@s.whatsapp.net' } }, 487)
    assert.strictEqual(nack.attrs.error, '487')
    assert.strictEqual(nack.attrs.from, undefined)

    // --- isStringNullOrEmpty
    assert.ok(isStringNullOrEmpty(undefined) && isStringNullOrEmpty('') && !isStringNullOrEmpty('a'))

    // --- identity-change-handler
    const mkCtx = (over = {}) => ({
        meId: '6281@s.whatsapp.net', meLid: '99@lid', logger,
        debounceCache: new Map(), validateSession: async () => ({ exists: true }),
        assertSessions: async () => {}, ...over
    })
    const idNode = (from, extra = {}) => ({ tag: 'notification', attrs: { from, ...extra }, content: [{ tag: 'identity', attrs: {}, content: Buffer.alloc(1) }] })
    assert.strictEqual((await handleIdentityChange({ tag: 'notification', attrs: {} }, mkCtx())).action, 'invalid_notification')
    assert.strictEqual((await handleIdentityChange({ tag: 'notification', attrs: { from: 'a@s.whatsapp.net' } }, mkCtx())).action, 'no_identity_node')
    assert.strictEqual((await handleIdentityChange(idNode('62822:3@s.whatsapp.net'), mkCtx())).action, 'skipped_companion_device')
    assert.strictEqual((await handleIdentityChange(idNode('6281@s.whatsapp.net'), mkCtx())).action, 'skipped_self_primary')
    assert.strictEqual((await handleIdentityChange(idNode('62833@s.whatsapp.net'), mkCtx({ validateSession: async () => ({ exists: false }) }))).action, 'skipped_no_session')
    assert.strictEqual((await handleIdentityChange(idNode('62834@s.whatsapp.net', { offline: '1' }), mkCtx())).action, 'skipped_offline')
    let asserted
    const okCtx = mkCtx({ assertSessions: async (j, f) => { asserted = [j, f] } })
    assert.strictEqual((await handleIdentityChange(idNode('62835@s.whatsapp.net'), okCtx)).action, 'session_refreshed')
    assert.deepStrictEqual(asserted, [['62835@s.whatsapp.net'], true])
    assert.strictEqual((await handleIdentityChange(idNode('62835@s.whatsapp.net'), okCtx)).action, 'debounced')
    const failed = await handleIdentityChange(idNode('62836@s.whatsapp.net'), mkCtx({ assertSessions: async () => { throw new Error('x') } }))
    assert.strictEqual(failed.action, 'session_refresh_failed')

    // --- offline-node-processor (urut, error tidak menghentikan antrean, yield tiap batch)
    const order = []; const errors = []; let yields = 0
    const map = new Map([
        ['message', async n => { order.push(n) }],
        ['boom', async () => { throw new Error('boom') }]
    ])
    const proc = makeOfflineNodeProcessor(map, { isWsOpen: () => true, onUnexpectedError: e => errors.push(e.message), yieldToEventLoop: async () => { yields++ } }, 2)
    proc.enqueue('message', 1); proc.enqueue('boom', 2); proc.enqueue('message', 3); proc.enqueue('nope', 4); proc.enqueue('message', 5)
    await new Promise(r => setTimeout(r, 30))
    assert.deepStrictEqual(order, [1, 3, 5])
    assert.ok(errors.includes('boom') && errors.some(e => e.includes('unknown offline node type: nope')))
    assert.ok(yields >= 1)

    // --- sync-action-utils
    assert.deepStrictEqual(processContactAction({}, undefined, logger), [])
    const res = processContactAction({ fullName: 'Budi', lidJid: '123@lid' }, '6281@s.whatsapp.net', logger)
    assert.strictEqual(res.length, 2)
    assert.strictEqual(res[0].data[0].phoneNumber, '6281@s.whatsapp.net')
    assert.deepStrictEqual(res[1], { event: 'lid-mapping.update', data: { lid: '123@lid', pn: '6281@s.whatsapp.net' } })
    const emitted = []
    emitSyncActionResults({ emit: (e, d) => emitted.push(e) }, res)
    assert.deepStrictEqual(emitted, ['contacts.upsert', 'lid-mapping.update'])

    // --- USyncUsernameProtocol
    const up = new USyncUsernameProtocol()
    assert.strictEqual(up.name, 'username')
    assert.deepStrictEqual(up.getQueryElement(), { tag: 'username', attrs: {} })
    assert.strictEqual(up.parser({ tag: 'username', attrs: {}, content: 'kaze' }), 'kaze')
    assert.strictEqual(up.parser({ tag: 'other', attrs: {} }), null)

    // --- mex
    let sentNode
    const okQuery = async node => { sentNode = node; return { tag: 'iq', attrs: {}, content: [{ tag: 'result', attrs: {}, content: Buffer.from(JSON.stringify({ data: { thing: { a: 1 } } })) }] } }
    assert.deepStrictEqual(await executeWMexQuery({ x: 1 }, 'QID', 'thing', okQuery, () => 'T1'), { a: 1 })
    assert.strictEqual(sentNode.attrs.xmlns, 'w:mex')
    assert.strictEqual(sentNode.content[0].attrs.query_id, 'QID')
    const errQuery = async () => ({ tag: 'iq', attrs: {}, content: [{ tag: 'result', attrs: {}, content: Buffer.from(JSON.stringify({ errors: [{ message: 'nope', extensions: { error_code: 404 } }] })) }] })
    await assert.rejects(() => executeWMexQuery({}, 'Q', 'thing', errQuery, () => 'T'), e => e.output.statusCode === 404)
    await assert.rejects(() => executeWMexQuery({}, 'Q', 'xwa2_do_thing', async () => ({ tag: 'iq', attrs: {} }), () => 'T'), e => /Failed to do thing/.test(e.message))

    // --- communities (sock palsu menggantikan registration)
    const regPath = require.resolve('../lib/Socket/registration')
    const sentQ = []
    const fakeSock = {
        ev: { on() {}, off() {}, emit() {}, createBufferedFunction: fn => fn },
        ws: { on() {}, once() {}, off() {} },
        authState: { creds: { me: { id: '6281111111111:1@s.whatsapp.net' } }, keys: {} },
        query: async node => {
            sentQ.push(node)
            if (node.attrs.type === 'get' && node.content[0].tag === 'query') {
                return {
                    tag: 'iq', attrs: {}, content: [{
                        tag: 'community', attrs: { id: '1234', subject: 'Komunitas', creator: '6281@s.whatsapp.net', creation: '10', s_t: '5' },
                        content: [
                            { tag: 'parent', attrs: {} }, { tag: 'announcement', attrs: {} },
                            { tag: 'description', attrs: { id: 'D1' }, content: [{ tag: 'body', attrs: {}, content: 'halo' }] },
                            { tag: 'participant', attrs: { jid: '6281@s.whatsapp.net', type: 'superadmin' } },
                            { tag: 'participant', attrs: { jid: '6282@s.whatsapp.net' } }
                        ]
                    }]
                }
            }
            return { tag: 'iq', attrs: {}, content: [] }
        },
        upsertMessage: async () => {}, cleanDirtyBits: async () => {}, sendNode: async () => {}
    }
    require.cache[regPath] = { id: regPath, filename: regPath, loaded: true, exports: { makeRegistrationSocket: () => fakeSock } }
    const comm = require('../lib/Socket/communities')
    const cs = comm.makeCommunitiesSocket({ logger })
    for (const fn of ['communityMetadata', 'communityCreate', 'communityLeave', 'communityFetchAllParticipating']) {
        assert.strictEqual(typeof cs[fn], 'function', fn)
    }
    const meta = await cs.communityMetadata('1234@g.us')
    assert.strictEqual(meta.id, '1234@g.us')
    assert.strictEqual(meta.subject, 'Komunitas')
    assert.strictEqual(meta.desc, 'halo')
    assert.strictEqual(meta.isCommunity, true)
    assert.strictEqual(meta.announce, true)
    assert.strictEqual(meta.size, 2)
    assert.deepStrictEqual(meta.participants[0], { id: '6281@s.whatsapp.net', admin: 'superadmin' })
    assert.strictEqual(sentQ[0].attrs.xmlns, 'w:g2')

    console.log('tes modul rc14 lulus')
    process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
