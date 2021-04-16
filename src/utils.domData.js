
export const DOM_DATASTORE_PROP = Symbol('ko-domdata');
const KEY_PREFIX = 'ko_' + Date.now().toString(36) + '_';

let _keyCount = 0;
export const nextDomDataKey = () => KEY_PREFIX + (++_keyCount);

export const getDomData = (node, key) => node[DOM_DATASTORE_PROP] && node[DOM_DATASTORE_PROP][key]; //@inline-global:DOM_DATASTORE_PROP

export const setDomData = (node, key, value) => {
    // Make sure we don't actually create a new domData key if we are actually deleting a value
    let dataForNode = node[DOM_DATASTORE_PROP] || (value !== undefined && (node[DOM_DATASTORE_PROP] = {}));
    if (dataForNode) {
        dataForNode[key] = value;
    }
};

/**
 *
 * @param {Node} node
 * @return {boolean} - true if there was actually a domData deleted on the node
 */
export const clearDomData = (node) => !!node[DOM_DATASTORE_PROP] && delete node[DOM_DATASTORE_PROP];

/**
 * Returns a function that removes a given item from an array located under the node's domData[itemArrayDomDataKey].
 * If the array IS or BECOMES empty, it will be deleted from the domData. 
 * @return {function(Node, *): void}
 */
export const getCurriedDomDataArrayItemRemovalFunctionForArrayDomDataKey = (itemArrayDomDataKey) => (node, itemToRemove) => {
    let dataForNode = node[DOM_DATASTORE_PROP],
        itemArray;

    if (dataForNode && (itemArray = dataForNode[itemArrayDomDataKey])) {
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
    let dataForNode = node[DOM_DATASTORE_PROP] || (node[DOM_DATASTORE_PROP] = {}),
        itemArray = dataForNode[itemArrayDomDataKey]; 
    
    if (itemArray) {
        itemArray.push(itemToAdd);
    } else {
        dataForNode[itemArrayDomDataKey] = [itemToAdd];
    }
};

/**
 * Returns a function that will 
 *  (1) run all (function-)items of an array located under the node's domData[itemArrayDomDataKey], passing the node as parameter
 *  (2) clear the node's DOM data
 * @param {string} itemArrayDomDataKey
 * @return {function(Node): void}
 */
export const getCurriedDomDataArrayInvokeEachAndClearDomDataFunctionForArrayDomDataKey = (itemArrayDomDataKey) => (node) => {
    let dataForNode = node[DOM_DATASTORE_PROP];
    if (dataForNode) {
        let itemArray = dataForNode[itemArrayDomDataKey];
        if (itemArray) {
            for (let i = 0, _fns = itemArray.slice(0), len = _fns.length; i < len; i++) {
                _fns[i](node);
            }
        }
        delete node[DOM_DATASTORE_PROP];
    }    
};
