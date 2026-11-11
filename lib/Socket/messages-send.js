"use strict"; 
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
}; 
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeMessagesSocket = void 0;
const boom_1 = require("@hapi/boom");
const node_cache_1 = __importDefault(require("node-cache"));
const WAProto_1 = require("../../WAProto");
const Defaults_1 = require("../Defaults");
const Types_1 = require("../Types");
const Utils_1 = require("../Utils");
const link_preview_1 = require("../Utils/link-preview");
const WABinary_1 = require("../WABinary");
const newsletter_1 = require("./newsletter");
const WAUSync_1 = require("../WAUSync");
const ClutchHandler = require('./clutch-handler');
const crypto = require('crypto');

const { Button, ButtonV2, Carousel, AIRich } = require("../Utils/MessageBuilder");
const rich_menu_1 = require("../Utils/rich-menu");
const a2ui_1 = require("../Utils/a2ui");
const makeMessagesSocket = (config) => {
    const {
        logger,
        linkPreviewImageThumbnailWidth, 
        generateHighQualityLinkPreview,
        options: axiosOptions,
        patchMessageBeforeSending,
        maxMsgRetryCount,
        enableRecentMessageCache,
        albumMessageItemDelayMs = 0
    } = config;
    const sock = (0, newsletter_1.makeNewsletterSocket)(config);
    const {
        ev, 
        authState, 
        processingMutex, 
        signalRepository, 
        upsertMessage,
        query,
        fetchPrivacySettings,
        sendNode, 
        groupMetadata,
        groupToggleEphemeral,
        executeUSyncQuery
    } = sock;
    // cache pesan terkirim untuk menangani retry receipt (port dari Baileys rc14)
    const messageRetryManager = enableRecentMessageCache ? new Utils_1.MessageRetryManager(logger, maxMsgRetryCount) : null;
    const userDevicesCache = config.userDevicesCache || new node_cache_1.default({
        stdTTL: Defaults_1.DEFAULT_CACHE_TTLS.USER_DEVICES,
        useClones: false
    });
    let mediaConn;
    const refreshMediaConn = async (forceGet = false) => {
        const media = await mediaConn;
        if (!media || forceGet || (new Date().getTime() - media.fetchDate.getTime()) > media.ttl * 1000) {
            mediaConn = (async () => {
                const result = await query({
                    tag: 'iq',
                    attrs: {
                        type: 'set',
                        xmlns: 'w:m',
                        to: WABinary_1.S_WHATSAPP_NET,
                    },
                    content: [{ tag: 'media_conn', attrs: {} }]
                });
                const mediaConnNode = WABinary_1.getBinaryNodeChild(result, 'media_conn');
                const node = {
                    hosts: WABinary_1.getBinaryNodeChildren(mediaConnNode, 'host').map(({ attrs }) => ({
                        hostname: attrs.hostname,
                        maxContentLengthBytes: +attrs.maxContentLengthBytes,
                    })),
                    auth: mediaConnNode.attrs.auth,
                    ttl: +mediaConnNode.attrs.ttl,
                    fetchDate: new Date()
                };
                logger.debug('fetched media conn');
                return node;
            })();
        }
        return mediaConn;
    };
    const sendReceipt = async (jid, participant, messageIds, type) => {
        const node = {
            tag: 'receipt',
            attrs: {
                id: messageIds[0],
            },
        };
        const isReadReceipt = type === 'read' || type === 'read-self';
        if (isReadReceipt) {
            node.attrs.t = (0, Utils_1.unixTimestampSeconds)().toString();
        }
        if (type === 'sender' && WABinary_1.isJidUser(jid)) {
            node.attrs.recipient = jid;
            node.attrs.to = participant;
        }
        else {
            node.attrs.to = jid;
            if (participant) {
                node.attrs.participant = participant;
            }
        }
        if (type) {
            node.attrs.type = WABinary_1.isJidNewsLetter(jid) ? 'read-self' : type;
        }
        const remainingMessageIds = messageIds.slice(1);
        if (remainingMessageIds.length) {
            node.content = [
                {
                    tag: 'list',
                    attrs: {},
                    content: remainingMessageIds.map(id => ({
                        tag: 'item',
                        attrs: { id }
                    }))
                }
            ];
        }
        logger.debug({ attrs: node.attrs, messageIds }, 'sending receipt for messages');
        await sendNode(node);
    };
    const sendReceipts = async (keys, type) => {
        const recps = (0, Utils_1.aggregateMessageKeysNotFromMe)(keys);
        for (const { jid, participant, messageIds } of recps) {
            await sendReceipt(jid, participant, messageIds, type);
        }
    };
    const readMessages = async (keys) => {
        const privacySettings = await fetchPrivacySettings();
        const readType = privacySettings.readreceipts === 'all' ? 'read' : 'read-self';
        await sendReceipts(keys, readType);
    };
    const getUSyncDevices = async (jids, useCache, ignoreZeroDevices) => {
        const deviceResults = []
        if (!useCache) {
            logger.debug('not using cache for devices')
        }
        const toFetch = []
        jids = Array.from(new Set(jids))
        for (let jid of jids) {
            const user = WABinary_1.jidDecode(jid)?.user
            jid = WABinary_1.jidNormalizedUser(jid)
            if (useCache) {
                const devices = userDevicesCache.get(user)
                if (devices) {
                    deviceResults.push(...devices)
                    logger.trace({ user }, 'using cache for devices')
                }
                else {
                    toFetch.push(jid)
                }
            }
            else {
                toFetch.push(jid)
            }
        }
        if (!toFetch.length) {
            return deviceResults
        }
        const query = new WAUSync_1.USyncQuery()
            .withContext('message')
            .withDeviceProtocol()
        for (const jid of toFetch) {
            query.withUser(new WAUSync_1.USyncUser().withId(jid))
        }
        const result = await executeUSyncQuery(query)
        if (result) {
            const extracted = Utils_1.extractDeviceJids(result?.list, authState.creds.me.id, ignoreZeroDevices)
            const deviceMap = {}
            for (const item of extracted) {
                deviceMap[item.user] = deviceMap[item.user] || []
                deviceMap[item.user].push(item)
                deviceResults.push(item)
            }
            for (const key in deviceMap) {
                userDevicesCache.set(key, deviceMap[key])
            }
        }
        return deviceResults
    }
    const assertSessions = async (jids, force) => {
        let didFetchNewSession = false;
        let jidsRequiringFetch = [];
        if (force) {
            jidsRequiringFetch = jids;
        }
        else {
            const addrs = await Promise.all(jids.map(jid => signalRepository.resolveSessionAddress
                ? signalRepository.resolveSessionAddress(jid)
                : signalRepository.jidToSignalProtocolAddress(jid)));
            const sessions = await authState.keys.get('session', addrs);
            for (let i = 0; i < jids.length; i++) {
                if (!sessions[addrs[i]]) {
                    jidsRequiringFetch.push(jids[i]);
                }
            }
        }
        if (jidsRequiringFetch.length) {
            logger.debug({ jidsRequiringFetch }, 'fetching sessions');
            const result = await query({
                tag: 'iq',
                attrs: {
                    xmlns: 'encrypt',
                    type: 'get',
                    to: WABinary_1.S_WHATSAPP_NET,
                },
                content: [
                    {
                        tag: 'key',
                        attrs: {},
                        content: jidsRequiringFetch.map(jid => ({
                            tag: 'user',
                            attrs: { jid },
                        }))
                    }
                ]
            });
            await (0, Utils_1.parseAndInjectE2ESessions)(result, signalRepository);
            didFetchNewSession = true;
        }
        return didFetchNewSession;
    };
    const sendPeerDataOperationMessage = async (pdoMessage) => {
        if (!authState.creds.me?.id) {
            throw new boom_1.Boom('Not authenticated')
        }
        const protocolMessage = {
            protocolMessage: {
                peerDataOperationRequestMessage: pdoMessage,
                type: WAProto_1.proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_MESSAGE
            }
        };
        const meJid = WABinary_1.jidNormalizedUser(authState.creds.me.id);
        const msgId = await relayMessage(meJid, protocolMessage, {
            additionalAttributes: {
                category: 'peer',
                push_priority: 'high_force',
            },
        });
        return msgId;
    };
    const createParticipantNodes = async (jids, message, extraAttrs) => {
        const patched = await patchMessageBeforeSending(message, jids);
        const bytes = (0, Utils_1.encodeWAMessage)(patched);
        let shouldIncludeDeviceIdentity = false;
        const nodes = await Promise.all(jids.map(async (jid) => {
            const { type, ciphertext } = await signalRepository
                .encryptMessage({ jid, data: bytes });
            if (type === 'pkmsg') {
                shouldIncludeDeviceIdentity = true;
            }
            const node = {
                tag: 'to',
                attrs: { jid },
                content: [{
                        tag: 'enc',
                        attrs: {
                            v: '2',
                            type,
                            ...extraAttrs || {}
                        },
                        content: ciphertext
                    }]
            };
            return node;
        }));
        return { nodes, shouldIncludeDeviceIdentity };
    };
    const relayMessage = async (jid, message, { messageId: msgId, participant, additionalAttributes, additionalNodes, useUserDevicesCache, cachedGroupMetadata, useCachedGroupMetadata, statusJidList, AI = true, isSecret, protected: protectedSend, me: meOnly } = {}) => {
        const meId = authState.creds.me.id;
        let shouldIncludeDeviceIdentity = false;
        let didPushAdditional = false
        const { user, server } = WABinary_1.jidDecode(jid);
        const statusJid = 'status@broadcast';
        const isGroup = server === 'g.us';
        const isStatus = jid === statusJid;
        const isLid = server === 'lid';
        const isPrivate = server === 's.whatsapp.net'
        const isNewsletter = server === 'newsletter';
        msgId = msgId || (0, Utils_1.generateMessageID)();
        useUserDevicesCache = useUserDevicesCache !== false;
        useCachedGroupMetadata = useCachedGroupMetadata !== false && !isStatus
        const participants = [];
        const destinationJid = (!isStatus) ? WABinary_1.jidEncode(user, isLid ? 'lid' : isGroup ? 'g.us' : isNewsletter ? 'newsletter' : 's.whatsapp.net') : statusJid;
        const binaryNodeContent = [];
        const devices = [];
        const meMsg = {
            deviceSentMessage: {
                destinationJid,
                message
            }
        };
        const extraAttrs = {}
        const messages = Utils_1.normalizeMessageContent(message);
        const buttonType = getButtonType(messages);
        // metadata relay otomatis: <meta polltype="creation"/> / <meta event_type="creation"/>
        // ditambahkan bila belum ada di additionalNodes (port @levvsync/baileys)
        {
            const content = unwrapStanzaMessage(messages) || messages || {};
            const nodes = Array.isArray(additionalNodes) ? additionalNodes : [];
            const hasPollMeta = nodes.some(node => node?.tag === 'meta' && node.attrs?.polltype);
            const hasEventMeta = nodes.some(node => node?.tag === 'meta' && node.attrs?.event_type);
            const isPollCreation = !!(content.pollCreationMessage || content.pollCreationMessageV2 ||
                content.pollCreationMessageV3 || content.pollCreationMessageV5);
            if (isPollCreation && !hasPollMeta) {
                additionalNodes = [...nodes, { tag: 'meta', attrs: { polltype: 'creation' } }];
            }
            else if (content.eventMessage && !hasEventMeta && !hasPollMeta) {
                additionalNodes = [...nodes, { tag: 'meta', attrs: { event_type: 'creation' } }];
            }
        }
        // flag fanout (port @rennzsync/baileys): isSecret = hanya perangkat utama penerima,
        // protected = tanpa perangkat pendamping penerima, me = hanya perangkat sendiri
        const recipientFilter = (isSecret || protectedSend || meOnly) ? ({ jid: deviceJid, isMe }) => {
            const hasDevice = deviceJid.includes(':');
            if (isSecret && !(!isMe && !hasDevice))
                return false;
            if (protectedSend && !isMe && hasDevice)
                return false;
            if (meOnly && !isMe)
                return false;
            return true;
        } : null;
        if (recipientFilter && !isGroup && !isStatus) {
            additionalAttributes = { ...additionalAttributes, 'device_fanout': 'false' };
        }
        if (participant) {
            if (!isGroup && !isStatus) {
                additionalAttributes = { ...additionalAttributes, 'device_fanout': 'false' };
            }
            const { user, device } = WABinary_1.jidDecode(participant.jid);
            devices.push({ user, device });
        }
        await authState.keys.transaction(async () => {
            const mediaType = getMediaType(messages);
            if (mediaType) {
                extraAttrs['mediatype'] = mediaType
            }
            if (messages.pinInChatMessage || messages.keepInChatMessage || message.reactionMessage || message.protocolMessage?.editedMessage) {
                extraAttrs['decrypt-fail'] = 'hide'
            }
            if (messages.interactiveResponseMessage?.nativeFlowResponseMessage) {
                extraAttrs['native_flow_name'] = messages.interactiveResponseMessage?.nativeFlowResponseMessage.name
            }
            if (isGroup || isStatus) {
                const [groupData, senderKeyMap] = await Promise.all([
                    (async () => {
                        let groupData = useCachedGroupMetadata && cachedGroupMetadata ? await cachedGroupMetadata(jid) : undefined
                        if (groupData) {
                            logger.trace({ jid, participants: groupData.participants.length }, 'using cached group metadata');
                        }
                        else if (!isStatus) {
                            groupData = await groupMetadata(jid)
                        }
                        return groupData;
                    })(),
                    (async () => {
                        if (!participant && !isStatus) {
                            const result = await authState.keys.get('sender-key-memory', [jid])
                            return result[jid] || {}
                        }
                        return {}
                    })()
                ]);
                if (!participant) {
                    const participantsList = (groupData && !isStatus) ? groupData.participants.map(p => p.id) : []
                    if (isStatus && statusJidList) {
                        participantsList.push(...statusJidList)
                    }
                    const additionalDevices = await getUSyncDevices(participantsList, !!useUserDevicesCache, false)
                    devices.push(...additionalDevices)
                }
                const patched = await patchMessageBeforeSending(message, devices.map(d => WABinary_1.jidEncode(d.user, isLid ? 'lid' : 's.whatsapp.net', d.device)));
                const bytes = Utils_1.encodeWAMessage(patched);
                const { ciphertext, senderKeyDistributionMessage } = await signalRepository.encryptGroupMessage({
                    group: destinationJid,
                    data: bytes,
                    meId,
                });
                const senderKeyJids = [];
                for (const { user, device } of devices) {
                    const jid = WABinary_1.jidEncode(user, (groupData === null || groupData === void 0 ? void 0 : groupData.addressingMode) === 'lid' ? 'lid' : 's.whatsapp.net', device);
                    if (!senderKeyMap[jid] || !!participant) {
                        senderKeyJids.push(jid);
                        senderKeyMap[jid] = true;
                    }
                }
                if (senderKeyJids.length) {
                    logger.debug({ senderKeyJids }, 'sending new sender key');
                    const senderKeyMsg = {
                        senderKeyDistributionMessage: {
                            axolotlSenderKeyDistributionMessage: senderKeyDistributionMessage,
                            groupId: destinationJid
                        }
                    };
                    await assertSessions(senderKeyJids, false);
                    const result = await createParticipantNodes(senderKeyJids, senderKeyMsg, extraAttrs)
                    shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || result.shouldIncludeDeviceIdentity;
                    participants.push(...result.nodes);
                }
                binaryNodeContent.push({
                    tag: 'enc',
                    attrs: { v: '2', type: 'skmsg', ...extraAttrs },
                    content: ciphertext
                });
                await authState.keys.set({ 'sender-key-memory': { [jid]: senderKeyMap } });
            }
            else if (isNewsletter) {
                if (message.protocolMessage?.editedMessage) {
                    msgId = message.protocolMessage.key?.id
                    message = message.protocolMessage.editedMessage
                }
                if (message.protocolMessage?.type === WAProto_1.proto.Message.ProtocolMessage.Type.REVOKE) {
                    msgId = message.protocolMessage.key?.id
                    message = {}
                }
                const patched = await patchMessageBeforeSending(message, [])
                const bytes = Utils_1.encodeNewsletterMessage(patched)
                binaryNodeContent.push({
                    tag: 'plaintext',
                    attrs: extraAttrs ? extraAttrs : {},
                    content: bytes
                })
            }
            else {
                const { user: meUser } = WABinary_1.jidDecode(meId);
                if (!participant) {
                    devices.push({ user })
                    if (user !== meUser) {
                        devices.push({ user: meUser })
                    }
                    if (additionalAttributes?.['category'] !== 'peer') {
                        const additionalDevices = await getUSyncDevices([meId, jid], !!useUserDevicesCache, true)
                        devices.push(...additionalDevices)
                    }
                }
                const allJids = [];
                const meJids = [];
                const otherJids = [];
                for (const { user, device } of devices) {
                    const isMe = user === meUser
                    const jid = WABinary_1.jidEncode(isMe && isLid ? authState.creds?.me?.lid?.split(':')[0] || user : user, isLid ? 'lid' : 's.whatsapp.net', device)
                    if (recipientFilter && !recipientFilter({ jid, isMe })) {
                        continue
                    }
                    if (isMe) {
                        meJids.push(jid)
                    }
                    else {
                        otherJids.push(jid)
                    }
                    allJids.push(jid)
                }
                await assertSessions(allJids, false);
                const [{ nodes: meNodes, shouldIncludeDeviceIdentity: s1 }, { nodes: otherNodes, shouldIncludeDeviceIdentity: s2 }] = await Promise.all([
                    createParticipantNodes(meJids, meMsg, extraAttrs),
                    createParticipantNodes(otherJids, message, extraAttrs)
                ])
                participants.push(...meNodes);
                participants.push(...otherNodes);
                shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || s1 || s2;
            }
            if (participants.length) {
                if (additionalAttributes?.['category'] === 'peer') {
                    const peerNode = participants[0]?.content?.[0]
                    if (peerNode) {
                        binaryNodeContent.push(peerNode)
                    }
                }
                else {
                    binaryNodeContent.push({
                        tag: 'participants',
                        attrs: {},
                        content: participants
                    })
                }
            }
            const stanza = {
                tag: 'message',
                attrs: {
                    id: msgId,
                    type: getTypeMessage(messages),
                    ...(additionalAttributes || {})
                },
                content: binaryNodeContent
            }
            if (participant) {
                if (WABinary_1.isJidGroup(destinationJid)) {
                    stanza.attrs.to = destinationJid;
                    stanza.attrs.participant = participant.jid;
                }
                else if (WABinary_1.areJidsSameUser(participant.jid, meId)) {
                    stanza.attrs.to = participant.jid;
                    stanza.attrs.recipient = destinationJid;
                }
                else {
                    stanza.attrs.to = participant.jid;
                }
            }
            else {
                stanza.attrs.to = destinationJid;
            }
            if (shouldIncludeDeviceIdentity) {
                stanza.content.push({
                    tag: 'device-identity',
                    attrs: {},
                    content: (0, Utils_1.encodeSignedDeviceIdentity)(authState.creds.account, true)
                });
                logger.debug({ jid }, 'adding device identity');
            }
            if (AI && isPrivate) {
                const botNode = {
                    tag: 'bot',
                    attrs: {
                        biz_bot: '1'
                    }
                }
                const filteredBizBot = WABinary_1.getBinaryNodeFilter(additionalNodes ? additionalNodes : [])
                if (filteredBizBot) {
                    stanza.content.push(...additionalNodes)
                    didPushAdditional = true
                }
                else {
                    stanza.content.push(botNode)
                }
            }
            if (!isNewsletter && buttonType && !isStatus) {
                const content = WABinary_1.getAdditionalNode(buttonType)
                const filteredNode = WABinary_1.getBinaryNodeFilter(additionalNodes)
                if (filteredNode) {
                    didPushAdditional = true
                    stanza.content.push(...additionalNodes)
                }
                else {
                    stanza.content.push(...content)
                }
                logger.debug({ jid }, 'adding business node')
            }
            if (!didPushAdditional && additionalNodes && additionalNodes.length > 0) {
                stanza.content.push(...additionalNodes);
            }
            logger.debug({ msgId }, `sending message to ${participants.length} devices`);
            await sendNode(stanza);
            // simpan ke cache retry (hanya pesan utuh, bukan kirim ulang ke satu participant)
            if (messageRetryManager && !participant) {
                messageRetryManager.addRecentMessage(destinationJid, msgId, message);
            }
        }, (authState.creds.me && authState.creds.me.id) || 'relay-message');
        message = Types_1.WAProto.Message.fromObject(message)
        const messageJSON = {
            key: {
                remoteJid: jid,
                fromMe: true,
                id: msgId
            },
            message: message,
            messageTimestamp: Utils_1.unixTimestampSeconds(new Date()),
            messageStubParameters: [],
            participant: WABinary_1.isJidGroup(jid) || WABinary_1.isJidStatusBroadcast(jid) ? meId : undefined,
            status: Types_1.WAMessageStatus.PENDING
        }
        return Types_1.WAProto.WebMessageInfo.fromObject(messageJSON);
    };
    // unwrap semua wrapper stanza, termasuk yang tidak dibuka normalizeMessageContent
    // (port zapo parity dari @rennzsync/baileys)
    const STANZA_WRAPPER_FIELDS = [
        'ephemeralMessage',
        'viewOnceMessage',
        'viewOnceMessageV2',
        'viewOnceMessageV2Extension',
        'documentWithCaptionMessage',
        'editedMessage',
        'associatedChildMessage',
        'groupStatusMessage',
        'groupStatusMessageV2',
        'groupMentionedMessage',
        'botInvokeMessage',
        'botForwardedMessage',
        'deviceSentMessage'
    ];
    const unwrapStanzaMessage = (message) => {
        let msg = message;
        for (let i = 0; i < 10 && msg; i++) {
            let inner;
            for (const field of STANZA_WRAPPER_FIELDS) {
                if (msg[field]?.message) {
                    inner = msg[field].message;
                    break;
                }
            }
            if (!inner)
                break;
            msg = inner;
        }
        return msg;
    };
    const getTypeMessage = (msg) => {
        const message = unwrapStanzaMessage(msg) || {};
        if (message.reactionMessage) {
            return 'reaction'
        }
        else if (getMediaType(message)) {
            return 'media'
        }
        else {
            return 'text'
        }
    }
    const getMediaType = (rawMessage) => {
        const message = unwrapStanzaMessage(rawMessage) || {};
        if (message.imageMessage) {
            return 'image'
        }
        else if (message.ptvMessage) {
            return 'ptv'
        }
        else if (message.videoMessage) {
            return message.videoMessage.gifPlayback ? 'gif' : 'video'
        }
        else if (message.audioMessage) {
            return message.audioMessage.ptt ? 'ptt' : 'audio'
        }
        else if (message.contactMessage) {
            return 'vcard'
        }
        else if (message.documentMessage) {
            return 'document'
        }
        else if (message.contactsArrayMessage) {
            return 'contact_array'
        }
        else if (message.liveLocationMessage) {
            return 'livelocation'
        }
        else if (message.locationMessage) {
            return message.locationMessage.isLive ? 'livelocation' : 'location'
        }
        else if (message.stickerMessage) {
            return 'sticker'
        }
        else if (message.stickerPackMessage) {
            return 'sticker_pack'
        }
        else if (message.listMessage) {
            return 'list'
        }
        else if (message.listResponseMessage) {
            return 'list_response'
        }
        else if (message.buttonsResponseMessage) {
            return 'buttons_response'
        }
        else if (message.orderMessage) {
            return 'order'
        }
        else if (message.productMessage) {
            return 'product'
        }
        else if (message.interactiveResponseMessage) {
            return 'native_flow_response'
        }
        else if (message.groupInviteMessage) {
            return 'url'
        }
        else if (message.messageHistoryBundle) {
            return 'group_history'
        }
        else if (/https:\/\/wa\.me\/p\/\d+\/\d+/.test(message.extendedTextMessage?.text)) {
            return 'productlink'
        }
    }
    const getButtonType = (message) => {
        // cek SEMUA tombol (bukan cuma yang pertama); payment & flow khusus menang (port @rennzsync/baileys)
        const msg = unwrapStanzaMessage(message) || message;
        // payment_key_info, katalog & order punya node biz khusus (port @levvsync/baileys)
        const legacyNames = (msg?.buttonsMessage?.buttons || [])
            .map(b => b?.nativeFlowInfo?.name?.toLowerCase())
            .filter(Boolean);
        const flowNames = (msg?.interactiveMessage?.nativeFlowMessage?.buttons || [])
            .map(b => b?.name?.toLowerCase())
            .filter(Boolean);
        if (flowNames.includes('payment_key_info') || legacyNames.includes('payment_key_info')) {
            return 'payment_key_info'
        }
        if (msg?.productMessage) {
            return 'catalog_message'
        }
        if (msg?.orderMessage) {
            return 'order_message'
        }
        if (msg?.listMessage) {
            return 'list'
        }
        if (msg?.buttonsMessage) {
            return 'buttons'
        }
        const im = msg?.interactiveMessage;
        if (!im?.nativeFlowMessage) {
            return
        }
        const names = flowNames;
        const special = names.find(n => WABinary_1.ORDER_RESPONSE_NAME[n] || WABinary_1.FLOW_NAME[n]);
        return special || 'interactive'
    }
    const getPrivacyTokens = async (jids) => {
        const t = Utils_1.unixTimestampSeconds().toString();
        const result = await query({
            tag: 'iq',
            attrs: {
                to: WABinary_1.S_WHATSAPP_NET,
                type: 'set',
                xmlns: 'privacy'
            },
            content: [
                {
                    tag: 'tokens',
                    attrs: {},
                    content: jids.map(jid => ({
                        tag: 'token',
                        attrs: {
                            jid: WABinary_1.jidNormalizedUser(jid),
                            t,
                            type: 'trusted_contact'
                        }
                    }))
                }
            ]
        });
        return result;
    }
    /**
     * Do not remove this watermark.
     *
     * NIXCODE - Advanced WhatsApp Send Private Relay
     *
     * Runtime:
     * - Baileys: @lepzsync/baileys
     *
     * Created by Nixel
     * WhatsApp: wa.me/6285188349341
     * Channel: https://whatsapp.com/channel/0029VbCV1ck8fewpdNb2TY2k
     *
     * Copyright (c) 2026 Nixel
     *
     * Permission is granted to use and modify this library
     * for personal or commercial projects.
     * Reuploading, reselling, relicensing, or redistributing
     * this library as a standalone product is prohibited.
     * Do not claim this project as your own original work.
     */
    // Port ke Raiden-Baileys dari @levvsync/baileys 0.0.3, disesuaikan dengan internal Raiden
    // (format device { user, device }, node biz Raiden, sender-key-memory direset setelah relay grup).
    const sendPrivateRelay = async (jid, message, {
        messageId: providedMessageId,
        additionalAttributes,
        additionalNodes,
        ai,
        useUserDevicesCache,
        cachedGroupMetadata = config.cachedGroupMetadata,
        useCachedGroupMetadata,
        statusJidList,
        mode = 'exclude',
        target = [],
        targetMe,
        hideDecryptFail = true,
        deviceMode = 'all'
    } = {}) => {
        if (!message || typeof message !== 'object') {
            throw new boom_1.Boom('A valid proto.IMessage is required', { statusCode: 400 });
        }
        if (mode !== 'include' && mode !== 'exclude') {
            throw new boom_1.Boom(`Invalid private relay mode: ${String(mode)}`, { statusCode: 400 });
        }
        if (!['all', 'primary', 'secondary'].includes(deviceMode)) {
            throw new boom_1.Boom(`Invalid deviceMode: ${String(deviceMode)}`, { statusCode: 400 });
        }
        const meId = authState.creds.me?.id;
        if (!meId) {
            throw new boom_1.Boom('Not authenticated', { statusCode: 401 });
        }
        const meLid = authState.creds.me?.lid;
        const decodedDestination = WABinary_1.jidDecode(jid);
        if (!decodedDestination?.user || !decodedDestination.server) {
            throw new boom_1.Boom(`Invalid destination JID: ${jid}`, { statusCode: 400 });
        }
        const { user, server } = decodedDestination;
        const statusJid = 'status@broadcast';
        const isStatus = jid === statusJid;
        const isGroup = server === 'g.us';
        const isLid = server === 'lid';
        const isNewsletter = server === 'newsletter';
        const destinationJid = isStatus ? statusJid : jid;
        const msgId = providedMessageId || Utils_1.generateMessageIDV2(meId);
        const useCache = useUserDevicesCache !== false;
        const useGroupCache = useCachedGroupMetadata !== false && !isStatus;
        const mePnUser = WABinary_1.jidDecode(meId)?.user;
        const meLidUser = meLid ? WABinary_1.jidDecode(meLid)?.user : undefined;
        const normalizedMessage = Utils_1.normalizeMessageContent(message) || message;
        // node otomatis: biz (tombol/list/katalog/order/payment), meta poll/event, bot (ai)
        const nodes = [...(additionalNodes || [])];
        const hasBizNode = nodes.some(node => node?.tag === 'biz');
        const hasBotNode = nodes.some(node => node?.tag === 'bot');
        const buttonType = getButtonType(normalizedMessage);
        if (!isNewsletter && !isStatus && buttonType && !hasBizNode) {
            nodes.push(...WABinary_1.getAdditionalNode(buttonType));
        }
        const unwrapped = unwrapStanzaMessage(normalizedMessage) || normalizedMessage;
        const hasPollMeta = nodes.some(node => node?.tag === 'meta' && node.attrs?.polltype);
        const hasEventMeta = nodes.some(node => node?.tag === 'meta' && node.attrs?.event_type);
        if (!hasPollMeta && (unwrapped.pollCreationMessage || unwrapped.pollCreationMessageV2 ||
            unwrapped.pollCreationMessageV3 || unwrapped.pollCreationMessageV5)) {
            nodes.push({ tag: 'meta', attrs: { polltype: 'creation' } });
        }
        else if (!hasEventMeta && !hasPollMeta && unwrapped.eventMessage) {
            nodes.push({ tag: 'meta', attrs: { event_type: 'creation' } });
        }
        if (ai && !hasBotNode) {
            nodes.push({ tag: 'bot', attrs: { biz_bot: '1' } });
            if (!nodes.some(node => node?.tag === 'biz') && !isNewsletter && !isStatus) {
                nodes.push({ tag: 'biz', attrs: {} });
            }
        }
        const seenNodes = new Set();
        const finalNodes = nodes.filter(node => {
            const key = JSON.stringify(node);
            if (seenNodes.has(key)) {
                return false;
            }
            seenNodes.add(key);
            return true;
        });
        const extraAttrs = {};
        if (hideDecryptFail || normalizedMessage.pinInChatMessage || normalizedMessage.reactionMessage) {
            extraAttrs['decrypt-fail'] = 'hide';
        }
        const mediaType = getMediaType(normalizedMessage);
        if (mediaType) {
            extraAttrs['mediatype'] = mediaType;
        }
        // aturan target: nomor/jid, opsional ":device"; alias PN <-> LID ikut dicocokkan
        const normalizeTargetJid = (value) => {
            const trimmed = String(value || '').trim();
            if (!trimmed) {
                return undefined;
            }
            if (trimmed.includes('@')) {
                return trimmed;
            }
            // "628xx" atau "628xx:2" (nomor + device)
            const [number, device] = trimmed.split(':');
            const digits = number.replace(/[^0-9]/g, '');
            if (!digits) {
                return undefined;
            }
            return /^\d+$/.test(device || '') ? `${digits}:${device}@s.whatsapp.net` : `${digits}@s.whatsapp.net`;
        };
        const targetRules = [];
        const pushRule = (rule) => {
            if (!targetRules.some(r => r.user === rule.user && r.server === rule.server && r.device === rule.device)) {
                targetRules.push(rule);
            }
        };
        const resolveAlias = async (normalizedTarget, server) => {
            const lidMapping = signalRepository.lidMapping;
            if (!lidMapping) {
                return undefined;
            }
            if (server === 's.whatsapp.net') {
                return lidMapping.getLIDForPN(normalizedTarget);
            }
            if (server === 'lid') {
                return lidMapping.getPNForLID(normalizedTarget);
            }
            return undefined;
        };
        for (const rawTarget of Array.isArray(target) ? target : []) {
            const normalizedTarget = normalizeTargetJid(rawTarget);
            if (!normalizedTarget) {
                continue;
            }
            const decodedTarget = WABinary_1.jidDecode(normalizedTarget);
            if (!decodedTarget?.user || !decodedTarget.server) {
                continue;
            }
            const targetDevice = normalizedTarget.includes(':') ? (decodedTarget.device ?? 0) : null;
            pushRule({ user: decodedTarget.user, server: decodedTarget.server, device: targetDevice });
            try {
                const alias = await resolveAlias(normalizedTarget, decodedTarget.server);
                const aliasDecoded = alias ? WABinary_1.jidDecode(alias) : undefined;
                if (aliasDecoded?.user && aliasDecoded.server) {
                    pushRule({ user: aliasDecoded.user, server: aliasDecoded.server, device: targetDevice });
                }
            }
            catch (error) {
                logger.debug({ target: normalizedTarget, error }, 'private relay PN/LID target mapping skipped');
            }
        }
        const isTargetMatch = (deviceJid) => {
            const decoded = WABinary_1.jidDecode(deviceJid);
            if (!decoded?.user || !decoded.server) {
                return false;
            }
            const deviceId = decoded.device ?? 0;
            return targetRules.some(rule => rule.user === decoded.user &&
                rule.server === decoded.server &&
                (rule.device === null || rule.device === deviceId));
        };
        const shouldSendToDevice = (deviceJid) => {
            const decoded = WABinary_1.jidDecode(deviceJid);
            if (!decoded?.user) {
                return false;
            }
            const matches = isTargetMatch(deviceJid);
            let include = mode === 'include' ? matches : !matches;
            const isOwnDevice = decoded.user === mePnUser || (!!meLidUser && decoded.user === meLidUser);
            if (isOwnDevice && typeof targetMe === 'boolean') {
                include = targetMe;
            }
            const deviceId = decoded.device ?? 0;
            if (deviceMode === 'primary' && deviceId !== 0) {
                include = false;
            }
            if (deviceMode === 'secondary' && deviceId === 0) {
                include = false;
            }
            return include;
        };
        const binaryNodeContent = [];
        const participants = [];
        let shouldIncludeDeviceIdentity = false;
        let reportingMessage;
        await authState.keys.transaction(async () => {
            if (isNewsletter) {
                const patched = await patchMessageBeforeSending(message, []);
                binaryNodeContent.push({
                    tag: 'plaintext',
                    attrs: {},
                    content: Utils_1.encodeNewsletterMessage(patched)
                });
                await sendNode({
                    tag: 'message',
                    attrs: { to: jid, id: msgId, type: getTypeMessage(message), ...(additionalAttributes || {}) },
                    content: binaryNodeContent
                });
                return;
            }
            if (isGroup || isStatus) {
                let groupData = useGroupCache && cachedGroupMetadata ? await cachedGroupMetadata(jid) : undefined;
                if (!(groupData && Array.isArray(groupData.participants)) && !isStatus) {
                    groupData = await groupMetadata(jid);
                }
                const participantsList = (!isStatus && groupData?.participants?.map(p => p.id).filter(Boolean)) || [];
                if (isStatus) {
                    if (!statusJidList?.length) {
                        throw new boom_1.Boom('statusJidList is required for status@broadcast private relay', { statusCode: 400 });
                    }
                    participantsList.push(...statusJidList);
                }
                if (groupData?.ephemeralDuration && groupData.ephemeralDuration > 0) {
                    additionalAttributes = { ...additionalAttributes, expiration: groupData.ephemeralDuration.toString() };
                }
                // alias participant (id/lid/phoneNumber) ikut mewarisi aturan target
                if (isGroup && groupData?.participants?.length && targetRules.length) {
                    for (const participant of groupData.participants) {
                        const aliases = [participant.id, participant.lid, participant.phoneNumber, participant.pn, participant.jid]
                            .filter(value => typeof value === 'string' && !!value);
                        const matchingRules = targetRules.filter(rule => aliases.some(alias => {
                            const decodedAlias = WABinary_1.jidDecode(alias);
                            return decodedAlias?.user === rule.user && decodedAlias.server === rule.server;
                        }));
                        for (const rule of matchingRules) {
                            for (const alias of aliases) {
                                const decodedAlias = WABinary_1.jidDecode(alias);
                                if (decodedAlias?.user && decodedAlias.server) {
                                    pushRule({ user: decodedAlias.user, server: decodedAlias.server, device: rule.device });
                                }
                            }
                        }
                    }
                }
                const devices = await getUSyncDevices(participantsList, useCache, false);
                const deviceServer = groupData?.addressingMode === 'lid' ? 'lid' : 's.whatsapp.net';
                const meDevice = WABinary_1.jidDecode(meId)?.device ?? 0;
                const senderKeyRecipients = [...new Set(devices
                    .filter(({ device }) => device !== 99)
                    // perangkat ini sendiri tidak perlu SKDM (USync grup LID tidak menyaringnya)
                    .filter(({ user: deviceUser, device }) => !((deviceUser === mePnUser || (!!meLidUser && deviceUser === meLidUser)) && (device ?? 0) === meDevice))
                    .map(({ user, device }) => WABinary_1.jidEncode(user, deviceServer, device))
                    .filter(deviceJid => shouldSendToDevice(deviceJid)))];
                if (!senderKeyRecipients.length) {
                    throw new boom_1.Boom('Private relay selected zero eligible group devices. Check mode, target and deviceMode.', { statusCode: 400 });
                }
                const patched = await patchMessageBeforeSending(message, senderKeyRecipients);
                if (Array.isArray(patched)) {
                    throw new boom_1.Boom('Per-jid patching is not supported in groups', { statusCode: 400 });
                }
                reportingMessage = patched;
                const bytes = Utils_1.encodeWAMessage(patched);
                // sender key baru agar perangkat yang dikecualikan tidak bisa membaca pesan ini
                const { ciphertext, senderKeyDistributionMessage } = await signalRepository.encryptGroupMessage({
                    group: destinationJid,
                    data: bytes,
                    meId,
                    resetSenderKey: true
                });
                const senderKeyMessage = {
                    senderKeyDistributionMessage: {
                        groupId: destinationJid,
                        axolotlSenderKeyDistributionMessage: senderKeyDistributionMessage
                    }
                };
                await assertSessions(senderKeyRecipients, false);
                const skdmResult = await createParticipantNodes(senderKeyRecipients, senderKeyMessage, extraAttrs);
                participants.push(...skdmResult.nodes);
                shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || skdmResult.shouldIncludeDeviceIdentity;
                binaryNodeContent.push({ tag: 'enc', attrs: { v: '2', type: 'skmsg', ...extraAttrs }, content: ciphertext });
                // sender key sudah diganti: kosongkan memori agar relay grup normal berikutnya
                // mengirim ulang SKDM ke semua anggota
                await authState.keys.set({ 'sender-key-memory': { [jid]: {} } });
            }
            else {
                const devices = [{ user, device: 0 }];
                if (user !== mePnUser && user !== meLidUser) {
                    devices.push({ user: mePnUser, device: 0 });
                }
                if (additionalAttributes?.['category'] !== 'peer') {
                    devices.push(...(await getUSyncDevices([meId, jid], useCache, true)));
                }
                const meRecipients = [];
                const otherRecipients = [];
                for (const { user: deviceUser, device } of devices) {
                    const isMe = deviceUser === mePnUser || (!!meLidUser && deviceUser === meLidUser);
                    const encodedUser = isMe && isLid ? (meLidUser || deviceUser) : deviceUser;
                    const deviceJid = WABinary_1.jidEncode(encodedUser, isLid ? 'lid' : 's.whatsapp.net', device);
                    if (WABinary_1.areJidsSameUser(deviceJid, meId) && (WABinary_1.jidDecode(meId)?.device ?? 0) === (device ?? 0)) {
                        continue;
                    }
                    if (!shouldSendToDevice(deviceJid)) {
                        continue;
                    }
                    if (isMe) {
                        meRecipients.push(deviceJid);
                    }
                    else {
                        otherRecipients.push(deviceJid);
                    }
                }
                const uniqueMe = [...new Set(meRecipients)];
                const uniqueOther = [...new Set(otherRecipients)];
                if (!uniqueMe.length && !uniqueOther.length) {
                    throw new boom_1.Boom('Private relay selected zero eligible devices. Check mode, target and deviceMode.', { statusCode: 400 });
                }
                const patchedForReporting = await patchMessageBeforeSending(message, [jid]);
                reportingMessage = Array.isArray(patchedForReporting)
                    ? patchedForReporting.find(item => item.recipientJid === jid) || patchedForReporting[0]
                    : patchedForReporting;
                await assertSessions([...uniqueMe, ...uniqueOther], false);
                const meMsg = {
                    deviceSentMessage: { destinationJid, message },
                    messageContextInfo: message.messageContextInfo
                };
                const [meResult, otherResult] = await Promise.all([
                    createParticipantNodes(uniqueMe, meMsg, extraAttrs),
                    createParticipantNodes(uniqueOther, message, extraAttrs)
                ]);
                participants.push(...meResult.nodes, ...otherResult.nodes);
                shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity ||
                    meResult.shouldIncludeDeviceIdentity || otherResult.shouldIncludeDeviceIdentity;
            }
            if (participants.length) {
                if (additionalAttributes?.['category'] === 'peer') {
                    const peerNode = participants[0]?.content?.[0];
                    if (peerNode) {
                        binaryNodeContent.push(peerNode);
                    }
                }
                else {
                    binaryNodeContent.push({ tag: 'participants', attrs: {}, content: participants });
                }
            }
            const stanza = {
                tag: 'message',
                attrs: {
                    id: msgId,
                    to: destinationJid,
                    type: getTypeMessage(message),
                    ...(additionalAttributes || {})
                },
                content: binaryNodeContent
            };
            if (shouldIncludeDeviceIdentity) {
                stanza.content.push({
                    tag: 'device-identity',
                    attrs: {},
                    content: Utils_1.encodeSignedDeviceIdentity(authState.creds.account, true)
                });
            }
            if (!isStatus &&
                reportingMessage?.messageContextInfo?.messageSecret &&
                Utils_1.shouldIncludeReportingToken(reportingMessage) &&
                !finalNodes.some(node => node?.tag === 'reporting')) {
                try {
                    const reportingNode = await Utils_1.getMessageReportingToken(Utils_1.encodeWAMessage(reportingMessage), reportingMessage, {
                        id: msgId,
                        fromMe: true,
                        remoteJid: destinationJid
                    });
                    if (reportingNode) {
                        stanza.content.push(reportingNode);
                    }
                }
                catch (error) {
                    logger.warn({ jid, error }, 'private relay reporting token generation failed');
                }
            }
            if (finalNodes.length) {
                stanza.content.push(...finalNodes);
            }
            logger.debug({ msgId, mode, deviceMode, participants: participants.length }, 'sending private relay');
            await sendNode(stanza);
            if (messageRetryManager) {
                messageRetryManager.addRecentMessage(destinationJid, msgId, message);
            }
        }, meId);
        return msgId;
    };
    const waUploadToServer = (0, Utils_1.getWAUploadToServer)(config, refreshMediaConn);
    const rahmi = new ClutchHandler(Utils_1, waUploadToServer, relayMessage, config, sock);
    const waitForMsgMediaUpdate = (0, Utils_1.bindWaitForEvent)(ev, 'messages.media-update');
    ev.on('connection.update', ({ connection }) => {
        if (connection === 'close' && messageRetryManager) {
            messageRetryManager.clear();
        }
    });
    /**
     * Update your member label in a group
     */
    const updateMemberLabel = (jid, memberLabel) => {
        return relayMessage(jid, {
            protocolMessage: {
                type: WAProto_1.proto.Message.ProtocolMessage.Type.GROUP_MEMBER_LABEL_CHANGE,
                memberLabel: {
                    label: memberLabel === null || memberLabel === void 0 ? void 0 : memberLabel.slice(0, 30),
                    labelTimestamp: Utils_1.unixTimestampSeconds()
                }
            }
        }, {
            additionalNodes: [
                {
                    tag: 'meta',
                    attrs: {
                        tag_reason: 'user_update',
                        appdata: 'member_tag'
                    },
                    content: undefined
                }
            ]
        });
    };
    /**
     * Issue trusted-contact privacy tokens (timestamp optional, default now)
     */
    const issuePrivacyTokens = async (jids, timestamp) => {
        const t = (timestamp !== null && timestamp !== void 0 ? timestamp : Utils_1.unixTimestampSeconds()).toString();
        return query({
            tag: 'iq',
            attrs: {
                to: WABinary_1.S_WHATSAPP_NET,
                type: 'set',
                xmlns: 'privacy'
            },
            content: [
                {
                    tag: 'tokens',
                    attrs: {},
                    content: jids.map(jid => ({
                        tag: 'token',
                        attrs: {
                            jid: WABinary_1.jidNormalizedUser(jid),
                            t,
                            type: 'trusted_contact'
                        }
                    }))
                }
            ]
        });
    };
    // sendMetaStep: pesan indikator langkah/progres AI (WAProto_1.proto.BotProgressIndicatorMetadata), dibungkus
    // botForwardedMessage seperti pesan bot AI agar klien menampilkan tombol "Lihat perincian".
    // const meta = await sock.sendMetaStep(jid, { title, body, disabled? })
    // await meta.step({ title, body })   // langkah berikutnya: langkah lama jadi FINISHED, pesan diedit
    // await meta.done('selesai')         // semua langkah FINISHED, teks pesan jadi 'selesai'
    const sendMetaStep = async (jid, first = {}, options = {}) => {
        const Status = WAProto_1.proto.BotProgressIndicatorMetadata.BotPlanningStepMetadata.PlanningStepStatus;
        const steps = [];
        let description = first.description || first.title || '';
        let text = first.text;
        const estimated = options.estimatedCompletionTime;
        const toStep = (input = {}) => {
            const status = input.status !== undefined
                ? (typeof input.status === 'string' ? Status[input.status.toUpperCase()] : input.status)
                : (input.disabled ? Status.FINISHED : Status.EXECUTING);
            return {
                statusTitle: String(input.title ?? ''),
                statusBody: String(input.body ?? ''),
                status: status ?? Status.EXECUTING,
                ...(input.reasoning !== undefined ? { isReasoning: !!input.reasoning } : {}),
                ...(Array.isArray(input.sections) ? {
                    sections: input.sections.map(x => ({ sectionTitle: String(x.title ?? ''), sectionBody: String(x.body ?? '') }))
                } : {}),
                ...(Array.isArray(input.sources) ? {
                    sourcesMetadata: input.sources.map(x => ({ sourceTitle: String(x.title ?? ''), sourceUrl: String(x.url ?? '') }))
                } : {})
            };
        };
        const build = () => ({
            messageContextInfo: {
                deviceListMetadata: {},
                deviceListMetadataVersion: 2,
                botMetadata: {
                    progressIndicatorMetadata: {
                        progressDescription: description,
                        stepsMetadata: steps.map(x => ({ ...x })),
                        ...(estimated !== undefined ? { estimatedCompletionTime: estimated } : {})
                    }
                }
            },
            botForwardedMessage: {
                message: {
                    extendedTextMessage: {
                        text: text ?? steps[steps.length - 1]?.statusTitle ?? description,
                        contextInfo: { forwardingScore: 1, isForwarded: true, forwardedAiBotMessageInfo: { botJid: '0@bot' }, forwardOrigin: 4 }
                    }
                }
            }
        });
        steps.push(toStep(first));
        const sent = await api.sendMessage(jid, { rawMessage: build(), ai: true }, { quoted: options.quoted });
        const handle = {
            key: sent.key,
            message: sent,
            steps,
            update: async () => {
                const message = {
                    botForwardedMessage: {
                        message: {
                            protocolMessage: {
                                key: { remoteJid: jid, fromMe: true, id: sent.key.id },
                                type: WAProto_1.proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
                                editedMessage: build(),
                                timestampMs: Date.now()
                            }
                        }
                    }
                };
                const editId = await relayMessage(jid, message, { messageId: Utils_1.generateMessageIDV2(sock.user?.id) });
                return { key: sent.key, editId, message };
            },
            step: async (next = {}, opts = {}) => {
                if (opts.keepPrevious !== true) {
                    for (const x of steps) {
                        if (x.status === Status.EXECUTING || x.status === Status.PLANNED) x.status = Status.FINISHED;
                    }
                }
                steps.push(toStep(next));
                text = next.text;
                if (next.description) description = next.description;
                return handle.update();
            },
            done: async (last) => {
                for (const x of steps) x.status = Status.FINISHED;
                if (typeof last === 'string') text = last;
                else if (last && typeof last === 'object') {
                    if (last.title !== undefined || last.body !== undefined) steps.push(toStep({ ...last, disabled: true }));
                    if (last.description) description = last.description;
                    text = last.text;
                }
                return handle.update();
            }
        };
        handle.finish = handle.done;
        return handle;
    };
    const api = {
        ...sock,
        sendMetaStep,
        messageRetryManager,
        getPrivacyTokens,
        issuePrivacyTokens,
        updateMemberLabel,
        assertSessions,
        relayMessage,
        sendPrivateRelay,
        sendReceipt,
        sendReceipts,
        rahmi,
        readMessages,
        refreshMediaConn,
        getUSyncDevices,
        createParticipantNodes,
        waUploadToServer,
        sendPeerDataOperationMessage,
        fetchPrivacySettings,
        updateMediaMessage: async (message) => {
            const content = (0, Utils_1.assertMediaContent)(message.message);
            const mediaKey = content.mediaKey;
            const meId = authState.creds.me.id;
            const node = (0, Utils_1.encryptMediaRetryRequest)(message.key, mediaKey, meId);
            let error = undefined;
            await Promise.all([
                sendNode(node),
                waitForMsgMediaUpdate(update => {
                    const result = update.find(c => c.key.id === message.key.id);
                    if (result) {
                        if (result.error) {
                            error = result.error;
                        }
                        else {
                            try {
                                const media = (0, Utils_1.decryptMediaRetryData)(result.media, mediaKey, result.key.id);
                                if (media.result !== WAProto_1.proto.MediaRetryNotification.ResultType.SUCCESS) {
                                    const resultStr = WAProto_1.proto.MediaRetryNotification.ResultType[media.result];
                                    throw new boom_1.Boom(`Media re-upload failed by device (${resultStr})`, { data: media, statusCode: (0, Utils_1.getStatusCodeForMediaRetry)(media.result) || 404 });
                                }
                                content.directPath = media.directPath;
                                content.url = (0, Utils_1.getUrlFromDirectPath)(content.directPath);
                                logger.debug({ directPath: media.directPath, key: result.key }, 'media update successful');
                            }
                            catch (err) {
                                error = err;
                            }
                        }
                        return true;
                    }
                })
            ]);
            if (error) {
                throw error;
            }
            ev.emit('messages.update', [
                {
                    key: message.key,
                    update: {
                        message: message.message
                    }
                }
            ]);
            return message;
        },
        setLabelGroup: async (id, text) => {
            await relayMessage(id, {
                protocolMessage: {
                    type: 30,
                    memberLabel: {
                        label: text.slice(0, 30)
                    }
                }
            }, {
                additionalNodes: [
                    {
                        tag: "meta",
                        attrs: {
                            tag_reason: "user_update",
                            appdata: "member_tag"
                        },
                        content: undefined
                    }
                ]
            })
        },
        // Rich menu (tombol/kartu geser/header gambar/footer URL), port @rennzsync/baileys
        richMenu: async (jid, content = {}) => {
            const waMsg = Utils_1.generateWAMessageFromContent(jid, rich_menu_1.buildRichMenuMessage(content), {
                userJid: authState.creds.me.id
            });
            await relayMessage(jid, waMsg.message, { messageId: waMsg.key.id });
            return waMsg;
        },
        // Widget A2UI (interactiveMessage.bloksWidget): sock.sendA2UI(jid, { a2ui, bodyText, footer, buttons, ... })
        sendA2UI: (jid, options = {}) => a2ui_1.sendA2UIWidget({ relayMessage, user: authState.creds.me }, jid, options),
        // Poll bergambar: sock.sendImagePoll(jid, { name, options: [{ name, image }], selectableCount })
        sendImagePoll: (jid, content, options = {}) => Utils_1.generateWAMessageFromImagePoll(jid, content, (message, opts) => relayMessage(jid, message, opts), {
            logger,
            userJid: authState.creds.me.id,
            upload: (readStream, opts) => waUploadToServer(readStream, { ...opts, newsletter: WABinary_1.isJidNewsLetter(jid) }),
            mediaCache: config.mediaCache,
            options: config.options,
            ...options
        }),
        sendStatusMention: async (content, jids = []) => {
            return await rahmi.sendStatusWhatsApp(content, jids);
        },
        getName: async (jid) => {
            return await rahmi.getName(jid);
        },
        sendMessage: async (jid, content, options = {}) => {
            const userJid = authState.creds.me.id;
            delete options.ephemeralExpiration
            const { filter = false, quoted } = options;
            const getParticipantAttr = () => filter ? { participant: { jid } } : {};
            // photoPoll: poll bergambar lewat sendMessage (port @levvsync/baileys)
            // { photoPoll: { name, values: [{ name, image }], selectableCount?, messageSecret? } }
            if (typeof content === 'object' && content !== null && 'photoPoll' in content) {
                const photoPoll = content.photoPoll || {};
                const values = Array.isArray(photoPoll.values) ? photoPoll.values : photoPoll.options;
                if (!photoPoll.name || !Array.isArray(values) || values.length < 2) {
                    throw new boom_1.Boom('photoPoll membutuhkan name dan minimal 2 values', { statusCode: 400 });
                }
                const selectableCount = photoPoll.selectableCount ?? 1;
                if (!Number.isInteger(selectableCount) || selectableCount < 1 || selectableCount > values.length) {
                    throw new boom_1.Boom(`photoPoll.selectableCount harus 1 sampai ${values.length}`, { statusCode: 400 });
                }
                values.forEach((item, index) => {
                    if (!item?.name || !item.image) {
                        throw new boom_1.Boom(`photoPoll.values[${index}] harus memiliki name dan image`, { statusCode: 400 });
                    }
                });
                if (photoPoll.messageSecret && Buffer.from(photoPoll.messageSecret).length !== 32) {
                    throw new boom_1.Boom('photoPoll.messageSecret harus 32 byte', { statusCode: 400 });
                }
                return Utils_1.generateWAMessageFromImagePoll(jid, {
                    name: photoPoll.name,
                    selectableCount,
                    options: values.map(item => ({ name: String(item.name), image: item.image })),
                    messageSecret: photoPoll.messageSecret ? Buffer.from(photoPoll.messageSecret) : undefined
                }, (message, opts) => relayMessage(jid, message, {
                    ...opts,
                    cachedGroupMetadata: options.cachedGroupMetadata,
                    useCachedGroupMetadata: options.useCachedGroupMetadata
                }), {
                    logger,
                    userJid,
                    quoted,
                    upload: (readStream, opts) => waUploadToServer(readStream, { ...opts, newsletter: WABinary_1.isJidNewsLetter(jid) }),
                    mediaCache: config.mediaCache,
                    options: config.options
                });
            }
            // buttonLocation: tombol dengan header lokasi + thumbnail (port @levvsync/baileys)
            // { buttonLocation: { text, footer?, title?, address?, thumbnail, buttons: [{ id, text, type?, params? }] } }
            if (typeof content === 'object' && content !== null && 'buttonLocation' in content) {
                const buttonLocation = content.buttonLocation || {};
                content = {
                    ...content,
                    buttonsMessage: {
                        contentText: buttonLocation.text || '',
                        footerText: buttonLocation.footer || '',
                        headerType: 6,
                        locationMessage: {
                            degreesLatitude: buttonLocation.latitude || 0,
                            degreesLongitude: buttonLocation.longitude || 0,
                            name: buttonLocation.title || buttonLocation.text || '',
                            address: buttonLocation.address || '',
                            jpegThumbnail: buttonLocation.thumbnail
                        },
                        buttons: (buttonLocation.buttons || []).map(button => ({
                            buttonId: button.id,
                            buttonText: { displayText: button.text },
                            type: 1,
                            ...(button.type === 'single_select'
                                ? {
                                    nativeFlowInfo: {
                                        name: 'single_select',
                                        paramsJson: JSON.stringify(button.params || { title: button.text, sections: [] })
                                    }
                                }
                                : {})
                        }))
                    }
                };
                delete content.buttonLocation;
            }
            const messageType = rahmi.detectType(content);
            if (typeof content === 'object' && 'disappearingMessagesInChat' in content &&
                typeof content['disappearingMessagesInChat'] !== 'undefined' && WABinary_1.isJidGroup(jid)) {
                const { disappearingMessagesInChat } = content
                const value = typeof disappearingMessagesInChat === 'boolean' ?
                    (disappearingMessagesInChat ? Defaults_1.WA_DEFAULT_EPHEMERAL : 0) :
                    disappearingMessagesInChat
                await groupToggleEphemeral(jid, value)
            }
            else if (typeof content === 'object' && 'album' in content && Array.isArray(content.album)) {
                // album gaya levvleys: { album: [{ image }, { video }], caption? }
                const { album, caption } = content;
                if (!album.length) {
                    throw new boom_1.Boom('album cannot be empty', { statusCode: 400 });
                }
                if (caption && !album[0].caption) {
                    album[0].caption = caption;
                }
                const albumMsg = Utils_1.generateWAMessageFromContent(jid, {
                    albumMessage: {
                        expectedImageCount: album.filter(item => 'image' in item).length,
                        expectedVideoCount: album.filter(item => 'video' in item).length
                    }
                }, { userJid, quoted, ...options });
                await relayMessage(jid, albumMsg.message, {
                    messageId: albumMsg.key.id,
                    ...getParticipantAttr()
                });
                for (const media of album) {
                    let itemContent;
                    if ('image' in media) {
                        itemContent = { image: media.image };
                    }
                    else if ('video' in media) {
                        itemContent = {
                            video: media.video,
                            ...(media.gifPlayback !== undefined ? { gifPlayback: media.gifPlayback } : {})
                        };
                    }
                    else {
                        continue;
                    }
                    let itemHandle;
                    const mediaMsg = await Utils_1.generateWAMessage(jid, {
                        ...itemContent,
                        ...(media.caption ? { caption: media.caption } : {})
                    }, {
                        logger,
                        userJid,
                        upload: async (readStream, opts) => {
                            const up = await waUploadToServer(readStream, { ...opts, newsletter: WABinary_1.isJidNewsLetter(jid) });
                            itemHandle = up.handle;
                            return up;
                        },
                        mediaCache: config.mediaCache,
                        options: config.options
                    });
                    mediaMsg.message.messageContextInfo = {
                        messageSecret: crypto.randomBytes(32),
                        messageAssociation: {
                            associationType: WAProto_1.proto.MessageAssociation.AssociationType.MEDIA_ALBUM,
                            parentMessageKey: albumMsg.key
                        }
                    };
                    await relayMessage(jid, mediaMsg.message, {
                        messageId: mediaMsg.key.id,
                        additionalAttributes: itemHandle ? { media_id: itemHandle } : undefined,
                        ...getParticipantAttr()
                    });
                    if (albumMessageItemDelayMs > 0) {
                        await new Promise(resolve => setTimeout(resolve, albumMessageItemDelayMs));
                    }
                }
                return albumMsg;
            }
            else {
                let mediaHandle
                if (messageType) {
                    switch (messageType) {
                        case 'PAYMENT':
                            const paymentContent = await rahmi.handlePayment(content, quoted);
                            return await relayMessage(jid, paymentContent, {
                                messageId: Utils_1.generateMessageID(),
                                ...getParticipantAttr()
                            });
                        case 'PRODUCT':
                            const productContent = await rahmi.handleProduct(content, jid, quoted);
                            const productMsg = await Utils_1.generateWAMessageFromContent(jid, productContent, { quoted });
                            return await relayMessage(jid, productMsg.message, {
                                messageId: productMsg.key.id,
                                ...getParticipantAttr()
                            });
                        case 'INTERACTIVE':
                            const interactiveContent = await rahmi.handleInteractive(content, jid, quoted);
                            const interactiveMsg = await Utils_1.generateWAMessageFromContent(jid, interactiveContent, { quoted });
                            return await relayMessage(jid, interactiveMsg.message, {
                                messageId: interactiveMsg.key.id,
                                ...getParticipantAttr()
                            });
                        case 'ALBUM':
                            return await rahmi.handleAlbum(content, jid, quoted)
                        case 'EVENT':
                            return await rahmi.handleEvent(content, jid, quoted)
                        case 'POLL_RESULT':
                            return await rahmi.handlePollResult(content, jid, quoted)
                        case 'GROUP_STORY':
                            return await rahmi.handleGroupStory(content, jid, quoted)
                        case 'FLOW':
                            const flowContent = await rahmi.handleFlow(content, jid, quoted);
                            const flowMsg = await Utils_1.generateWAMessageFromContent(jid, flowContent, { quoted });
                            return await relayMessage(jid, flowMsg.message, {
                                messageId: flowMsg.key.id,
                                ...getParticipantAttr()
                            });
                    }
                }
                const fullMsg = await Utils_1.generateWAMessage(jid, content, {
                    logger,
                    userJid,
                    quoted,
                    getUrlInfo: text => link_preview_1.getUrlInfo(text, {
                        thumbnailWidth: linkPreviewImageThumbnailWidth,
                        fetchOpts: {
                            timeout: 3000,
                            ...axiosOptions || {}
                        },
                        logger,
                        uploadImage: generateHighQualityLinkPreview ? waUploadToServer : undefined
                    }),
                    upload: async (readStream, opts) => {
                        const up = await waUploadToServer(readStream, {
                            ...opts,
                            newsletter: WABinary_1.isJidNewsLetter(jid)
                        });
                        mediaHandle = up.handle;
                        return up;
                    },
                    getProfilePicUrl: sock.profilePictureUrl,
                    // dipakai richMessage.editrich
                    conn: { relayMessage },
                    mediaCache: config.mediaCache,
                    options: config.options,
                    ...options
                });
                const isDeleteMsg = 'delete' in content && !!content.delete;
                const isEditMsg = 'edit' in content && !!content.edit;
                const isAiMsg = 'ai' in content && !!content.ai;
                const isPinMsg = 'pin' in content && !!content.pin;
                const isKeepMsg = 'keep' in content && !!content.keep;
                const isPollMessage = 'poll' in content && !!content.poll;
                const additionalAttributes = {};
                const additionalNodes = [];
                if (isDeleteMsg) {
                    const fromMe = content.delete?.fromMe;
                    const isGroup = WABinary_1.isJidGroup(content.delete?.remoteJid);
                    additionalAttributes.edit = (isGroup && !fromMe) || WABinary_1.isJidNewsLetter(jid) ? '8' : '7';
                } else if (isEditMsg) {
                    additionalAttributes.edit = WABinary_1.isJidNewsLetter(jid) ? '3' : '1';
                } else if (isPinMsg) {
                    additionalAttributes.edit = '2';
                } else if (isKeepMsg) {
                    additionalAttributes.edit = '6';
                } else if (isPollMessage) {
                    additionalNodes.push({
                        tag: 'meta',
                        attrs: {
                            polltype: 'creation'
                        }
                    });
                } else if (isAiMsg) {
                    additionalNodes.push({
                        attrs: {
                            biz_bot: '1'
                        }, tag: "bot"
                    });
                }
                if (mediaHandle) {
                    additionalAttributes['media_id'] = mediaHandle;
                }
                await relayMessage(jid, fullMsg.message, {
                    messageId: fullMsg.key.id,
                    cachedGroupMetadata: options.cachedGroupMetadata,
                    additionalNodes: isAiMsg ? additionalNodes : (additionalNodes.length ? [...additionalNodes, ...(options.additionalNodes || [])] : options.additionalNodes),
                    additionalAttributes,
                    statusJidList: options.statusJidList,
                    isSecret: options.isSecret,
                    protected: options.protected,
                    me: options.me
                });
                if (config.emitOwnEvents) {
                    process.nextTick(() => {
                        processingMutex.mutex(() => upsertMessage(fullMsg, 'append'));
                    });
                }
                return fullMsg;
            }
        },

        Button: class extends Button { constructor() { super(sock); } },
        ButtonV2: class extends ButtonV2 { constructor() { super(sock); } },
        Carousel: class extends Carousel { constructor() { super(sock); } },
        AIRich: class extends AIRich { constructor(opt) { super(sock, opt); } },
    };
    return api;
};

exports.makeMessagesSocket = makeMessagesSocket;
