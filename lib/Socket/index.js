"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Defaults_1 = require("../Defaults");
const communities_1 = require("./communities");
const anchor_guard_1 = require("../Utils/anchor-guard");
// export the last socket layer
const makeWASocket = (config) => {
    // AnchorGuard (port @rennzsync/baileys): makeWASocket({ AnchorGuard: true, AnchorGuardConfig: {...} })
    const { AnchorGuard, AnchorGuardConfig, ...rest } = config || {};
    const sock = (0, communities_1.makeCommunitiesSocket)({
        ...Defaults_1.DEFAULT_CONNECTION_CONFIG,
        ...rest
    });
    if (AnchorGuard) {
        sock.anchorGuard = (0, anchor_guard_1.createAnchorGuard)(sock, AnchorGuardConfig || {});
    }
    return sock;
};
exports.default = makeWASocket;
exports.makeWASocket = makeWASocket;
