"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeUSyncSocket = void 0;
const boom_1 = require("@hapi/boom");
const WABinary_1 = require("../WABinary");
const WAUSync_1 = require("../WAUSync");
const socket_1 = require("./socket");
const makeUSyncSocket = (config) => {
    const sock = (0, socket_1.makeSocket)(config);
    const { generateMessageTag, query, } = sock;
    const executeUSyncQuery = async (usyncQuery) => {
        if (usyncQuery.protocols.length === 0) {
            throw new boom_1.Boom('USyncQuery must have at least one protocol');
        }
        // todo: validate users, throw WARNING on no valid users
        // variable below has only validated users
        const validUsers = usyncQuery.users;
        const userNodes = validUsers.map((user) => {
            return {
                tag: 'user',
                attrs: {
                    jid: !user.phone ? user.id : undefined,
                },
                content: usyncQuery.protocols
                    .map((a) => a.getUserElement(user))
                    .filter(a => a !== null)
            };
        });
        const listNode = {
            tag: 'list',
            attrs: {},
            content: userNodes
        };
        const queryNode = {
            tag: 'query',
            attrs: {},
            content: usyncQuery.protocols.map((a) => a.getQueryElement())
        };
        const iq = {
            tag: 'iq',
            attrs: {
                to: WABinary_1.S_WHATSAPP_NET,
                type: 'get',
                xmlns: 'usync',
            },
            content: [
                {
                    tag: 'usync',
                    attrs: {
                        context: usyncQuery.context,
                        mode: usyncQuery.mode,
                        sid: generateMessageTag(),
                        last: 'true',
                        index: '0',
                    },
                    content: [
                        queryNode,
                        listNode
                    ]
                }
            ],
        };
        const result = await query(iq);
        return usyncQuery.parseUSyncQueryResult(result);
    };
    // cadangan PN -> LID lewat USync (dipakai LIDMappingStore bila pemetaan belum ada)
    if (sock.signalRepository && sock.signalRepository.lidMapping) {
        sock.signalRepository.lidMapping.setPnToLIDFunc(async (jids) => {
            const q = new WAUSync_1.USyncQuery().withContactProtocol().withLIDProtocol();
            for (const jid of jids) {
                q.withUser(new WAUSync_1.USyncUser().withPhone(`+${jid.split('@')[0].split(':')[0]}`));
            }
            const res = await executeUSyncQuery(q);
            return ((res && res.list) || []).filter((i) => i.id && i.lid).map((i) => ({ pn: i.id, lid: i.lid }));
        });
    }
    // pemetaan akun sendiri (agar sesi antar-device sendiri konsisten di alamat LID)
    sock.ev.on('connection.update', ({ connection }) => {
        if (connection !== 'open' || !sock.signalRepository || !sock.signalRepository.storeLIDPNMappings) return;
        const me = sock.authState && sock.authState.creds && sock.authState.creds.me;
        if (me && me.id && me.lid) {
            sock.signalRepository.storeLIDPNMappings([{ lid: me.lid, pn: me.id }]).catch(() => { });
        }
    });
    return {
        ...sock,
        executeUSyncQuery,
    };
};
exports.makeUSyncSocket = makeUSyncSocket;
