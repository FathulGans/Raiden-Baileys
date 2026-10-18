"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decryptMessageNode = exports.decodeMessageNode = exports.extractAddressingContext = exports.getDecryptionJid = exports.SERVER_ERROR_CODES = exports.NACK_REASONS = exports.DECRYPTION_RETRY_CONFIG = exports.ACCOUNT_RESTRICTED_TEXT = exports.MISSING_KEYS_ERROR_TEXT = exports.NO_MESSAGE_FOUND_ERROR_TEXT = void 0;
const boom_1 = require("@hapi/boom");
const WAProto_1 = require("../../WAProto");
const WABinary_1 = require("../WABinary");
const generics_1 = require("./generics");
// Sinkron dengan Baileys rc14 (src/Utils/decode-wa-message.ts), dengan penyesuaian fork:
//  - cabang newsletter (plaintext + newsletterServerId) dipertahankan
//  - messageStubParameters untuk "tidak ada pesan" tetap [teks, stanza JSON] (dipakai messages-recv)
//  - key.participant TIDAK diubah di sini (tetap apa adanya dari stanza); PN/LID pasangannya ada di *Alt
const NO_MESSAGE_FOUND_ERROR_TEXT = 'Message absent from node';
exports.NO_MESSAGE_FOUND_ERROR_TEXT = NO_MESSAGE_FOUND_ERROR_TEXT;
const MISSING_KEYS_ERROR_TEXT = 'Key used already or never filled';
exports.MISSING_KEYS_ERROR_TEXT = MISSING_KEYS_ERROR_TEXT;
const ACCOUNT_RESTRICTED_TEXT = 'Your account has been restricted';
exports.ACCOUNT_RESTRICTED_TEXT = ACCOUNT_RESTRICTED_TEXT;
// Konfigurasi retry dekripsi
exports.DECRYPTION_RETRY_CONFIG = {
    maxRetries: 3,
    baseDelayMs: 100,
    sessionRecordErrors: ['No session record', 'SessionError: No session record']
};
/** Kode NACK yang kita kirim ke server (client -> server) */
exports.NACK_REASONS = {
    SenderReachoutTimelocked: 463,
    ParsingError: 487,
    UnrecognizedStanza: 488,
    UnrecognizedStanzaClass: 489,
    UnrecognizedStanzaType: 490,
    InvalidProtobuf: 491,
    InvalidHostedCompanionStanza: 493,
    MissingMessageSecret: 495,
    SignalErrorOldCounter: 496,
    MessageDeletedOnPeer: 499,
    UnhandledError: 500,
    UnsupportedAdminRevoke: 550,
    UnsupportedLIDGroup: 551,
    DBOperationFailed: 552
};
/** Kode error dari server di ack stanza (server -> client) yang sudah punya handler khusus */
exports.SERVER_ERROR_CODES = {
    /** pesan 1:1 tanpa privacy token (tctoken); biasanya akun dibatasi */
    MessageAccountRestriction: '463',
    /** validasi stanza gagal (SMAX_INVALID), kemungkinan sesi device basi */
    SmaxInvalid: '479'
};
/**
 * JID yang dipakai untuk dekripsi: LID kalau pengirim punya pemetaan LID (hanya cek lokal, tanpa jaringan),
 * kalau tidak, JID aslinya. Alamat sesi akhirnya tetap ditentukan oleh signalRepository (lid-session).
 */
const getDecryptionJid = async (sender, repository) => {
    var _a;
    if ((0, WABinary_1.isLidUser)(sender) || (0, WABinary_1.isHostedLidUser)(sender) || (0, WABinary_1.isHostedPnUser)(sender)) {
        return sender;
    }
    const store = repository === null || repository === void 0 ? void 0 : repository.lidMapping;
    if (!store || typeof store.getLIDForPN !== 'function') {
        return sender;
    }
    try {
        const mapped = await store.getLIDForPN(sender, { localOnly: true });
        return mapped || sender;
    }
    catch (_b) {
        return sender;
    }
};
exports.getDecryptionJid = getDecryptionJid;
/** Ambil konteks addressing (PN vs LID) dan JID pasangannya dari atribut stanza */
const extractAddressingContext = (stanza) => {
    let senderAlt;
    let recipientAlt;
    const sender = stanza.attrs.participant || stanza.attrs.from;
    const addressingMode = stanza.attrs.addressing_mode || ((sender === null || sender === void 0 ? void 0 : sender.endsWith('lid')) ? 'lid' : 'pn');
    if (addressingMode === 'lid') {
        // pesan beralamat LID: pengirim LID, pasangannya PN
        senderAlt = stanza.attrs.participant_pn || stanza.attrs.sender_pn || stanza.attrs.peer_recipient_pn;
        recipientAlt = stanza.attrs.recipient_pn;
    }
    else {
        // pesan beralamat PN: pengirim PN, pasangannya LID
        senderAlt = stanza.attrs.participant_lid || stanza.attrs.sender_lid || stanza.attrs.peer_recipient_lid;
        recipientAlt = stanza.attrs.recipient_lid;
    }
    return { addressingMode, senderAlt, recipientAlt };
};
exports.extractAddressingContext = extractAddressingContext;
/**
 * Decode the received node as a message.
 * @note this will only parse the message, not decrypt it
 */
