"use strict";
// Status saluran (newsletter status): diambil dari @levvsync/baileys 0.0.5 (LevviSync, MIT).
// Diadaptasi: upload media selalu lewat jalur newsletter agar handle media didapat; helper pesan modern tidak ikut.
Object.defineProperty(exports, "__esModule", { value: true });
exports.NEWSLETTER_STATUS_WEB_MEDIA_TYPES = exports.NEWSLETTER_STATUS_MEDIA_TYPES = exports.NEWSLETTER_STATUS_CONTENT_TYPES = exports.makeNewsletterStatusFetcher = exports.parseNewsletterStatusesResponse = exports.makeNewsletterStatusUpdatesFetcher = exports.parseNewsletterStatusUpdatesResponse = exports.makeNewsletterStatusRevokeSender = exports.makeNewsletterStatusReactionSender = exports.makeNewsletterStatusSender = exports.buildNewsletterStatusRevokeNode = exports.buildNewsletterStatusReactionNode = exports.buildNewsletterStatusNode = exports.buildNewsletterAdminProfileStatusMessage = exports.waitForNewsletterStatusServerId = exports.parseNewsletterStatusAck = exports.withNewsletterStatusAttribution = exports.toNewsletterServerId = exports.NEWSLETTER_SERVER_ID_MAX = exports.NEWSLETTER_SERVER_ID_MIN = exports.getNewsletterStatusMediaType = void 0;
const index_js_1 = require("../../WAProto");
const generics_js_1 = require("./generics");
const messages_js_1 = require("./messages");
const Message_js_1 = require("../Types/Message");
const index_js_2 = require("../WABinary");
const jid_utils_js_1 = require("../WABinary/jid-utils");
const NEWSLETTER_STATUS_MEDIA_TYPES = new Set(['audio', 'gif', 'image', 'video']);
exports.NEWSLETTER_STATUS_MEDIA_TYPES = NEWSLETTER_STATUS_MEDIA_TYPES;
const NEWSLETTER_STATUS_WEB_MEDIA_TYPES = new Set(['image', 'video']);
exports.NEWSLETTER_STATUS_WEB_MEDIA_TYPES = NEWSLETTER_STATUS_WEB_MEDIA_TYPES;
const NEWSLETTER_STATUS_INTERACTIONS = new Set(['question', 'question_response', 'question_reshare']);
const NEWSLETTER_STATUS_CONTENT_TYPES = new Set(['text', 'media', 'reaction']);
exports.NEWSLETTER_STATUS_CONTENT_TYPES = NEWSLETTER_STATUS_CONTENT_TYPES;
const NEWSLETTER_STATUS_CALLBACK_EVENTS = ['CB:ack', 'CB:status', 'CB:iq', 'CB:notification', 'CB:message'];
const NEWSLETTER_STATUS_EDIT_REACTION_REVOKE = '7';
const NEWSLETTER_STATUS_EDIT_ADMIN_REVOKE = '8';
const NEWSLETTER_STATUS_ACK_CLASS = 'status';
const NEWSLETTER_STATUS_ACK_TIMEOUT_MS = 20000;
const NEWSLETTER_STATUS_SERVER_ID_TIMEOUT_MS = 8000;
const getNewsletterStatusMediaType = message => {
    const content = (0, messages_js_1.normalizeMessageContent)(message);
    if (content?.imageMessage)
        return 'image';
    if (content?.videoMessage)
        return content.videoMessage.gifPlayback ? 'gif' : 'video';
    if (content?.audioMessage)
        return 'audio';
    return undefined;
};
exports.getNewsletterStatusMediaType = getNewsletterStatusMediaType;
const assertNewsletterJid = jid => {
    if (!(0, jid_utils_js_1.isJidNewsletter)(jid))
        throw new TypeError('Newsletter status target must be a @newsletter JID');
};
const assertInteraction = interactionType => {
    if (interactionType !== undefined && !NEWSLETTER_STATUS_INTERACTIONS.has(interactionType)) {
        throw new TypeError(`Unsupported newsletter status interaction: ${interactionType}`);
    }
};
const assertMediaType = mediaType => {
    if (mediaType !== undefined && !NEWSLETTER_STATUS_MEDIA_TYPES.has(mediaType)) {
        throw new TypeError(`Unsupported newsletter status media type: ${mediaType}`);
    }
};
const isPresent = value => value !== undefined && value !== null && value !== '';
exports.NEWSLETTER_SERVER_ID_MIN = 99;
exports.NEWSLETTER_SERVER_ID_MAX = 2147476647;
const toNewsletterServerId = (value, label) => {
    const parsed = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isInteger(parsed) || parsed < exports.NEWSLETTER_SERVER_ID_MIN || parsed > exports.NEWSLETTER_SERVER_ID_MAX) {
        throw new TypeError(`${JSON.stringify(value)} is not a newsletter server id${label ? ` for ${label}` : ''}; the server accepts ${exports.NEWSLETTER_SERVER_ID_MIN}..${exports.NEWSLETTER_SERVER_ID_MAX}, and you get one from newsletterFetchMessages or a sent status`);
    }
    return String(parsed);
};
exports.toNewsletterServerId = toNewsletterServerId;
const toServerId = (value, label) => (0, exports.toNewsletterServerId)(value, label);
const buildMetaNode = ({ interactionType, parentServerId, responseServerId, aiContent }) => {
    assertInteraction(interactionType);
    const attrs = {};
    if (interactionType) {
        attrs.interaction_type = interactionType;
        if (interactionType === 'question_reshare') {
            if (!isPresent(parentServerId))
                throw new TypeError('question_reshare requires parentServerId');
            if (!isPresent(responseServerId))
                throw new TypeError('question_reshare requires responseServerId');
            attrs.parent_server_id = toServerId(parentServerId, 'parentServerId');
            attrs.response_server_id = String(responseServerId);
        }
        else if (interactionType === 'question_response' && isPresent(responseServerId)) {
            attrs.response_server_id = String(responseServerId);
        }
    }
    if (!interactionType && !aiContent)
        return undefined;
    return {
        tag: 'meta',
        attrs,
        content: aiContent ? [{ tag: 'ai_content', attrs: {}, content: undefined }] : undefined
    };
};
const withNewsletterStatusAttribution = content => ({
    ...content,
    contextInfo: {
        statusAttributions: [{ type: index_js_1.proto.StatusAttribution.Type.NEWSLETTER_STATUS }],
        featureEligibilities: { canBeReshared: true },
        ...(content?.contextInfo || {})
    }
});
exports.withNewsletterStatusAttribution = withNewsletterStatusAttribution;
const snapshotCallbackNode = (event, node) => ({
    event,
    tag: node?.tag,
    attrs: node?.attrs || {},
    children: Array.isArray(node?.content)
        ? node.content.map(child => ({ tag: child?.tag, attrs: child?.attrs || {} }))
        : []
});
const collectStatusCallbacks = sock => {
    const frames = [];
    const listeners = [];
    for (const event of NEWSLETTER_STATUS_CALLBACK_EVENTS) {
        const listener = node => {
            if (frames.length >= 40)
                return;
            frames.push(snapshotCallbackNode(event, node));
        };
        sock.ws.on(event, listener);
        listeners.push([event, listener]);
    }
    return {
        frames,
        stop: () => {
            for (const [event, listener] of listeners) {
                sock.ws.off(event, listener);
            }
        }
    };
};
const readIntAttr = (attrs, key) => {
    if (!isPresent(attrs?.[key]))
        return undefined;
    const parsed = Number.parseInt(String(attrs[key]), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
};
const parseNewsletterStatusAck = (node, { jid, messageId } = {}) => {
    if (!node || typeof node !== 'object')
        throw new TypeError('Newsletter status ack node is required');
    if (node.tag !== 'ack') {
        const error = new Error(`Newsletter status expected <ack>, got <${node.tag}>`);
        error.data = node;
        throw error;
    }
    const attrs = node.attrs || {};
    if (attrs.class !== undefined && attrs.class !== NEWSLETTER_STATUS_ACK_CLASS) {
        const error = new Error(`Newsletter status ack has class "${attrs.class}", expected "${NEWSLETTER_STATUS_ACK_CLASS}"`);
        error.data = node;
        throw error;
    }
    if (isPresent(messageId) && isPresent(attrs.id) && attrs.id !== messageId) {
        const error = new Error(`Newsletter status ack id mismatch: ${attrs.id} != ${messageId}`);
        error.data = node;
        throw error;
    }
    if (isPresent(jid) && isPresent(attrs.from) && attrs.from !== jid) {
        const error = new Error(`Newsletter status ack from mismatch: ${attrs.from} != ${jid}`);
        error.data = node;
        throw error;
    }
    return {
        class: attrs.class,
        from: attrs.from,
        id: attrs.id,
        t: readIntAttr(attrs, 't'),
        serverId: readIntAttr(attrs, 'server_id'),
        edit: attrs.edit,
        error: isPresent(attrs.error) ? String(attrs.error) : undefined,
        applicationError: readIntAttr(attrs, 'application_error'),
        backoff: readIntAttr(attrs, 'backoff'),
        node
    };
};
exports.parseNewsletterStatusAck = parseNewsletterStatusAck;
const waitForNewsletterStatusServerId = (sock, { jid, messageId, timeoutMs = 8000 }) => {
    let settle;
    const promise = new Promise(resolve => {
        let done = false;
        const finish = value => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            sock.ws.off('CB:status', onStatus);
            resolve(value);
        };
        const onStatus = node => {
            if (node?.tag !== 'status')
                return;
            const attrs = node.attrs || {};
            if (isPresent(jid) && isPresent(attrs.from) && attrs.from !== jid)
                return;
            if (isPresent(messageId) && isPresent(attrs.id) && attrs.id !== messageId)
                return;
            const serverId = readIntAttr(attrs, 'server_id');
            if (serverId !== undefined)
                finish({ serverId, node });
        };
        const timer = setTimeout(() => finish(undefined), timeoutMs);
        sock.ws.on('CB:status', onStatus);
        settle = finish;
    });
    promise.cancel = () => settle(undefined);
    return promise;
};
exports.waitForNewsletterStatusServerId = waitForNewsletterStatusServerId;
const assertStatusServerResponse = (response, { jid, messageId, callbacks = [] }) => {
    if (!response) {
        const suffix = callbacks.length
            ? `; callbacks=${JSON.stringify(callbacks)}`
            : '; no ack/status/iq/notification/message callback observed';
        const error = new Error(`Newsletter status server ACK timed out for ${messageId}${suffix}`);
        error.data = { messageId, callbacks };
        throw error;
    }
    const ack = (0, exports.parseNewsletterStatusAck)(response, { jid, messageId });
    if (ack.error) {
        const details = [
            ack.applicationError !== undefined ? `application_error=${ack.applicationError}` : undefined,
            ack.backoff !== undefined ? `backoff=${ack.backoff}` : undefined
        ].filter(Boolean).join(', ');
        const hint = ack.error === '403' || ack.error === '401' || ack.error === 'not-authorized' || ack.error === 'forbidden'
            ? '; the channel may be missing the CHANNEL_STATUS_PRODUCER capability, check newsletterCanPostStatus(jid)'
            : '';
        const error = new Error(`Newsletter status rejected by server (${ack.error})${details ? `: ${details}` : ''}${hint}`);
        error.data = ack;
        throw error;
    }
    return ack;
};
const buildNewsletterAdminProfileStatusMessage = message => {
    if (!message || typeof message !== 'object')
        throw new TypeError('Newsletter status message is required');
    return index_js_1.proto.Message.create({
        newsletterAdminProfileStatusMessage: index_js_1.proto.Message.FutureProofMessage.create({
            message
        })
    });
};
exports.buildNewsletterAdminProfileStatusMessage = buildNewsletterAdminProfileStatusMessage;
const resolveStatusPayload = ({ message, payload }) => {
    if (payload !== undefined) {
        if (!(payload instanceof Uint8Array))
            throw new TypeError('Newsletter status payload must be a Uint8Array');
        return payload;
    }
    if (!message || typeof message !== 'object')
        throw new TypeError('Newsletter status message is required');
    return (0, generics_js_1.encodeNewsletterMessage)(message);
};
const buildNewsletterStatusNode = ({ jid, message, payload, messageId, mediaType, mediaId, mediaHandle, parentServerId, responseServerId, interactionType, aiContent }) => {
    assertNewsletterJid(jid);
    if (!messageId)
        throw new TypeError('Newsletter status messageId is required');
    assertMediaType(mediaType);
    assertInteraction(interactionType);
    const handle = isPresent(mediaHandle) ? mediaHandle : mediaId;
    if (isPresent(handle) && !mediaType) {
        throw new TypeError('mediaId requires a media newsletter status');
    }
    if (mediaType && !isPresent(handle)) {
        throw new TypeError('Native newsletter status media requires the media handle returned by the newsletter upload');
    }
    if (interactionType === 'question_reshare' && !mediaType) {
        throw new TypeError('question_reshare requires media');
    }
    if (interactionType === 'question_response') {
        if (mediaType)
            throw new TypeError('question_response is published as a text status');
        if (!isPresent(parentServerId))
            throw new TypeError('question_response requires parentServerId');
    }
    const attrs = {
        to: jid,
        id: messageId,
        type: mediaType ? 'media' : 'text'
    };
    if (mediaType)
        attrs.media_id = String(handle);
    if (interactionType === 'question_response') {
        attrs.server_id = toServerId(parentServerId, 'parentServerId');
    }
    const content = [{
            tag: 'plaintext',
            attrs: mediaType ? { mediatype: mediaType } : {},
            content: resolveStatusPayload({ message, payload })
        }];
    const metaNode = buildMetaNode({ interactionType, parentServerId, responseServerId, aiContent });
    if (metaNode)
        content.push(metaNode);
    return { tag: 'status', attrs, content };
};
exports.buildNewsletterStatusNode = buildNewsletterStatusNode;
const buildNewsletterStatusReactionNode = ({ jid, messageId, parentServerId, reaction }) => {
    assertNewsletterJid(jid);
    if (!messageId)
        throw new TypeError('Newsletter status reaction messageId is required');
    if (!isPresent(parentServerId)) {
        throw new TypeError('Newsletter status reaction requires parentServerId');
    }
    const isRevoke = !isPresent(reaction);
    const attrs = {
        to: jid,
        id: messageId,
        server_id: toServerId(parentServerId, 'parentServerId'),
        type: 'reaction'
    };
    if (isRevoke)
        attrs.edit = NEWSLETTER_STATUS_EDIT_REACTION_REVOKE;
    return {
        tag: 'status',
        attrs,
        content: [{
                tag: 'reaction',
                attrs: isRevoke ? {} : { code: reaction },
                content: undefined
            }]
    };
};
exports.buildNewsletterStatusReactionNode = buildNewsletterStatusReactionNode;
const buildNewsletterStatusRevokeNode = ({ jid, statusId }) => {
    assertNewsletterJid(jid);
    if (!statusId)
        throw new TypeError('Newsletter status revoke requires the status id');
    return {
        tag: 'status',
        attrs: {
            to: jid,
            id: statusId,
            type: 'text',
            edit: NEWSLETTER_STATUS_EDIT_ADMIN_REVOKE
        },
        content: [{ tag: 'plaintext', attrs: {}, content: undefined }]
    };
};
exports.buildNewsletterStatusRevokeNode = buildNewsletterStatusRevokeNode;
const sendStatusNode = async (sock, node, { jid, messageId, timeoutMs }) => {
    const diagnostics = collectStatusCallbacks(sock);
    const responsePromise = sock.waitForMessage(messageId, timeoutMs);
    try {
        await sock.sendNode(node);
        const response = await responsePromise;
        return assertStatusServerResponse(response, { jid, messageId, callbacks: diagnostics.frames });
    }
    finally {
        diagnostics.stop();
    }
};
const makeNewsletterStatusSender = (sock, config) => async (jid, content, options = {}) => {
    assertNewsletterJid(jid);
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
        throw new TypeError('Newsletter status content must be an object');
    }
    const userJid = sock.authState?.creds?.me?.id;
    if (!userJid)
        throw new TypeError('Not authenticated');
    const { mediaId, mediaHandle: requestedMediaHandle, parentServerId, responseServerId, interactionType: requestedInteractionType, aiContent, statusAttribution = true, messageId: requestedMessageId, ackTimeoutMs, resolveServerId, serverIdTimeoutMs, transport, ...messageOptions } = options;
    if (transport !== undefined) {
        config.logger?.warn?.({ transport }, 'newsletter status "transport" option is obsolete, the verified status-publish transport is always used');
    }
    let uploadedMediaHandle;
    // status saluran selalu ke saluran: paksa jalur upload newsletter supaya server mengembalikan handle media
    const upload = async (path, opts = {}) => {
        const result = await sock.waUploadToServer(path, { ...opts, newsletter: true });
        uploadedMediaHandle = result?.handle ?? result?.media_id ?? result?.mediaId ?? result?.fbid ?? uploadedMediaHandle;
        return result;
    };
    const preparedContent = content;
    const fullMsg = await (0, messages_js_1.generateWAMessage)(jid, statusAttribution ? (0, exports.withNewsletterStatusAttribution)(preparedContent) : preparedContent, {
        logger: config.logger,
        userJid,
        upload,
        mediaCache: config.mediaCache,
        options: config.options,
        ...messageOptions,
        messageId: requestedMessageId || (0, generics_js_1.generateMessageIDV2)(userJid)
    });
    const normalized = (0, messages_js_1.normalizeMessageContent)(fullMsg.message);
    const mediaType = (0, exports.getNewsletterStatusMediaType)(fullMsg.message);
    if (!mediaType && (normalized?.documentMessage || normalized?.stickerMessage)) {
        throw new TypeError('Native newsletter status supports text, image, video, gif, and audio');
    }
    if (mediaType && !NEWSLETTER_STATUS_WEB_MEDIA_TYPES.has(mediaType)) {
        config.logger?.warn?.({ mediaType }, 'newsletter status media type is not published by WhatsApp Web itself, the server may reject it');
    }
    const interactionType = requestedInteractionType || (content.question ? 'question' : undefined);
    if (interactionType === 'question' && !mediaType) {
        config.logger?.warn?.('WhatsApp Web only publishes question newsletter statuses on top of media, a text question status may be rejected');
    }
    const node = (0, exports.buildNewsletterStatusNode)({
        jid,
        message: fullMsg.message,
        messageId: fullMsg.key.id,
        mediaType,
        mediaHandle: requestedMediaHandle ?? mediaId ?? uploadedMediaHandle,
        parentServerId,
        responseServerId,
        interactionType,
        aiContent
    });
    const echo = resolveServerId === false
        ? null
        : (0, exports.waitForNewsletterStatusServerId)(sock, {
            jid,
            messageId: fullMsg.key.id,
            timeoutMs: serverIdTimeoutMs ?? NEWSLETTER_STATUS_SERVER_ID_TIMEOUT_MS
        });
    let ack;
    try {
        ack = await sendStatusNode(sock, node, {
            jid,
            messageId: fullMsg.key.id,
            timeoutMs: ackTimeoutMs ?? NEWSLETTER_STATUS_ACK_TIMEOUT_MS
        });
    }
    catch (error) {
        echo?.cancel();
        throw error;
    }
    const delivered = echo ? await echo : undefined;
    fullMsg.status = Message_js_1.WAMessageStatus.SERVER_ACK;
    fullMsg.newsletterStatusServerId = ack.serverId ?? delivered?.serverId;
    fullMsg.newsletterStatusAck = ack;
    fullMsg.newsletterStatusResponse = ack.node;
    if (delivered)
        fullMsg.newsletterStatusDelivered = delivered.node;
    return fullMsg;
};
exports.makeNewsletterStatusSender = makeNewsletterStatusSender;
const makeNewsletterStatusReactionSender = sock => async (jid, parentServerId, reaction, options = {}) => {
    assertNewsletterJid(jid);
    const userJid = sock.authState?.creds?.me?.id;
    if (!userJid)
        throw new TypeError('Not authenticated');
    const messageId = options.messageId || (0, generics_js_1.generateMessageIDV2)(userJid);
    const node = (0, exports.buildNewsletterStatusReactionNode)({ jid, messageId, parentServerId, reaction });
    const ack = await sendStatusNode(sock, node, {
        jid,
        messageId,
        timeoutMs: options.ackTimeoutMs ?? NEWSLETTER_STATUS_ACK_TIMEOUT_MS
    });
    return {
        key: {
            remoteJid: jid,
            fromMe: true,
            id: messageId
        },
        status: Message_js_1.WAMessageStatus.SERVER_ACK,
        newsletterStatusServerId: ack.serverId,
        newsletterStatusAck: ack,
        newsletterStatusResponse: ack.node
    };
};
exports.makeNewsletterStatusReactionSender = makeNewsletterStatusReactionSender;
const makeNewsletterStatusRevokeSender = sock => async (jid, statusId, options = {}) => {
    assertNewsletterJid(jid);
    const userJid = sock.authState?.creds?.me?.id;
    if (!userJid)
        throw new TypeError('Not authenticated');
    const node = (0, exports.buildNewsletterStatusRevokeNode)({ jid, statusId });
    const ack = await sendStatusNode(sock, node, {
        jid,
        messageId: statusId,
        timeoutMs: options.ackTimeoutMs ?? NEWSLETTER_STATUS_ACK_TIMEOUT_MS
    });
    return {
        key: {
            remoteJid: jid,
            fromMe: true,
            id: statusId
        },
        status: Message_js_1.WAMessageStatus.SERVER_ACK,
        newsletterStatusAck: ack,
        newsletterStatusResponse: ack.node
    };
};
exports.makeNewsletterStatusRevokeSender = makeNewsletterStatusRevokeSender;
const decodeStatusPayload = plaintext => {
    const bytes = plaintext?.content;
    if (!bytes || Array.isArray(bytes))
        return undefined;
    return index_js_1.proto.Message.decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
};
const parseStatusAdminProfile = meta => {
    const adminProfile = meta && (0, index_js_2.getBinaryNodeChild)(meta, 'admin_profile');
    if (!adminProfile)
        return undefined;
    const name = (0, index_js_2.getBinaryNodeChild)(adminProfile, 'name');
    const picture = (0, index_js_2.getBinaryNodeChild)(adminProfile, 'picture');
    const content = name?.content;
    return {
        id: adminProfile.attrs?.id,
        name: typeof content === 'string'
            ? content
            : content instanceof Uint8Array
                ? Buffer.from(content).toString('utf-8')
                : undefined,
        pictureId: picture?.attrs?.id,
        pictureDirectPath: picture?.attrs?.direct_path
    };
};
const parseStatusNode = status => {
    const plaintext = (0, index_js_2.getBinaryNodeChild)(status, 'plaintext');
    const reaction = (0, index_js_2.getBinaryNodeChild)(status, 'reaction');
    const meta = (0, index_js_2.getBinaryNodeChild)(status, 'meta');
    const reactions = (0, index_js_2.getBinaryNodeChild)(status, 'reactions');
    const viewsCount = (0, index_js_2.getBinaryNodeChild)(status, 'views_count');
    const responsesCount = (0, index_js_2.getBinaryNodeChild)(status, 'responses_count');
    return {
        id: status.attrs?.id,
        serverId: readIntAttr(status.attrs, 'server_id'),
        t: readIntAttr(status.attrs, 't'),
        isSender: status.attrs?.is_sender === 'true',
        type: status.attrs?.type,
        edit: status.attrs?.edit,
        mediaType: plaintext?.attrs?.mediatype,
        interactionType: meta?.attrs?.interaction_type,
        reaction: reaction ? reaction.attrs?.code ?? '' : undefined,
        adminProfile: parseStatusAdminProfile(meta),
        paidPartnership: meta ? !!(0, index_js_2.getBinaryNodeChild)(meta, 'paid_partnership') : false,
        aiContent: meta ? !!(0, index_js_2.getBinaryNodeChild)(meta, 'ai_content') : false,
        editTimestamp: readIntAttr(meta?.attrs, 'msg_edit_t'),
        originalTimestamp: readIntAttr(meta?.attrs, 'original_msg_t'),
        reactionCounts: reactions
            ? (0, index_js_2.getBinaryNodeChildren)(reactions, 'reaction').map(entry => ({
                code: entry.attrs?.code,
                count: readIntAttr(entry.attrs, 'count')
            }))
            : undefined,
        viewsCount: readIntAttr(viewsCount?.attrs, 'count'),
        responsesCount: readIntAttr(responsesCount?.attrs, 'count'),
        message: decodeStatusPayload(plaintext),
        node: status
    };
};
const parseNewsletterStatusUpdatesResponse = node => {
    const updates = (0, index_js_2.getBinaryNodeChild)(node, 'status_updates');
    if (!updates) {
        const children = Array.isArray(node?.content) ? node.content.map(child => child?.tag) : [];
        const error = new Error(`Newsletter status updates response has no <status_updates> child, got [${children.join(', ')}]`);
        error.data = node;
        throw error;
    }
    return (0, exports.parseNewsletterStatusesResponse)(updates);
};
exports.parseNewsletterStatusUpdatesResponse = parseNewsletterStatusUpdatesResponse;
const makeNewsletterStatusUpdatesFetcher = sock => async (jid, options = {}) => {
    assertNewsletterJid(jid);
    const { count = 20, since, before, after } = options;
    const attrs = { count: String(count) };
    if (isPresent(since))
        attrs.since = String(since);
    if (isPresent(before))
        attrs.before = toServerId(before, 'before');
    else if (isPresent(after))
        attrs.after = toServerId(after, 'after');
    const result = await sock.query({
        tag: 'iq',
        attrs: {
            to: jid,
            xmlns: 'newsletter',
            type: 'get'
        },
        content: [{ tag: 'status_updates', attrs, content: undefined }]
    });
    return (0, exports.parseNewsletterStatusUpdatesResponse)(result);
};
exports.makeNewsletterStatusUpdatesFetcher = makeNewsletterStatusUpdatesFetcher;
const parseNewsletterStatusesResponse = node => {
    const statuses = (0, index_js_2.getBinaryNodeChild)(node, 'statuses');
    if (!statuses) {
        const children = Array.isArray(node?.content) ? node.content.map(child => child?.tag) : [];
        const error = new Error(`Newsletter statuses response has no <statuses> child, got [${children.join(', ')}]`);
        error.data = node;
        throw error;
    }
    return {
        jid: statuses.attrs?.jid,
        t: readIntAttr(statuses.attrs, 't'),
        statuses: (0, index_js_2.getBinaryNodeChildren)(statuses, 'status').map(parseStatusNode)
    };
};
exports.parseNewsletterStatusesResponse = parseNewsletterStatusesResponse;
const makeNewsletterStatusFetcher = sock => async (jid, options = {}) => {
    assertNewsletterJid(jid);
    const { count = 20, before, after, viewRole } = options;
    const attrs = { type: 'jid', jid };
    if (isPresent(viewRole))
        attrs.view_role = String(viewRole).toLowerCase();
    attrs.count = String(count);
    if (isPresent(before))
        attrs.before = toServerId(before, 'before');
    else if (isPresent(after))
        attrs.after = toServerId(after, 'after');
    const result = await sock.query({
        tag: 'iq',
        attrs: {
            to: index_js_2.S_WHATSAPP_NET,
            xmlns: 'newsletter',
            type: 'get'
        },
        content: [{ tag: 'statuses', attrs, content: undefined }]
    });
    return (0, exports.parseNewsletterStatusesResponse)(result);
};
exports.makeNewsletterStatusFetcher = makeNewsletterStatusFetcher;
