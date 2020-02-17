const DATASTORE_PROP = Symbol('ko-domdata');
const KEY_PREFIX = 'ko_' + Date.now().toString(36) + '_';

let _keyCount = 0;


export const getDomData = (node, key) => {
    let dataForNode = node[DATASTORE_PROP];
    return dataForNode && dataForNode[key];
};

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
