/// <reference types="node" />
import type { EventEmitter } from "events";
import { proto } from "../WAProto";

export { proto };
export * from "../WAProto";

export type AnyObject = { [key: string]: any };

export type AuthenticationCreds = AnyObject;
export type SignalKeyStore = AnyObject;
export interface AuthenticationState {
    creds: AuthenticationCreds;
    keys: SignalKeyStore;
}

export type WAMessage = proto.IWebMessageInfo;
export type WAMessageKey = proto.IMessageKey;
export type AnyMessageContent = AnyObject;
export type MiscMessageGenerationOptions = AnyObject;
export type SocketConfig = AnyObject;

export interface WASocket {
    ev: {
        on(event: string, listener: (...args: any[]) => void): void;
        off(event: string, listener: (...args: any[]) => void): void;
        removeAllListeners(event: string): void;
        process(handler: (events: AnyObject) => void | Promise<void>): () => void;
    } & Partial<EventEmitter>;
    ws: any;
    user?: { id: string; lid?: string; name?: string };
    authState: AuthenticationState;
    sendMessage(jid: string, content: AnyMessageContent, options?: MiscMessageGenerationOptions): Promise<proto.WebMessageInfo | undefined>;
    relayMessage(jid: string, message: proto.IMessage, options?: AnyObject): Promise<string>;
    readMessages(keys: proto.IMessageKey[]): Promise<void>;
    sendPresenceUpdate(type: string, toJid?: string): Promise<void>;
    updateMediaMessage(message: proto.IWebMessageInfo): Promise<proto.IWebMessageInfo>;
    logout(msg?: string): Promise<void>;
    end(error?: Error): void;
    // Socket memiliki banyak API lain (grup, newsletter, privacy, kontak, label, dll.)
    [method: string]: any;
}

declare function makeWASocket(config: SocketConfig): WASocket;
export { makeWASocket };
export default makeWASocket;

export const DisconnectReason: { [name: string]: number } & {
    connectionClosed: number;
    connectionLost: number;
    connectionReplaced: number;
    timedOut: number;
    loggedOut: number;
    badSession: number;
    restartRequired: number;
    multideviceMismatch: number;
};
export const WAMessageStubType: { [name: string]: number };
export const Browsers: { [name: string]: (browser?: string) => [string, string, string] } & AnyObject;
export const BufferJSON: { replacer: (k: string, value: any) => any; reviver: (_: string, value: any) => any };
export const S_WHATSAPP_NET: string;

export function useMultiFileAuthState(folder: string): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }>;
export function fetchLatestBaileysVersion(options?: AnyObject): Promise<{ version: [number, number, number]; isLatest: boolean; error?: any }>;
export function makeInMemoryStore(config: AnyObject): AnyObject & { bind(ev: WASocket["ev"]): void };
export function makeCacheableSignalKeyStore(store: SignalKeyStore, logger?: any, cache?: any): SignalKeyStore;
export function initAuthCreds(): AuthenticationCreds;
export function generateMessageID(): string;
export function delay(ms: number): Promise<void>;

export function jidDecode(jid: string | undefined): { user: string; server: string; device?: number; domainType?: number; agent?: number } | undefined;
export function jidEncode(user: string | number | null, server: string, device?: number, agent?: number): string;
export function jidNormalizedUser(jid: string | undefined): string;
export function areJidsSameUser(jid1?: string, jid2?: string): boolean;
export function isJidGroup(jid: string | undefined): boolean | undefined;
export function isJidBroadcast(jid: string | undefined): boolean | undefined;
export function isLidUser(jid: string | undefined): boolean | undefined;
export function isPnUser(jid: string | undefined): boolean | undefined;

export function getContentType(content: proto.IMessage | undefined): string | undefined;
export function normalizeMessageContent(content: proto.IMessage | null | undefined): proto.IMessage | undefined;
export function extractMessageContent(content: proto.IMessage | null | undefined): proto.IMessage | undefined;
export function downloadMediaMessage(message: WAMessage, type: "buffer" | "stream", options?: AnyObject, ctx?: AnyObject): Promise<any>;
export function downloadContentFromMessage(message: AnyObject, type: string, options?: AnyObject): Promise<AsyncIterable<Buffer>>;
export function generateWAMessageFromContent(jid: string, message: proto.IMessage, options?: AnyObject): proto.WebMessageInfo;
export function prepareWAMessageMedia(message: AnyObject, options?: AnyObject): Promise<proto.IMessage>;

// Modul hasil port rc14
export function extractCommunityMetadata(result: AnyObject): AnyObject;
export function executeWMexQuery<T = any>(variables: AnyObject, queryId: string, dataPath: string, query: (node: AnyObject) => Promise<any>, generateMessageTag: () => string): Promise<T>;
export function buildAckStanza(node: AnyObject, errorCode?: number, meId?: string): AnyObject;
export function handleIdentityChange(node: AnyObject, ctx: AnyObject): Promise<{ action: string; [key: string]: any }>;
export function makeOfflineNodeProcessor(nodeProcessorMap: Map<string, (node: any) => Promise<void>>, deps: AnyObject, batchSize?: number): { enqueue(type: string, node: any): void };
export function processContactAction(action: AnyObject, id: string | undefined, logger?: any): { event: string; data: any }[];
export function emitSyncActionResults(ev: { emit(event: string, data: any): any }, results: { event: string; data: any }[]): void;
export class USyncUsernameProtocol {
    name: string;
    getQueryElement(): AnyObject;
    getUserElement(user: AnyObject): null;
    parser(node: AnyObject): string | null;
}
