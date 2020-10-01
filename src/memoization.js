
/** @type {Map<string, function>} */
const _memoMap = new Map();

const MEMO_ID_PREFIX = Math.random() + '_';
const MEMO_TEXT_START = '[ko_memo:'; // length 9 (= magic number used inside `parseMemoText`)

export const parseMemoText = (memoText) => memoText.startsWith(MEMO_TEXT_START) ? memoText.substr(9, memoText.length - 10) : null; //@inline

let _nextMemoId = 1;

// exported for knockout-internal performance optimizations only
export let _hasMemoizedCallbacks = false;

export const memoize = (callback) => {
    if (typeof callback !== "function") {
        throw new Error("You can only pass a function to ko.memoization.memoize()");
    }
    let memoId = MEMO_ID_PREFIX + (_nextMemoId++);
    _memoMap.set(memoId, callback);
    _hasMemoizedCallbacks = true;
    return '<!--' + MEMO_TEXT_START + memoId + ']-->';
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
        _hasMemoizedCallbacks = !!_memoMap.size;
    }
};

export const unmemoizeDomNodeAndDescendants = (domNode, extraCallbackParamsArray) => {
    if (!_hasMemoizedCallbacks || !domNode) {
        return;
    }
    let memos = [];

    // (1) find memo comments in sub-tree
    for (let node = domNode, nextNodes = []; node; node = nextNodes && nextNodes.shift()) {
        let nodeType = node.nodeType;
        if (nodeType === 8) {
            let nodeValue = node.nodeValue, // local nodeValue looks redundant but will reduce size of inlined `parseMemoText` call
                memoId = parseMemoText(nodeValue);
            if (memoId) {
                memos.push({node, memoId});
            }
        } else if (nodeType === 1) {
            let childNodes = node.childNodes;
            if (childNodes.length) {
                if (nextNodes.length) {
                    nextNodes.unshift(...childNodes);
                } else {
                    nextNodes = [...childNodes];
                }
            }
        }
    }
    
    // (2) unmemoize & run memoized callbacks
    for (let memo of memos) {
        let node = memo.node,
            combinedParams = extraCallbackParamsArray ? [node, ...extraCallbackParamsArray] : [node];
        
        unmemoize(memo.memoId, combinedParams);
        node.nodeValue = ''; // Neuter this node so we don't try to unmemoize it again
        node.remove(); // If possible, erase it totally (not always possible - someone else might just hold a reference to it then call unmemoizeDomNodeAndDescendants again)
    }
};
