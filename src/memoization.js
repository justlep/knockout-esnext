
/** 
 * @type {Map<string, function>}
 * @internal
 */
export const _memoMap = new Map();

const MEMO_TEXT_START = '[!KoMemo:'; // length 9 (= magic number used inside `parseMemoText`)
const MEMO_ID_PREFIX = Date.now().toString(36) + '_';

export const parseMemoText = (memoText) => memoText.startsWith(MEMO_TEXT_START) ? memoText.substring(9) : null; //@inline

let _nextMemoId = 1;

export const memoize = (callback) => {
    if (typeof callback !== "function") {
        throw new Error("You can only pass a function to ko.memoization.memoize()");
    }
    let memoId = MEMO_ID_PREFIX + (_nextMemoId++);
    _memoMap.set(memoId, callback);
    return '<!--' + MEMO_TEXT_START + memoId + '-->';
};

export const unmemoize = (memoId, callbackParams) => {
    let callback = _memoMap.get(memoId);
    if (!callback) {
        throw new Error("Couldn't find any memo with ID " + memoId + ". Perhaps it's already been unmemoized.");
    }
    try {
        callbackParams ? callback(...callbackParams) : callback();
        return true;
    } finally {
        _memoMap.delete(memoId);
    }
};

export const unmemoizeDomNodeAndDescendants = (domNode, extraCallbackParamsArray) => {
    if (!_memoMap.size || !domNode) {
        return;
    }
    let nodeAndMemoIdObjs = [];

    // (1) find memo comments in sub-tree
    for (let node = domNode, nextNodes = [], memoId, memoText, nodeType; node; node = nextNodes.length && nextNodes.shift()) {
        if ((nodeType = node.nodeType) === 8) {
            // (!) additional memoText assignment to allow inlining of parseMemoText() call
            if ((memoText = node.nodeValue) && (memoId = parseMemoText(memoText))) {
                nodeAndMemoIdObjs.push({node, memoId});
            }
        } else if (nodeType === 1 && node.hasChildNodes()) {
            if (nextNodes.length) {
                nextNodes.unshift(...node.childNodes);
            } else {
                nextNodes = [...node.childNodes];
            }
        }
    }
    
    // (2) unmemoize & run memoized callbacks
    for (let o of nodeAndMemoIdObjs) {
        let node = o.node;
        unmemoize(o.memoId, extraCallbackParamsArray ? [node, ...extraCallbackParamsArray] : [node]);
        node.nodeValue = ''; // Neuter this node so we don't try to unmemoize it again
        node.remove(); // If possible, erase it totally (not always possible - someone else might just hold a reference to it then call unmemoizeDomNodeAndDescendants again)
    }
};
