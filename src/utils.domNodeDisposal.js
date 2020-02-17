import {nextDomDataKey, setDomData, getDomData, clearDomData} from './utils.domData';
import {ignoreDependencyDetection} from './subscribables/dependencyDetection';

const DOM_DATA_KEY = nextDomDataKey();
const CLEANABLE_NODE_TYPES = {1: true, 8: true, 9: true};                   // Element, Comment, Document
const CLEANABLE_NODE_TYPES_WITH_DESCENDENTS = {1: true, 8: false, 9: true}; // Element, Comment(not), Document

const _getDisposeCallbacksCollection = (node, createIfNotFound) => {
    let allDisposeCallbacks = getDomData(node, DOM_DATA_KEY);
    if ((allDisposeCallbacks === undefined) && createIfNotFound) {
        allDisposeCallbacks = [];
        setDomData(node, DOM_DATA_KEY, allDisposeCallbacks);
    }
    return allDisposeCallbacks;
};

const _destroyCallbacksCollection = (node) => setDomData(node, DOM_DATA_KEY, undefined);

/** @type {function} */
export let _cleanExternalData = null;
export const _overrideCleanExternalData = (fn) => _cleanExternalData = fn;


const _cleanSingleNode = (node) => {
    // Run all the dispose callbacks
    let callbacks = _getDisposeCallbacksCollection(node, false);
    if (callbacks) {
        callbacks = callbacks.slice(0); // Clone, as the array may be modified during iteration (typically, callbacks will remove themselves)
         for (let i = 0; i < callbacks.length; i++) {
             callbacks[i](node);
         }
    }

    // Erase the DOM data
    clearDomData(node);

    // Perform cleanup needed by external libraries (currently only jQuery, but can be extended)
    if (_cleanExternalData) {
        _cleanExternalData(node);
    }
    
    // Clear any immediate-child comment nodes, as these wouldn't have been found by
    // node.getElementsByTagName("*") in cleanNode() (comment nodes aren't elements)
    if (CLEANABLE_NODE_TYPES_WITH_DESCENDENTS[node.nodeType]) {
        _cleanNodesInList(node.childNodes, true/*onlyComments*/);
    }
};

const _cleanNodesInList = (nodeList, onlyComments) => {
    let cleanedNodes = [], 
        lastCleanedNode;
    
     for (let i = 0; i < nodeList.length; i++) {
        if (!onlyComments || nodeList[i].nodeType === 8) {
            _cleanSingleNode(cleanedNodes[cleanedNodes.length] = lastCleanedNode = nodeList[i]);
            if (nodeList[i] !== lastCleanedNode) {
                while (i-- && !cleanedNodes.includes(nodeList[i])) {
                    // just do
                }
            }
        }
    }
};

export const addDisposeCallback = (node, callback) => {
    if (typeof callback !== 'function') {
        throw new Error('Callback must be a function');
    }
    _getDisposeCallbacksCollection(node, true).push(callback);
};

export const removeDisposeCallback = (node, callback) => {
    let callbacksCollection = _getDisposeCallbacksCollection(node, false);
    if (callbacksCollection) {
        let index = callbacksCollection.length ? callbacksCollection.indexOf(callback) : -1;
        if (index === 0) {
            callbacksCollection.shift();
        } else if (index > 0) {
            callbacksCollection.splice(index, 1);
        }
        if (!callbacksCollection.length) {
            _destroyCallbacksCollection(node);
        }
    }
};

export const cleanNode = (node) => {
    ignoreDependencyDetection(() => {
        // First clean this node, where applicable
        if (CLEANABLE_NODE_TYPES[node.nodeType]) {
            _cleanSingleNode(node);
            // ... then its descendants, where applicable
            if (CLEANABLE_NODE_TYPES_WITH_DESCENDENTS[node.nodeType]) {
                _cleanNodesInList(node.getElementsByTagName('*'));
            }
        }
    });
    return node;
};

export const removeNode = (node) => {
    cleanNode(node);
    if (node.parentNode) {
        node.parentNode.removeChild(node);
    }
};
