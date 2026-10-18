const assert = require('assert')
const { chatModificationToAppPatch } = require('../lib/Utils/chat-utils')
const { proto } = require('../WAProto')
const OP = proto.SyncdMutation.SyncdOperation
const jid = '6281234567890@s.whatsapp.net'

// addOrEditContact
let p = chatModificationToAppPatch({ contact: { fullName: 'Budi', firstName: 'Budi' } }, jid)
assert.deepStrictEqual(p.index, ['contact', jid])
assert.strictEqual(p.operation, OP.SET)
assert.strictEqual(p.type, 'critical_unblock_low')
assert.strictEqual(p.apiVersion, 2)
assert.strictEqual(p.syncAction.contactAction.fullName, 'Budi')
assert.ok(p.syncAction.timestamp)

// removeContact
p = chatModificationToAppPatch({ contact: null }, jid)
assert.strictEqual(p.operation, OP.REMOVE)
assert.deepStrictEqual(p.syncAction.contactAction, {})

// addLabel
p = chatModificationToAppPatch({ addLabel: { id: '7', name: 'VIP', color: 3, deleted: false } }, jid)
assert.deepStrictEqual(p.index, ['label_edit', '7'])
assert.strictEqual(p.apiVersion, 3)
assert.strictEqual(p.syncAction.labelEditAction.name, 'VIP')
assert.strictEqual(p.syncAction.labelEditAction.color, 3)

// addOrEditQuickReply
p = chatModificationToAppPatch({ quickReply: { shortcut: '/hai', message: 'Halo!', timestamp: '1700000000' } }, '')
assert.deepStrictEqual(p.index, ['quick_reply', '1700000000'])
assert.strictEqual(p.syncAction.quickReplyAction.shortcut, '/hai')
assert.strictEqual(p.syncAction.quickReplyAction.deleted, false)

// removeQuickReply
p = chatModificationToAppPatch({ quickReply: { timestamp: '1700000000', deleted: true } }, '')
assert.strictEqual(p.syncAction.quickReplyAction.deleted, true)
assert.deepStrictEqual(p.index, ['quick_reply', '1700000000'])

// disableLinkPreviews (tahap 3)
p = chatModificationToAppPatch({ disableLinkPreviews: { isPreviewsDisabled: true } }, '')
assert.deepStrictEqual(p.index, ['setting_disableLinkPreviews'])
assert.strictEqual(p.apiVersion, 8)
assert.strictEqual(p.type, 'regular')
assert.strictEqual(p.syncAction.privacySettingDisableLinkPreviewsAction.isPreviewsDisabled, true)

// tetap menolak mod tidak dikenal
assert.throws(() => chatModificationToAppPatch({ foo: 1 }, jid), /not supported/)

console.log('tes langkah chat-modify lulus')
