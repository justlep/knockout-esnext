import {moveCleanedNodesToContainerElement} from './utils';
import {emptyDomNode} from './utils.domNodes';
import {unwrapObservable} from './subscribables/observableUtils';

const NONE = [0, '', ''],
    TABLE = [1, '<table>', '</table>'],
    TBODY = [2, '<table><tbody>', '</tbody></table>'],
    TR = [3, '<table><tbody><tr>', '</tr></tbody></table>'],
    SELECT = [1, '<select multiple="multiple">', '</select>'],
    LOOKUP = {
        thead: TABLE, THEAD: TABLE,
        tbody: TABLE, TBODY: TABLE,
        tfoot: TABLE, TFOOT: TABLE,
        tr: TBODY, TR: TBODY, 
        td: TR, TD: TR,
        th: TR, TH: TR,
        option: SELECT, OPTION: SELECT,
        optgroup: SELECT, OPTGROUP: SELECT
    },
    TAGS_REGEX = /^(?:<!--.*?-->\s*?)*?<([a-zA-Z]+)[\s>]/;

export const parseHtmlFragment = (html, documentContext) => {
    if (!documentContext) {
        documentContext = document;
    }
    let windowContext = documentContext.parentWindow || documentContext.defaultView || window;

    // Based on jQuery's "clean" function, but only accounting for table-related elements.
    // If you have referenced jQuery, this won't be used anyway - KO will use jQuery's "clean" function directly

    // Note that there's still an issue in IE < 9 whereby it will discard comment nodes that are the first child of
    // a descendant node. For example: "<div><!-- mycomment -->abc</div>" will get parsed as "<div>abc</div>"
    // This won't affect anyone who has referenced jQuery, and there's always the workaround of inserting a dummy node
    // (possibly a text node) in front of the comment. So, KO does not attempt to workaround this IE issue automatically at present.

    // Trim whitespace, otherwise indexOf won't work as expected
    let div = documentContext.createElement('div'),
        wrap = (TAGS_REGEX.test((html || '').trim()) && LOOKUP[RegExp.$1]) || NONE,
        depth = wrap[0];

    // Go to html and back, then peel off extra wrappers
    // Note that we always prefix with some dummy text, because otherwise, IE<9 will strip out leading comment nodes in descendants. Total madness.
    let markup = 'ignored<div>' + wrap[1] + html + wrap[2] + '</div>';
    if (typeof windowContext['innerShiv'] === 'function') {
        // Note that innerShiv is deprecated in favour of html5shiv. We should consider adding
        // support for html5shiv (except if no explicit support is needed, e.g., if html5shiv
        // somehow shims the native APIs so it just works anyway)
        div.appendChild(windowContext['innerShiv'](markup));
    } else {
        div.innerHTML = markup;
    }

    // Move to the right depth
    while (depth--) {
        div = div.lastChild;
    }

    // return [...div.lastChild.childNodes];
    // Rest operator is slow (manual creation of nodes array is 60% faster in FF81, 80% faster in Chrome; re-check in the future)
    let nodesArray = [];
    for (let i = 0, nodeList = div.lastChild.childNodes, len = nodeList.length; i < len; i++) {
        nodesArray[i] = nodeList[i];
    }
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
