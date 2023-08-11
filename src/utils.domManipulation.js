import {moveCleanedNodesToContainerElement} from './utils';
import {emptyDomNode} from './utils.domNodes';
import {unwrapObservable} from './subscribables/observableUtils';

const TABLE = [1, '<table>', '</table>'];
const TBODY = [2, '<table><tbody>', '</tbody></table>'];
const TR = [3, '<table><tbody><tr>', '</tr></tbody></table>'];
const SELECT = [1, '<select multiple="multiple">', '</select>'];
const WRAP_BY_TAG_NAME = {
    thead: TABLE, THEAD: TABLE,
    tbody: TABLE, TBODY: TABLE,
    tfoot: TABLE, TFOOT: TABLE,
    tr: TBODY, TR: TBODY, 
    td: TR, TD: TR,
    th: TR, TH: TR,
    option: SELECT, OPTION: SELECT,
    optgroup: SELECT, OPTGROUP: SELECT
};

// TODO try replacing regex call w/ "scan for first tagName function
const TAGS_REGEX = /^(?:<!--.*?-->\s*?)*<([a-zA-Z]+)[\s>]/;

/**
 * A DIV element used for parsing HTML fragments exclusively for the own document (which should cover 99% of cases). 
 * @type {?HTMLDivElement} 
 */
let _reusedDiv;

export const parseHtmlFragment = (html, doc = document) => {
    let container = (doc === document) ? (_reusedDiv || (_reusedDiv = doc.createElement('div'))) : doc.createElement('div'),
        wrap = TAGS_REGEX.test(html.trim()) && WRAP_BY_TAG_NAME[RegExp.$1];
    
    if (wrap) {
        container.innerHTML = '<div>' + wrap[1] + html + wrap[2] + '</div>';
        for (let depth = wrap[0]; depth >= 0; --depth) {
            container = container.lastChild;
        }
    } else {
        container.innerHTML = '<div>' + html + '</div>';
        container = container.lastChild;
    }

    // Tried spread -> return [...div.lastChild.childNodes];
    // But rest operator is slow; for-loop filling nodes array is 60% faster in FF81, 80% faster in Chrome (TODO: re-check in the future)
    let nodesArray = [];
    for (let i = 0, nodeList = container.childNodes, len = nodeList.length; i < len; i++) {
        nodesArray[i] = nodeList[i];
    }

    container.remove(); // make sure to cut ties with the reused div
    
    return nodesArray;
};

export const parseHtmlForTemplateNodes = (html, documentContext) => {
    let nodes = parseHtmlFragment(html, documentContext);
    return (nodes.length && nodes[0].parentElement) || moveCleanedNodesToContainerElement(nodes);
};

export const setHtml = (node, html) => {
    emptyDomNode(node);

    // There's no legitimate reason to display a stringified observable without unwrapping it, so we'll unwrap it
    html = unwrapObservable(html);

    let htmlType = html === null ? 'undefined' : typeof html;

    if (htmlType !== 'undefined') {
        if (htmlType !== 'string') {
            html = html.toString();
        }
        for (let parsedNode of parseHtmlFragment(html, node.ownerDocument)) {
            node.appendChild(parsedNode);
        }
    }
};
