import {DOM_DATASTORE_PROP,
    nextDomDataKey
} from './utils.domData';
import {ignoreDependencyDetectionNoArgs} from './subscribables/dependencyDetection';

const DISPOSE_CALLBACKS_DOM_DATA_KEY = nextDomDataKey();

// Node types: Element(1), Comment(8), Document(9)
const _isNodeTypeCleanable = nodeType => nodeType === 1 || nodeType === 8 || nodeType === 9; //@inline
const _isNodeTypeCleanableWithDescendents = nodeType => nodeType === 1 || nodeType === 9; //@inline


/** @type {function|boolean} */
export let _cleanExternalData = false;
export const _overrideCleanExternalData = (fn) => _cleanExternalData = fn;

const _cleanSingleNode = (node) => {
    // Run all the dispose callbacks & ease the DOM data
    let domData = node[DOM_DATASTORE_PROP];
    if (domData) {
        let disposeCallbackFns = domData[DISPOSE_CALLBACKS_DOM_DATA_KEY];
        if (disposeCallbackFns) {
            for (let fn of disposeCallbackFns.slice(0)) {
                fn(node);
            }
        }
        node[DOM_DATASTORE_PROP] = undefined;
    }
    
    // Perform cleanup needed by external libraries (currently only jQuery, but can be extended)
    if (_cleanExternalData) {
        _cleanExternalData(node);
    }
    
    // Clear any immediate-child comment nodes, as these wouldn't have been found by
    // node.getElementsByTagName("*") in cleanNode() (comment nodes aren't elements)
    if (_isNodeTypeCleanableWithDescendents(node.nodeType)) {
        if (node.hasChildNodes()) {
            _cleanNodesInList(node.childNodes, true /*onlyComments*/);
        }
    }
};

/**
 * @param {HTMLCollection|NodeList} nodeList
 * @param {boolean} [onlyComments]
 * @private
 */
const _cleanNodesInList = (nodeList, onlyComments) => {
    let cleanedNodes = [],
        cleanedNodesIndex = -1,    
        lastCleanedNode;
    
    for (let i = 0, node; i < nodeList.length; i++) {
        node = nodeList[i]; 
        if (!onlyComments || node.nodeType === 8) {
            _cleanSingleNode(cleanedNodes[++cleanedNodesIndex] = lastCleanedNode = node);
            if (nodeList[i] !== lastCleanedNode) {
                while (i-- && !cleanedNodes.includes(nodeList[i])) {
                    // just do
                }
            }
        }
    }
};

/**
 * @param {Node} node
 * @param {function} callback 
 */
export const addDisposeCallback = (node, callback) => {
    let dataForNode = node[DOM_DATASTORE_PROP] || (node[DOM_DATASTORE_PROP] = {}),
        itemArray = dataForNode[DISPOSE_CALLBACKS_DOM_DATA_KEY];

    if (itemArray) {
        itemArray.push(callback);
    } else {
        dataForNode[DISPOSE_CALLBACKS_DOM_DATA_KEY] = [callback];
    }
};

 /**
 * @param {Node} node
 * @param {function} callbackToRemove
 */
export const removeDisposeCallback = (node, callbackToRemove) => {
    let dataForNode = node[DOM_DATASTORE_PROP],
        callbacks,
        index;

    if (dataForNode && (callbacks = dataForNode[DISPOSE_CALLBACKS_DOM_DATA_KEY]) && (index = callbacks.indexOf(callbackToRemove)) >= 0) {
        if (callbacks.length === 1) {
            // just leave the entire array to garbage collection 
            // not using 'delete' here as it seems 98% slower in chrome  
            dataForNode[DISPOSE_CALLBACKS_DOM_DATA_KEY] = undefined;
        } else if (!index) {
            callbacks.shift();
        } else {
            callbacks.splice(index, 1);
        }
    }
};

/**
 * Cleanable node types: Element 1, Comment 8, Document 9
 * @param {Node|HTMLElement} node
 * @return {Node|HTMLElement}
 */
export const cleanNode = (node) => {
    if (_isNodeTypeCleanable(node.nodeType)) {
        ignoreDependencyDetectionNoArgs(() => {
            // First clean this node, where applicable
            _cleanSingleNode(node);
            // ... then its descendants, where applicable
            if (_isNodeTypeCleanableWithDescendents(node.nodeType)) {
                let cleanableNodesList = node.getElementsByTagName('*');
                if (cleanableNodesList.length) {
                    _cleanNodesInList(cleanableNodesList);
                }
            }
        });
    }
    return node;
};

export const removeNode = (node) => cleanNode(node).remove(); //@inline-global:cleanNode
