"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { assertNodeErrorFree } = require('../../WABinary');
const { USyncUser } = require('../USyncUser');
class USyncUsernameProtocol {
    constructor() {
        this.name = 'username';
    }
    getQueryElement() {
        return {
            tag: 'username',
            attrs: {}
        };
    }
    getUserElement(user) {
        void user;
        return null;
    }
    parser(node) {
        if (node.tag === 'username') {
            assertNodeErrorFree(node);
            return typeof node.content === 'string' ? node.content : null;
        }
        return null;
    }
}

exports.USyncUsernameProtocol = USyncUsernameProtocol;

