
export const DOM_DATASTORE_PROP = Symbol('ko-domdata');

const KEY_PREFIX = 'ko_' + Date.now().toString(36) + '_';

let _keyCount = 0;
export const nextDomDataKey = () => KEY_PREFIX + (++_keyCount);

// not using optional chaining here as it's 20% slower (2025)
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

