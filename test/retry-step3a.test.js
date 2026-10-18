// Tes langkah 3a: MessageRetryManager + TTLCache (port rc14, tanpa lru-cache)
const assert = require('assert');
const { MessageRetryManager, RetryReason, TTLCache } = require('../lib/Utils/message-retry-manager');
const logger = { debug() {}, warn() {}, info() {}, trace() {}, error() {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    // TTLCache: kedaluwarsa, max, dispose, updateAgeOnGet
    const disposed = [];
    const c = new TTLCache({ max: 2, ttl: 30, dispose: (v, k) => disposed.push(k) });
    c.set('a', 1); c.set('b', 2); c.set('c', 3);
    assert.strictEqual(c.get('a'), undefined); assert.deepStrictEqual(disposed, ['a']);
    c.set('b', 22); assert.strictEqual(c.get('b'), 22); assert.deepStrictEqual(disposed, ['a']); // timpa tidak dispose
    await sleep(40);
    assert.strictEqual(c.get('b'), undefined); assert.ok(disposed.includes('b'));
    const u = new TTLCache({ ttl: 40, updateAgeOnGet: true });
    u.set('x', 1); await sleep(25); assert.strictEqual(u.get('x'), 1); await sleep(25); assert.strictEqual(u.get('x'), 1);
    await sleep(50); assert.strictEqual(u.get('x'), undefined);

    const m = new MessageRetryManager(logger, 3);
    // pesan terbaru + index
    m.addRecentMessage('a@s.whatsapp.net', 'M1', { conversation: 'hi' });
    assert.deepStrictEqual(m.getRecentMessage('a@s.whatsapp.net', 'M1').message, { conversation: 'hi' });
    assert.strictEqual(m.getRecentMessage('a@s.whatsapp.net', 'M2'), undefined);
    // batas retry
    assert.strictEqual(m.incrementRetryCount('M1'), 1);
    assert.strictEqual(m.incrementRetryCount('M1'), 2);
    assert.ok(!m.hasExceededMaxRetries('M1'));
    m.incrementRetryCount('M1');
    assert.ok(m.hasExceededMaxRetries('M1'));
    m.markRetryFailed('M1');
    assert.strictEqual(m.getRetryCount('M1'), 0);
    assert.strictEqual(m.getRecentMessage('a@s.whatsapp.net', 'M1'), undefined); // ikut dibersihkan
    assert.strictEqual(m.statistics.failedRetries, 1);
    // sukses
    m.addRecentMessage('a@s.whatsapp.net', 'M3', {}); m.markRetrySuccess('M3');
    assert.strictEqual(m.getRecentMessage('a@s.whatsapp.net', 'M3'), undefined);
    assert.strictEqual(m.statistics.successfulRetries, 1);
    // recreate sesi
    assert.deepStrictEqual(m.shouldRecreateSession('j', false).recreate, true);
    assert.strictEqual(m.shouldRecreateSession('j', true).recreate, false);             // baru saja dibuat ulang
    assert.strictEqual(m.shouldRecreateSession('j2', true, RetryReason.SignalErrorBadMac).recreate, true);
    assert.strictEqual(m.shouldRecreateSession('j2', true, RetryReason.SignalErrorInvalidMessage).recreate, true);
    assert.strictEqual(m.shouldRecreateSession('j2', true, RetryReason.SignalErrorNoSession).recreate, false);
    assert.strictEqual(m.shouldRecreateSession('j3', true).recreate, true);             // belum pernah
    // parse error code
    assert.strictEqual(m.parseRetryErrorCode(undefined), undefined);
    assert.strictEqual(m.parseRetryErrorCode(''), undefined);
    assert.strictEqual(m.parseRetryErrorCode('abc'), undefined);
    assert.strictEqual(m.parseRetryErrorCode('7'), 7);
    assert.strictEqual(m.parseRetryErrorCode('99'), RetryReason.UnknownError);
    assert.ok(m.isMacError(4) && m.isMacError(7) && !m.isMacError(1) && !m.isMacError(undefined));
    assert.strictEqual(RetryReason[7], 'SignalErrorBadMac');
    // base key
    m.saveBaseKey('addr', 'id', Buffer.from([1, 2, 3]));
    assert.ok(m.hasSameBaseKey('addr', 'id', Buffer.from([1, 2, 3])));
    assert.ok(!m.hasSameBaseKey('addr', 'id', Buffer.from([1, 2, 4])));
    assert.ok(!m.hasSameBaseKey('addr', 'id', Buffer.from([1, 2])));
    m.deleteBaseKey('addr', 'id'); assert.ok(!m.hasSameBaseKey('addr', 'id', Buffer.from([1, 2, 3])));
    // phone request: jadwal, batal, jalan
    let ran = 0;
    m.schedulePhoneRequest('P1', () => ran++, 10); m.cancelPendingPhoneRequest('P1'); await sleep(25); assert.strictEqual(ran, 0);
    m.schedulePhoneRequest('P2', () => ran++, 10); await sleep(25); assert.strictEqual(ran, 1); assert.strictEqual(m.statistics.phoneRequests, 1);
    // clear
    m.schedulePhoneRequest('P3', () => ran++, 10); m.clear(); await sleep(25);
    assert.strictEqual(ran, 1); assert.strictEqual(m.statistics.totalRetries, 0);
    console.log('tes langkah 3a lulus');
})().catch(e => { console.error(e); process.exit(1); });
