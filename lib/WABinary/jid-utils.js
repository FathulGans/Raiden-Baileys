"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

exports.S_WHATSAPP_NET = '@s.whatsapp.net';
exports.OFFICIAL_BIZ_JID = '16505361212@c.us';
exports.SERVER_JID = 'server@c.us';
exports.PSA_WID = '0@c.us';
exports.STORIES_JID = 'status@broadcast';
exports.META_AI_JID = '13135550002@c.us';

// Nilai domainType dipakai saat encode JID_AD di WABinary/encode.js
// (0 = PN, 1 = LID, 128 = hosted PN, 129 = hosted LID)
const WAJIDDomains = { WHATSAPP: 0, LID: 1, HOSTED: 128, HOSTED_LID: 129 };
exports.WAJIDDomains = WAJIDDomains;

/** domainType (byte AD_JID) -> server; sama dengan rc14 */
const getServerFromDomainType = (initialServer, domainType) => {
    switch (domainType) {
        case WAJIDDomains.LID:
            return 'lid';
        case WAJIDDomains.HOSTED:
            return 'hosted';
        case WAJIDDomains.HOSTED_LID:
            return 'hosted.lid';
        case WAJIDDomains.WHATSAPP:
        default:
            return initialServer;
    }
};
exports.getServerFromDomainType = getServerFromDomainType;

const jidEncode = (user, server, device, agent) => {
    return `${user || ''}${!!agent ? `_${agent}` : ''}${!!device ? `:${device}` : ''}@${server}`;
};
exports.jidEncode = jidEncode;

const jidDecode = (jid) => {
    const sepIdx = typeof jid === 'string' ? jid.indexOf('@') : -1;
    if (sepIdx < 0) {
        return undefined;
    }
    const server = jid.slice(sepIdx + 1);
    const userCombined = jid.slice(0, sepIdx);
    const [userAgent, device] = userCombined.split(':');
    const [user, agent] = userAgent.split('_');
    let domainType = WAJIDDomains.WHATSAPP;
    if (server === 'lid') domainType = WAJIDDomains.LID;
    else if (server === 'hosted') domainType = WAJIDDomains.HOSTED;
    else if (server === 'hosted.lid') domainType = WAJIDDomains.HOSTED_LID;
    else if (agent) domainType = parseInt(agent);
    return {
        server,
        user,
        domainType,
        device: device ? +device : undefined
    };
};
exports.jidDecode = jidDecode;

/** apakah dua jid milik user yang sama (device diabaikan) */
const areJidsSameUser = (jid1, jid2) => {
    var _a, _b;
    return (((_a = jidDecode(jid1)) === null || _a === void 0 ? void 0 : _a.user) === ((_b = jidDecode(jid2)) === null || _b === void 0 ? void 0 : _b.user));
};
exports.areJidsSameUser = areJidsSameUser;

/** jid nomor telepon (PN) */
const isJidUser = (jid) => (jid === null || jid === void 0 ? void 0 : jid.endsWith('@s.whatsapp.net'));
exports.isJidUser = isJidUser;
exports.isPnUser = isJidUser; // alias gaya v7

/** jid LID */
const isLidUser = (jid) => (jid === null || jid === void 0 ? void 0 : jid.endsWith('@lid'));
exports.isLidUser = isLidUser;

/** jid hosted (PN / LID) */
const isHostedPnUser = (jid) => (jid === null || jid === void 0 ? void 0 : jid.endsWith('@hosted'));
exports.isHostedPnUser = isHostedPnUser;
const isHostedLidUser = (jid) => (jid === null || jid === void 0 ? void 0 : jid.endsWith('@hosted.lid'));
exports.isHostedLidUser = isHostedLidUser;
/** JID Meta AI (bot) - sama dengan rc14 */
const isJidMetaAI = (jid) => (jid === null || jid === void 0 ? void 0 : jid.endsWith('@bot'));
exports.isJidMetaAI = isJidMetaAI;

const isJidBroadcast = (jid) => (jid === null || jid === void 0 ? void 0 : jid.endsWith('@broadcast'));
exports.isJidBroadcast = isJidBroadcast;
const isJidGroup = (jid) => (jid === null || jid === void 0 ? void 0 : jid.endsWith('@g.us'));
exports.isJidGroup = isJidGroup;
const isJidStatusBroadcast = (jid) => jid === 'status@broadcast';
exports.isJidStatusBroadcast = isJidStatusBroadcast;
const isJidNewsLetter = (jid) => (jid === null || jid === void 0 ? void 0 : jid.endsWith('newsletter'));
exports.isJidNewsLetter = isJidNewsLetter;

/** salin device dari satu jid ke jid lain (mis. PN:3 -> LID:3) */
const transferDevice = (fromJid, toJid) => {
    const fromDecoded = jidDecode(fromJid);
    const device = fromDecoded === null || fromDecoded === void 0 ? void 0 : fromDecoded.device;
    const { server, user } = jidDecode(toJid);
    return jidEncode(user, server, device);
};
exports.transferDevice = transferDevice;

const jidNormalizedUser = (jid) => {
    const result = jidDecode(jid);
    if (!result) {
        return '';
    }
    const { user, server } = result;
    return jidEncode(user, server === 'c.us' ? 's.whatsapp.net' : server);
};
exports.jidNormalizedUser = jidNormalizedUser;
