"use strict";
/**
 * Helper untuk richMessage (AI rich response), di-port dari levvleys 2.1.0.
 * Dipakai oleh generateWAMessageContent di ./messages.js.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const { randomUUID } = require("crypto");

function extractIE(text, { extract = true, hyperlink = true, citation = true, latex = true } = {}) {
    if (!extract) return { text, ie: [], inline_entities: [] };
    const createIE = (type, ie) => {
        if (type === 'hyperlink') return {
            key: ie.key,
            metadata: {
                display_name: ie.text,
                is_trusted: ie.is_trusted,
                url: ie.url,
                __typename: 'GenAIInlineLinkItem',
            },
        };
        if (type === 'citation') return {
            key: ie.key,
            metadata: {
                reference_id: ie.reference_id,
                reference_url: ie.url,
                reference_title: ie.url,
                reference_display_name: ie.url,
                sources: [],
                __typename: 'GenAISearchCitationItem',
            },
        };
        if (type === 'latex') return {
            key: ie.key,
            metadata: {
                latex_expression: ie.text,
                latex_image: { url: ie.url, width: Number(ie.width) || 100, height: Number(ie.height) || 100 },
                font_height: Number(ie.font_height) || 83.333333333333,
                padding: Number(ie.padding) || 15,
                __typename: 'GenAILatexItem',
            },
        };
    };
    let ie = [], inline_entities = [], result = '', last = 0,
        citation_index = 1, hyperlink_index = 0, latex_index = 0, stack = [];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '[' && text[i - 1] !== '\\') {
            stack.push(i);
        } else if (text[i] === ']' && (text[i + 1] === '(' || text[i + 1] === '<')) {
            let start = stack.pop();
            if (start == null) continue;
            let open = text[i + 1], close = open === '(' ? ')' : '>',
                type = open === '(' ? 'link' : 'latex', end = i + 2, depth = 1;
            while (end < text.length && depth) {
                if (text[end] === open && text[end - 1] !== '\\') depth++;
                else if (text[end] === close && text[end - 1] !== '\\') depth--;
                end++;
            }
            if (depth) continue;
            let raw = text.slice(start + 1, i).trim(), url = text.slice(i + 2, end - 1).trim(), key, tag, data;
            if (type === 'latex') {
                if (!latex) continue;
                let [txt = '', width = null, height = null, font_height = null, padding = null] = raw.split('|');
                key = `RAIDEN_LATEX_${latex_index++}`;
                tag = `{{${key}}}${txt || 'image'}{{/${key}}}`;
                data = { type: 'latex', ie: { key, text: txt, url, width, height, font_height, padding } };
            } else if (raw) {
                if (!hyperlink) continue;
                const trusted = !url.startsWith('!');
                if (!trusted) url = url.slice(1);
                key = `RAIDEN_HYPERLINK_${hyperlink_index++}`;
                tag = `{{${key}}}${url}{{/${key}}}`;
                data = { type: 'hyperlink', ie: { key, text: raw, url, is_trusted: trusted } };
            } else {
                if (!citation) continue;
                key = `RAIDEN_CITATION_${citation_index - 1}`;
                tag = `{{${key}}}${url}{{/${key}}}`;
                data = { type: 'citation', ie: { reference_id: citation_index++, key, text: '', url } };
            }
            result += text.slice(last, start) + tag;
            last = end;
            ie.push(data);
            const entity = createIE(data.type, data.ie);
            if (entity) inline_entities.push(entity);
            i = end - 1;
        }
    }
    result += text.slice(last);
    return { text: result, ie, inline_entities };
}

async function waitAllPromises(input) {
    const isPromise = (v) => v && typeof v.then === 'function';
    const isObject = (v) => v && typeof v === 'object';
    const deep = async (v) => {
        if (isPromise(v)) return deep(await v);
        if (Array.isArray(v)) return Promise.all(v.map(deep));
        if (isObject(v)) {
            const entries = await Promise.all(Object.entries(v).map(async ([k, val]) => [k, await deep(val)]));
            return Object.fromEntries(entries);
        }
        return v;
    };
    return deep(await input);
}

function tokenizer(code, lang = 'javascript') {
    const keywordsMap = {
        javascript: new Set(['break','case','catch','continue','debugger','delete','do','else','finally','for','function','if','in','instanceof','new','return','switch','this','throw','try','typeof','var','void','while','with','true','false','null','undefined','class','const','let','super','extends','export','import','yield','static','constructor','async','await','get','set']),
        typescript: new Set(['abstract','any','as','asserts','bigint','boolean','declare','enum','implements','infer','interface','is','keyof','module','namespace','never','readonly','require','number','object','override','private','protected','public','satisfies','string','symbol','type','unknown','using','from','break','case','catch','continue','do','else','finally','for','function','if','new','return','switch','this','throw','try','var','void','while','class','const','let','extends','import','export','async','await']),
        python: new Set(['False','None','True','and','as','assert','async','await','break','class','continue','def','del','elif','else','except','finally','for','from','global','if','import','in','is','lambda','nonlocal','not','or','pass','raise','return','try','while','with','yield']),
        java: new Set(['abstract','assert','boolean','break','byte','case','catch','char','class','const','continue','default','do','double','else','enum','extends','final','finally','float','for','goto','if','implements','import','instanceof','int','interface','long','native','new','package','private','protected','public','return','short','static','strictfp','super','switch','synchronized','this','throw','throws','transient','try','void','volatile','while']),
        golang: new Set(['break','case','chan','const','continue','default','defer','else','fallthrough','for','func','go','goto','if','import','interface','map','package','range','return','select','struct','switch','type','var']),
        c: new Set(['auto','break','case','char','const','continue','default','do','double','else','enum','extern','float','for','goto','if','int','long','register','return','short','signed','sizeof','static','struct','switch','typedef','union','unsigned','void','volatile','while']),
        cpp: new Set(['alignas','alignof','and','auto','bool','break','case','catch','class','const','constexpr','continue','delete','do','double','else','enum','explicit','export','extern','false','float','for','friend','if','inline','int','long','mutable','namespace','new','noexcept','nullptr','operator','private','protected','public','return','short','signed','sizeof','static','struct','switch','template','this','throw','true','try','typedef','typename','union','unsigned','using','virtual','void','while']),
        php: new Set(['abstract','and','array','as','break','callable','case','catch','class','clone','const','continue','declare','default','do','echo','else','elseif','empty','enddeclare','endfor','endforeach','endif','endswitch','endwhile','extends','final','finally','fn','for','foreach','function','global','goto','if','implements','include','include_once','instanceof','interface','match','namespace','new','null','or','private','protected','public','require','require_once','return','static','switch','throw','trait','try','use','var','while','yield']),
        rust: new Set(['as','break','const','continue','crate','else','enum','extern','false','fn','for','if','impl','in','let','loop','match','mod','move','mut','pub','ref','return','self','Self','static','struct','super','trait','true','type','unsafe','use','where','while']),
        html: new Set(['html','head','body','div','span','p','a','img','video','audio','script','style','link','meta','form','input','button','table','tr','td','th','ul','ol','li','section','article','header','footer','nav','main']),
        bash: new Set(['if','then','else','elif','fi','for','while','do','done','case','esac','function','in','select','until','break','continue','return','export','readonly','local','declare']),
        markdown: new Set(['#','##','###','####','#####','######']),
    };
    if (!lang || lang === 'txt' || lang === 'text' || lang === 'plaintext') {
        return {
            codeBlock: [{ codeContent: code, highlightType: 0 }],
            unified_codeBlock: [{ content: code, type: 'DEFAULT' }],
        };
    }
    const TYPE_MAP = { 0:'DEFAULT', 1:'KEYWORD', 2:'METHOD', 3:'STR', 4:'NUMBER', 5:'COMMENT' };
    const keywords = keywordsMap[lang.toLowerCase()] || new Set();
    const tokens = [];
    let i = 0;
    const push = (content, type) => {
        if (!content) return;
        const last = tokens[tokens.length - 1];
        if (last && last.highlightType === type) last.codeContent += content;
        else tokens.push({ codeContent: content, highlightType: type });
    };
    const isIdentifier = (char) => {
        switch (lang.toLowerCase()) {
            case 'css': return /[a-zA-Z0-9_$-]/.test(char);
            case 'html': return /[a-zA-Z0-9_$:-]/.test(char);
            default: return /[a-zA-Z0-9_$]/.test(char);
        }
    };
    while (i < code.length) {
        const c = code[i];
        if (/\s/.test(c)) {
            let s = i;
            while (i < code.length && /\s/.test(code[i])) i++;
            push(code.slice(s, i), 0);
            continue;
        }
        if ((c === '/' && code[i + 1] === '/') || (c === '#' && ['python','bash'].includes(lang))) {
            let s = i;
            while (i < code.length && code[i] !== '\n') i++;
            push(code.slice(s, i), 5);
            continue;
        }
        if (c === '"' || c === "'" || c === '`') {
            let s = i;
            const q = c;
            i++;
            while (i < code.length) {
                if (code[i] === '\\' && i + 1 < code.length) i += 2;
                else if (code[i] === q) { i++; break; }
                else i++;
            }
            push(code.slice(s, i), 3);
            continue;
        }
        if (/[0-9]/.test(c)) {
            let s = i;
            while (i < code.length && /[0-9._]/.test(code[i])) i++;
            push(code.slice(s, i), 4);
            continue;
        }
        if (/[a-zA-Z_$]/.test(c)) {
            let s = i;
            while (i < code.length && isIdentifier(code[i])) i++;
            const word = code.slice(s, i);
            let type = 0;
            if (keywords.has(word)) type = 1;
            else if (lang === 'css') {
                let j = i;
                while (j < code.length && /\s/.test(code[j])) j++;
                if (code[j] === ':') type = 1;
            } else if (lang === 'html') {
                let p = s - 1;
                while (p >= 0 && /\s/.test(code[p])) p--;
                if (code[p] === '<' || (code[p] === '/' && code[p-1] === '<')) type = 1;
            }
            if (type === 0) {
                let j = i;
                while (j < code.length && /\s/.test(code[j])) j++;
                if (code[j] === '(') type = 2;
            }
            push(word, type);
            continue;
        }
        push(c, 0);
        i++;
    }
    return {
        codeBlock: tokens,
        unified_codeBlock: tokens.map(t => ({ content: t.codeContent, type: TYPE_MAP[t.highlightType] })),
    };
}

function toTableMetadata(arr, { hyperlink = true, citation = true, latex = true } = {}) {
    if (!Array.isArray(arr) || !arr.every(row => Array.isArray(row) && row.every(cell => typeof cell === 'string'))) {
        throw new TypeError('Table must be a nested array of strings');
    }
    const [header, ...rows] = arr;
    const maxLen = Math.max(header.length, ...rows.map(r => r.length));
    const normalize = (r) => [...r, ...Array(maxLen - r.length).fill('')];
    const unified_rows = [
        { is_header: true, cells: normalize(header) },
        ...rows.map(r => ({ is_header: false, cells: normalize(r) })),
    ].map(row => {
        const markdown_cells = row.cells.map(cell => {
            const extracted = extractIE(cell, { hyperlink, citation, latex });
            return { text: extracted.text, ...(extracted.inline_entities.length ? { inline_entities: extracted.inline_entities } : {}) };
        });
        return { ...row, ...(markdown_cells.some(c => c.inline_entities?.length) ? { markdown_cells } : {}) };
    });
    const rowsMeta = unified_rows.map(r => ({
        items: r.cells,
        ...(r.is_header ? { isHeading: true } : {}),
    }));
    return { title: '', rows: rowsMeta, unified_rows };
}

function newLayout(name, data, extra = {}) {
    return {
        ...extra,
        view_model: {
            [Array.isArray(data) ? 'primitives' : 'primitive']: data,
            __typename: `GenAI${name}LayoutViewModel`,
        },
    };
}


const normalizeRichInlineEntities = (items) => {
    if (!Array.isArray(items)) return [];
    return items.map(item => {
        if (item?.metadata && item?.key) return item;
        if (item?.latex) {
            const l = item.latex;
            return {
                key: item.key || `RAIDEN_LATEX_${randomUUID()}`,
                metadata: {
                    latex_expression: l.expression || l.latex_expression || '',
                    latex_image: {
                        url: l.url || l.image_url || '',
                        width: Number(l.width) || 100,
                        height: Number(l.height) || 100
                    },
                    font_height: Number(l.font_height) || 83.333,
                    padding: Number(l.padding) || 15,
                    __typename: 'GenAILatexItem'
                }
            };
        }
        return item;
    }).filter(Boolean);
};

const normalizeRichImageV2 = (input) => {
    const image = typeof input === 'string' ? { url: input } : (input || {});
    const url = image.url || image.image_url;
    if (!url) throw new TypeError('richMessage.imgv2 must contain url');
    return {
        url,
        preview: image.preview_url || image.preview_image_url || image.full_image_url || url,
        full: image.full_url || image.high_res_url || image.full_image_url || url,
        mime: image.mime_type || image.mimeType || 'image/jpeg',
        width: image.width,
        height: image.height
    };
};

const makeRichHScrollPrimitive = (card) => ({
    __typename: 'GenAI3PExtWidgetPrimitive',
    header: {
        __typename: 'GenAI3PExtWidgetStandardHeader',
        title: card?.title || ''
    },
    body: {
        __typename: card?.body_typename || 'GenAI3PExtCalendarEventList',
        sections: Array.isArray(card?.sections) ? card.sections : [],
        ctas: (card?.buttons || card?.ctas || []).map(cta => ({
            label: cta?.label || cta?.cta_text || '',
            state: cta?.state || 'PENDING',
            kind: cta?.kind || 'OTHER',
            tool_call_id: cta?.tool_call_id || randomUUID(),
            ...(cta?.toast || cta?.toast_label ? {
                toast: {
                    label: cta.toast?.label || cta.toast_label || '',
                    __typename: 'GenAI3PExtWidgetToast'
                }
            } : {}),
            __typename: 'GenAI3PExtWidgetCTA'
        }))
    }
});

const makeRichFooterPrimitive = (action) => {
    if (action?.text !== undefined) {
        return {
            text: String(action.text),
            ...(action.inline_entities ? {
                inline_entities: normalizeRichInlineEntities(action.inline_entities)
            } : {}),
            __typename: 'GenAIMarkdownTextUXPrimitive'
        };
    }
    return {
        cta_text: action?.cta_text || action?.label || '',
        cta_type: action?.cta_type || 'OPEN_URL',
        cta_url: action?.cta_url || action?.url || '',
        ...(action?.cta_color || action?.color ? {
            cta_color: action.cta_color || action.color
        } : {}),
        __typename: 'GenAIFooterActionPrimitive'
    };
};


exports.extractIE = extractIE;
exports.waitAllPromises = waitAllPromises;
exports.tokenizer = tokenizer;
exports.toTableMetadata = toTableMetadata;
exports.newLayout = newLayout;
exports.normalizeRichInlineEntities = normalizeRichInlineEntities;
exports.normalizeRichImageV2 = normalizeRichImageV2;
exports.makeRichHScrollPrimitive = makeRichHScrollPrimitive;
exports.makeRichFooterPrimitive = makeRichFooterPrimitive;
