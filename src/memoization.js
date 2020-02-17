import {arrayPushAll} from './utils';

const _memosMap = new Map();

const _randomMax8HexChars = () => (((1 + Math.random()) * 0x100000000) | 0).toString(16).substring(1);

const _generateRandomId = () => _randomMax8HexChars() + _randomMax8HexChars();

const _findMemoNodes = (rootNode, appendToArray) => {
    if (!rootNode) {
        return;
    }
    if (rootNode.nodeType === 8) {
        let memoId = parseMemoText(rootNode.nodeValue);
        if (memoId !== null) {
            appendToArray.push({domNode: rootNode, memoId: memoId});
        }
    } else if (rootNode.nodeType === 1) {
        for (let i = 0, childNodes = rootNode.childNodes, j = childNodes.length; i < j; i++) {
            _findMemoNodes(childNodes[i], appendToArray);
        }
    }
};


export const memoize = (callback) => {
    if (typeof callback !== "function") {
        throw new Error("You can only pass a function to ko.memoization.memoize()");
    }
    let memoId = _generateRandomId();
    _memosMap.set(memoId, callback);
    return "<!--[ko_memo:" + memoId + "]-->";
};

export const unmemoize = (memoId, callbackParams) => {
    let callback = _memosMap.get(memoId);
    if (!callback) {
        throw new Error("Couldn't find any memo with ID " + memoId + ". Perhaps it's already been unmemoized.");
    }
    try {
        callbackParams ? callback(...callbackParams) : callback();
        return true;
    } finally {
        delete _memosMap.delete(memoId);
    }
};

export const unmemoizeDomNodeAndDescendants = (domNode, extraCallbackParamsArray) => {
    let memos = [];
    _findMemoNodes(domNode, memos);
    for (let i = 0, j = memos.length; i < j; i++) {
        let node = memos[i].domNode;
        let combinedParams = [node];
        if (extraCallbackParamsArray) {
            arrayPushAll(combinedParams, extraCallbackParamsArray);
        }
        unmemoize(memos[i].memoId, combinedParams);
        node.nodeValue = ''; // Neuter this node so we don't try to unmemoize it again
        if (node.parentNode) {
            node.parentNode.removeChild(node); // If possible, erase it totally (not always possible - someone else might just hold a reference to it then call unmemoizeDomNodeAndDescendants again)
        }
    }
};

export const parseMemoText = (memoText) => {
    let match = memoText.match(/^\[ko_memo:(.*?)]$/);
    return match ? match[1] : null;
};

