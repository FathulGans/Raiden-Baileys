"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Defaults_1 = require("../Defaults");
const communities_1 = require("./communities");
const anchor_guard_1 = require("../Utils/anchor-guard");
const newsletter_status_1 = require("../Utils/newsletter-status");
// export the last socket layer
const makeWASocket = (config) => {
    // AnchorGuard (port @rennzsync/baileys): makeWASocket({ AnchorGuard: true, AnchorGuardConfig: {...} })
    const { AnchorGuard, AnchorGuardConfig, ...rest } = config || {};
    const newConfig = {
        ...Defaults_1.DEFAULT_CONNECTION_CONFIG,
        ...rest
    };
    const sock = (0, communities_1.makeCommunitiesSocket)(newConfig);
    // status saluran (dari @levvsync/baileys 0.0.5, LevviSync, MIT)
    sock.sendNewsletterStatus = (0, newsletter_status_1.makeNewsletterStatusSender)(sock, newConfig);
    sock.sendNewsletterStatusReaction = (0, newsletter_status_1.makeNewsletterStatusReactionSender)(sock);
    sock.revokeNewsletterStatus = (0, newsletter_status_1.makeNewsletterStatusRevokeSender)(sock);
    sock.getNewsletterStatuses = (0, newsletter_status_1.makeNewsletterStatusFetcher)(sock);
    sock.getNewsletterStatusUpdates = (0, newsletter_status_1.makeNewsletterStatusUpdatesFetcher)(sock);
    if (AnchorGuard) {
        sock.anchorGuard = (0, anchor_guard_1.createAnchorGuard)(sock, AnchorGuardConfig || {});
    }
    return sock;
};
exports.default = makeWASocket;
exports.makeWASocket = makeWASocket;