function decodeMessageNode(stanza, meId, meLid) {
    var _a, _b;
    let msgType;
    let chatId;
    let author;
    let fromMe = false;
    const msgId = stanza.attrs.id;
    const from = stanza.attrs.from;
    const participant = stanza.attrs.participant;
    const recipient = stanza.attrs.recipient;
    if (!msgId) {
        throw new boom_1.Boom('Invalid message stanza: missing id attribute', { data: stanza });
    }
    if (!from) {
        throw new boom_1.Boom('Invalid message stanza: missing from attribute', { data: stanza });
    }
    const addressingContext = (0, exports.extractAddressingContext)(stanza);
    const isMe = (jid) => (0, WABinary_1.areJidsSameUser)(jid, meId);
    const isMeLid = (jid) => (0, WABinary_1.areJidsSameUser)(jid, meLid);
    if ((0, WABinary_1.isJidUser)(from) || (0, WABinary_1.isLidUser)(from) || (0, WABinary_1.isHostedLidUser)(from) || (0, WABinary_1.isHostedPnUser)(from)) {
        if (recipient && !(0, WABinary_1.isJidMetaAI)(recipient)) {
            if (!isMe(from) && !isMeLid(from)) {
                throw new boom_1.Boom('receipient present, but msg not from me', { data: stanza });
            }
            fromMe = true;
            chatId = recipient;
        }
        else {
            // stanza peer-routed (history sync, app-state sync, dll.) datang dengan `from` = device kita sendiri
            // tanpa atribut `recipient`; tetap fromMe supaya handler pesan-ke-diri-sendiri jalan.
            if (isMe(from) || isMeLid(from)) {
                fromMe = true;
            }
            chatId = from;
        }
        msgType = 'chat';
        author = from;
    }
    else if ((0, WABinary_1.isJidGroup)(from)) {
        if (!participant) {
            throw new boom_1.Boom('No participant in group message');
        }
        if (isMe(participant) || isMeLid(participant)) {
            fromMe = true;
        }
        msgType = 'group';
        author = participant;
        chatId = from;
    }
    else if ((0, WABinary_1.isJidBroadcast)(from)) {
        if (!participant) {
            throw new boom_1.Boom('No participant in group message');
        }
        const isParticipantMe = isMe(participant) || isMeLid(participant);
        if ((0, WABinary_1.isJidStatusBroadcast)(from)) {
            msgType = isParticipantMe ? 'direct_peer_status' : 'other_status';
        }
        else {
            msgType = isParticipantMe ? 'peer_broadcast' : 'other_broadcast';
        }
        fromMe = isParticipantMe;
        chatId = from;
        author = participant;
    }
    else if ((0, WABinary_1.isJidNewsLetter)(from)) {
        msgType = 'newsletter';
        author = from;
        chatId = from;
        fromMe = !!((_a = stanza.attrs) === null || _a === void 0 ? void 0 : _a.is_sender);
    }
    else {
        throw new boom_1.Boom('Unknown message type', { data: stanza });
    }
    const pushname = stanza.attrs.notify;
    const isGroupChat = (0, WABinary_1.isJidGroup)(chatId);
    const isNewsletter = msgType === 'newsletter';
    const key = {
        remoteJid: chatId,
        fromMe,
        id: msgId,
        participant
    };
    // pasangan PN<->LID + addressing mode (sama dengan rc14; hanya diisi bila ada)
    if (!isNewsletter) {
        if (!isGroupChat && addressingContext.senderAlt) {
            key.remoteJidAlt = addressingContext.senderAlt;
        }
        if (isGroupChat && addressingContext.senderAlt) {
            key.participantAlt = addressingContext.senderAlt;
        }
        const remoteJidUsername = !isGroupChat ? stanza.attrs.peer_recipient_username || stanza.attrs.recipient_username : undefined;
        if (remoteJidUsername) {
            key.remoteJidUsername = remoteJidUsername;
        }
        if (stanza.attrs.participant && stanza.attrs.participant_username) {
            key.participantUsername = stanza.attrs.participant_username;
        }
        key.addressingMode = addressingContext.addressingMode;
    }
    const fullMessage = {
        key,
        category: stanza.attrs.category,
        messageTimestamp: +stanza.attrs.t,
        pushName: pushname,
        broadcast: (0, WABinary_1.isJidBroadcast)(from)
    };
    if (isNewsletter) {
        fullMessage.newsletterServerId = +((_b = stanza.attrs) === null || _b === void 0 ? void 0 : _b.server_id);
    }
    if (key.fromMe) {
        fullMessage.status = WAProto_1.proto.WebMessageInfo.Status.SERVER_ACK;
    }
    return {
        fullMessage,
        author,
        sender: msgType === 'chat' ? author : chatId
    };
}
exports.decodeMessageNode = decodeMessageNode;
/** Apakah error terkait sesi yang hilang */
function isSessionRecordError(error) {
    const errorMessage = (error === null || error === void 0 ? void 0 : error.message) || (error === null || error === void 0 ? void 0 : error.toString()) || '';
    return exports.DECRYPTION_RETRY_CONFIG.sessionRecordErrors.some(pattern => errorMessage.includes(pattern));
}
const decryptMessageNode = (stanza, meId, meLid, repository, logger) => {
    const { fullMessage, author, sender } = decodeMessageNode(stanza, meId, meLid);
    return {
        fullMessage,
        category: stanza.attrs.category,
        author,
        async decrypt() {
            var _a;
            let decryptables = 0;
            async function processSenderKeyDistribution(msg) {
                if (msg.senderKeyDistributionMessage) {
                    try {
                        await repository.processSenderKeyDistributionMessage({
                            authorJid: author,
                            item: msg.senderKeyDistributionMessage
                        });
                    }
                    catch (err) {
                        logger.error({ key: fullMessage.key, err }, 'failed to process senderKeyDistribution');
                    }
                }
            }
            if ((0, WABinary_1.isJidNewsLetter)(fullMessage.key.remoteJid)) {
                const node = (0, WABinary_1.getBinaryNodeChild)(stanza, 'plaintext');
                const msg = WAProto_1.proto.Message.decode(node === null || node === void 0 ? void 0 : node.content);
                await processSenderKeyDistribution(msg);
                fullMessage.message = msg;
                decryptables += 1;
            }
            else if (Array.isArray(stanza.content)) {
                for (const { tag, attrs, content } of stanza.content) {
                    if (tag === 'verified_name' && content instanceof Uint8Array) {
                        const cert = WAProto_1.proto.VerifiedNameCertificate.decode(content);
                        const details = WAProto_1.proto.VerifiedNameCertificate.Details.decode(cert.details);
                        fullMessage.verifiedBizName = details.verifiedName;
                    }
                    if (tag === 'unavailable' && attrs.type === 'view_once') {
                        fullMessage.key.isViewOnce = true;
                    }
                    if (attrs.count && tag === 'enc') {
                        fullMessage.retryCount = Number(attrs.count);
                    }
                    if (tag !== 'enc' && tag !== 'plaintext') {
                        continue;
                    }
                    if (!(content instanceof Uint8Array)) {
                        continue;
                    }
                    decryptables += 1;
                    let msgBuffer;
                    const decryptionJid = await (0, exports.getDecryptionJid)(author, repository);
                    try {
                        const e2eType = tag === 'plaintext' ? 'plaintext' : attrs.type;
                        switch (e2eType) {
                            case 'skmsg':
                                msgBuffer = await repository.decryptGroupMessage({
                                    group: sender,
                                    authorJid: author,
                                    msg: content
                                });
                                break;
                            case 'pkmsg':
                            case 'msg':
                                msgBuffer = await repository.decryptMessage({
                                    jid: decryptionJid,
                                    type: e2eType,
                                    ciphertext: content
                                });
                                break;
                            case 'plaintext':
                                msgBuffer = content;
                                break;
                            default:
                                throw new Error(`Unknown e2e type: ${e2eType}`);
                        }
                        let msg = WAProto_1.proto.Message.decode(e2eType !== 'plaintext' ? (0, generics_1.unpadRandomMax16)(msgBuffer) : msgBuffer);
                        msg = ((_a = msg.deviceSentMessage) === null || _a === void 0 ? void 0 : _a.message) || msg;
                        await processSenderKeyDistribution(msg);
                        if (fullMessage.message) {
                            Object.assign(fullMessage.message, msg);
                        }
                        else {
                            fullMessage.message = msg;
                        }
                    }
                    catch (err) {
                        logger.error({
                            key: fullMessage.key,
                            err,
                            messageType: tag === 'plaintext' ? 'plaintext' : attrs.type,
                            sender,
                            author,
                            isSessionRecordError: isSessionRecordError(err)
                        }, 'failed to decrypt message');
                        fullMessage.messageStubType = WAProto_1.proto.WebMessageInfo.StubType.CIPHERTEXT;
                        fullMessage.messageStubParameters = [String(err === null || err === void 0 ? void 0 : err.message)];
                    }
                }
            }
            // if nothing was found to decrypt
            if (!decryptables && !(fullMessage.key && fullMessage.key.isViewOnce)) {
                fullMessage.messageStubType = WAProto_1.proto.WebMessageInfo.StubType.CIPHERTEXT;
                fullMessage.messageStubParameters = [NO_MESSAGE_FOUND_ERROR_TEXT, JSON.stringify(stanza, generics_1.BufferJSON.replacer)];
            }
        }
    };
};
exports.decryptMessageNode = decryptMessageNode;
