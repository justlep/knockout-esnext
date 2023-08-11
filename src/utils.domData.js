
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
export const clearDomData = (node) => node[DOM_DATASTORE_PROP] ? !(node[DOM_DATASTORE_PROP] = undefined) : false;

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
