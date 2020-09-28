const DATASTORE_PROP = Symbol('ko-domdata');
const KEY_PREFIX = 'ko_' + Date.now().toString(36) + '_';

let _keyCount = 0;


export const getDomData = (node, key) => {
    let dataForNode = node[DATASTORE_PROP];
    return dataForNode && dataForNode[key];
};

/**
 * Returns a function that removes a given item from an array located under the node's domData[itemArrayDomDataKey].
 * If the array IS or BECOMES empty, it will be deleted from the domData. 
 * @return {function(Node, *): void}
 */
export const getCurriedDomDataArrayItemRemovalFunctionForArrayDomDataKey = (itemArrayDomDataKey) => (node, itemToRemove) => {
    let dataForNode = node[DATASTORE_PROP],
        itemArray = dataForNode && dataForNode[itemArrayDomDataKey];

    if (itemArray) {
        let index = itemArray.indexOf(itemToRemove);
        if (index === 0) {
            itemArray.shift();
        } else if (index > 0) {
            itemArray.splice(index, 1);
        }
        if (!itemArray.length) {
            dataForNode[itemArrayDomDataKey] = undefined;
        }
    }
};

/**
 * Returns a function that adds a given item to an array located under the node's domData[itemArrayDomDataKey].
 * If the domData or the array didn't exist, either will be created.
 * @param {string} itemArrayDomDataKey
 * @return {function(Node, *): void}
 */
export const getCurriedDomDataArrayItemAddFunctionForArrayDomDataKey = (itemArrayDomDataKey) => (node, itemToAdd) => {
    let dataForNode = node[DATASTORE_PROP] || (node[DATASTORE_PROP] = Object.create(null)),
        itemArray = dataForNode[itemArrayDomDataKey];
    
    if (itemArray) {
        itemArray.push(itemToAdd);
    } else {
        dataForNode[itemArrayDomDataKey] = [itemToAdd];
    }
}

/**
 * Returns a function that will 
 *  (1) run all (function-)items of an array located under the node's domData[itemArrayDomDataKey], passing the node as parameter
 *  (2) clear the node's DOM data
 * @param {string} itemArrayDomDataKey
 * @return {function(Node): void}
 */
export const getCurriedDomDataArrayInvokeEachAndClearDomDataFunctionForArrayDomDataKey = (itemArrayDomDataKey) => (node) => {
    let dataForNode = node[DATASTORE_PROP];
    if (dataForNode) {
        let itemArray = dataForNode[itemArrayDomDataKey];
        if (itemArray) {
            for (let i = 0, _fns = itemArray.slice(0), len = _fns.length; i < len; i++) {
                _fns[i](node);
            }
        }
        delete node[DATASTORE_PROP];
    }    
}

export const setDomData = (node, key, value) => {
    // Make sure we don't actually create a new domData key if we are actually deleting a value
    let dataForNode = node[DATASTORE_PROP] || (value !== undefined && (node[DATASTORE_PROP] = Object.create(null)));
    if (dataForNode) {
        dataForNode[key] = value;
    }
};

export const getOrSetDomData = (node, key, value) => {
    let dataForNode = node[DATASTORE_PROP] || (node[DATASTORE_PROP] = Object.create(null)),
        existingValue = dataForNode[key];

    return existingValue || (dataForNode[key] = value);
};

export const clearDomData = (node) => {
    if (node[DATASTORE_PROP]) {
        delete node[DATASTORE_PROP];
        return true; // Exposing "did clean" flag purely so specs can infer whether things have been cleaned up as intended
    }
    return false;
};

export const nextDomDataKey = () => KEY_PREFIX + (++_keyCount);
