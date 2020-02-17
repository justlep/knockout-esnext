
/** @type {function} */
export let onError = null;

export const _overrideOnError = (fnOrNull) => {
    if (fnOrNull && typeof fnOrNull !== 'function') {
        throw new Error('ko.onError must be function or nullish');
    }
    onError = fnOrNull;
};
