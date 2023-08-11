import {isObservable, unwrapObservable} from './subscribables/observableUtils';
import {cleanNode, removeNode} from './utils.domNodeDisposal';
import {firstChild, nextSibling, setDomNodeChildren as virtualElementsSetDomNodeChildren} from './virtualElements';
import {onError} from './onError';


// For details on the pattern for changing node classes
// see: https://github.com/knockout/knockout/issues/1597
const CSS_CLASSNAME_REGEX = /\S+/g;

// using a map for lookups is 33% faster than plain objects in Chrome 79, and only 5ish % slower in Firefox 72 
const KNOWN_EVENT_TYPES_BY_EVENT_NAME = new Map();
for (let eventName of ['keyup', 'keydown', 'keypress']) {
    KNOWN_EVENT_TYPES_BY_EVENT_NAME.set(eventName, 'UIEvents');
}
for (let eventName of ['click', 'dblclick', 'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave']) {
    KNOWN_EVENT_TYPES_BY_EVENT_NAME.set(eventName, 'MouseEvents');
}

export const canSetPrototype = ({__proto__: []} instanceof Array);
    
export const hasOwnProperty = Object.prototype.hasOwnProperty;

export const objectForEach = (obj, action) => {
    if (obj) {
        for (let prop of Object.keys(obj)) {
            action(prop, obj[prop]);
        }
    }
};

export const extend = Object.assign;

export const setPrototypeOf = (obj, proto)  => {
    obj.__proto__ = proto;
    return obj;
};

// shortcut for if (canSetPrototype) ... 
export const trySetPrototypeOf = canSetPrototype ? setPrototypeOf : () => null;

export const setPrototypeOfOrExtend = canSetPrototype ? setPrototypeOf : extend;

export const toggleObjectClassPropertyString = (obj, prop, classNames, shouldHaveClass) => {
    // obj/prop is either a node/'className' or a SVGAnimatedString/'baseVal'.
    let currentClassNames = obj[prop].match(CSS_CLASSNAME_REGEX) || [];
    for (let className of classNames.match(CSS_CLASSNAME_REGEX)) {
        addOrRemoveItem(currentClassNames, className, shouldHaveClass);
    }
    obj[prop] = currentClassNames.join(' ');
};

export const toggleDomNodeCssClass = (node, classNames, shouldHaveClass) => {
    if (classNames) {
        if (typeof node.classList === 'object') {
            let addOrRemove = shouldHaveClass ? 'add' : 'remove';
            for (let className of classNames.match(CSS_CLASSNAME_REGEX)) {
                node.classList[addOrRemove](className);
            }
        } else if (typeof node.className['baseVal'] === 'string') {
            // SVG tag .classNames is an SVGAnimatedString instance
            toggleObjectClassPropertyString(node.className, 'baseVal', classNames, shouldHaveClass);
        } else {
            // node.className ought to be a string.
            toggleObjectClassPropertyString(node, 'className', classNames, shouldHaveClass);
        }
    }
};

export const fieldsIncludedWithJsonPost = ['authenticity_token', /^__RequestVerificationToken(_.*)?$/];

export const arrayForEach = (array, action, actionOwner) => {
    for (let i = 0, j = array.length; i < j; i++) {
        action.call(actionOwner, array[i], i, array);
    }
};

export const arrayIndexOf = (array, item) => array.indexOf(item);

export const arrayFirst = function (array, predicate, predicateOwner) {
    for (let i = 0, j = array.length; i < j; i++) {
        if (predicate.call(predicateOwner, array[i], i, array)) {
            return array[i];
        }
    }
    return undefined;
};

export const arrayRemoveItem = (array, itemToRemove) => {
    let index = (array && array.length) ? array.indexOf(itemToRemove) : -1;
    if (index === 0) {
        array.shift();
    } else if (index > 0) {
        array.splice(index, 1);
    }
};

export const arrayGetDistinctValues = (array) => {
    let result = [],
        nextIndex = 0;
    if (array) {
        for (let item of array) {
            if (!result.includes(item)) {
                result[nextIndex++] = item;
            }
        }
    }
    return result;
};

export const arrayMap = (array, mapping, mappingOwner) => {
    let result = [],
        nextIndex = 0;
    if (array) {
        for (let i = 0, j = array.length; i < j; i++) {
            result[nextIndex++] = mapping.call(mappingOwner, array[i], i);
        }
    }
    return result;
};

export const arrayFilter = (array, predicate, predicateOwner) => {
    let result = [],
        nextIndex = 0;
    if (array) {
        for (let i = 0, j = array.length; i < j; i++) {
            if (predicate.call(predicateOwner, array[i], i)) {
                result[nextIndex++] = array[i];
            }
        }
    }
    return result;
};

export const arrayPushAll = (array, valuesToPush) => {
    for (let i = 0, targetIndex = array.length, len = valuesToPush.length; i < len; i++, targetIndex++) {
        array[targetIndex] = valuesToPush[i];
    }
    return array;
};

export const peekObservable = (value) => isObservable(value) ? value.peek() : value;

export const addOrRemoveItem = (array, value, included) => {
    let existingEntryIndex = peekObservable(array).indexOf(value);
    if (existingEntryIndex < 0) {
        if (included) {
            array.push(value);
        }
    } else if (!included) {
        array.splice(existingEntryIndex, 1);
    }
};

export const objectMap = (source, mapping, mappingOwner) => {
    if (!source) {
        return source;
    }
    let target = {};
    for (let prop of Object.keys(source)) {
        target[prop] = mapping.call(mappingOwner, source[prop], prop, source);
    }
    return target;
};

export const moveCleanedNodesToContainerElement = (nodes) => {
    // Ensure it's a real array, as we're about to re-parent the nodes and
    // we don't want the underlying collection to change while we're doing that.
    // (!) don't use 'nodesArray = [...nodes]' as rest parameter is rel. slow; see comment in parseHtmlFragment()
    let nodesArray = [],
        len = nodes.length,
        container = (len && nodes[0].ownerDocument || document).createElement('div');
    
    for (let i = 0; i < len; i++) {
        nodesArray[i] = nodes[i];
    }
    for (let i = 0; i < len; i++) {
        container.appendChild(cleanNode(nodesArray[i]));
    }
    return container;
};

export const cloneNodes = (nodesArray, shouldCleanNodes) => {
    let newNodesArray = [];
    for (let i = 0, len = nodesArray.length; i < len; i++) {
        newNodesArray[i] = shouldCleanNodes ? cleanNode(nodesArray[i].cloneNode(true)) : nodesArray[i].cloneNode(true);
    }
    return newNodesArray;
};

export const replaceDomNodes = (nodeToReplaceOrNodeArray, newNodesArray) => {
    let nodesToReplaceArray = nodeToReplaceOrNodeArray.nodeType ? [nodeToReplaceOrNodeArray] : nodeToReplaceOrNodeArray;
    if (nodesToReplaceArray.length > 0) {
        let insertionPoint = nodesToReplaceArray[0];
        let parent = insertionPoint.parentNode;
        for (let i = 0, j = newNodesArray.length; i < j; i++) {
            parent.insertBefore(newNodesArray[i], insertionPoint);
        }
        for (let i = 0, j = nodesToReplaceArray.length; i < j; i++) {
            removeNode(nodesToReplaceArray[i]);
        }
    }
};

export const fixUpContinuousNodeArray = (continuousNodeArray, parentNode) => {
    // Before acting on a set of nodes that were previously outputted by a template function, we have to reconcile
    // them against what is in the DOM right now. It may be that some of the nodes have already been removed, or that
    // new nodes might have been inserted in the middle, for example by a binding. Also, there may previously have been
    // leading comment nodes (created by rewritten string-based templates) that have since been removed during binding.
    // So, this function translates the old "map" output array into its best guess of the set of current DOM nodes.
    //
    // Rules:
    //   [A] Any leading nodes that have been removed should be ignored
    //       These most likely correspond to memoization nodes that were already removed during binding
    //       See https://github.com/knockout/knockout/pull/440
    //   [B] Any trailing nodes that have been remove should be ignored
    //       This prevents the code here from adding unrelated nodes to the array while processing rule [C]
    //       See https://github.com/knockout/knockout/pull/1903
    //   [C] We want to output a continuous series of nodes. So, ignore any nodes that have already been removed,
    //       and include any nodes that have been inserted among the previous collection

    if (continuousNodeArray.length) {
        // The parent node can be a virtual element; so get the real parent node
        parentNode = (parentNode.nodeType === 8 && parentNode.parentNode) || parentNode;

        // Rule [A]
        while (continuousNodeArray.length && continuousNodeArray[0].parentNode !== parentNode) {
            continuousNodeArray.splice(0, 1);
        }
        // Rule [B]
        while (continuousNodeArray.length > 1 && continuousNodeArray[continuousNodeArray.length - 1].parentNode !== parentNode) {
            continuousNodeArray.length--;
        }
        // Rule [C]
        if (continuousNodeArray.length > 1) {
            let current = continuousNodeArray[0], last = continuousNodeArray[continuousNodeArray.length - 1];
            // Replace with the actual new continuous node set
            continuousNodeArray.length = 0;
            while (current !== last) {
                continuousNodeArray.push(current);
                current = current.nextSibling;
            }
            continuousNodeArray.push(last);
        }
    }
    return continuousNodeArray;
};

export const setOptionNodeSelectionState = (optionNode, isSelected) => optionNode.selected = isSelected;

export const stringTrim = (string) => (string === null || string === undefined) ? '' : 
                                       string.trim ? string.trim() : string.toString().trim();

/** @deprecated */
export const stringStartsWith = (string, startsWith) => (string || '').startsWith(startsWith);

export const domNodeIsContainedBy = (node, containedByNode) => {
    if (node === containedByNode) {
        return true;
    }
    if (containedByNode.contains) {
        return containedByNode.contains(node.nodeType !== 1 ? node.parentNode : node);
    }
    if (containedByNode.compareDocumentPosition) {
        return (containedByNode.compareDocumentPosition(node) & 16) === 16;
    }
    while (node && node !== containedByNode) {
        node = node.parentNode;
    }
    return !!node;
};

export const domNodeIsAttachedToDocument = (node) => node ? !!node.isConnected : false;

/**
 * @param {Node[]} nodes
 * @return {boolean}
 */
export const anyDomNodeIsAttachedToDocument = (nodes) => {
    for (let node of nodes) {
        if (node.isConnected) {
            return true;
        }
    }
    return false;
};

// For HTML elements, tagName will always be upper case; for XHTML elements, it'll be lower case.
// Possible future optimization: If we know it's an element from an XHTML document (not HTML),
// we don't need to do the .toLowerCase() as it will always be lower case anyway.
export const tagNameLower = (element) => {
    let tagName = element && element.tagName;
    return tagName && tagName.toLowerCase();
};

export const catchFunctionErrors = (delegate) => {
    return onError ? function() {
            try {
                // direct call is faster than delegate.apply, and the delegate itself is responsible of its 'this' 
                return delegate(...arguments);
            } catch (e) {
                onError && onError(e);
                throw e;
            }
        } : delegate;
};

export const setTimeoutWithCatchError = (handler, timeout) => setTimeout(catchFunctionErrors(handler), timeout);

export const deferError = (error) => {
    setTimeout(() => {
        onError && onError(error);
        throw error;
    }, 0);
};

export const valuesArePrimitiveAndEqual = (PRIMITIVE_TYPES => (a, b) => {
    let oldValueIsPrimitive = (a === null) || PRIMITIVE_TYPES[typeof a];
    return oldValueIsPrimitive ? (a === b) : false;
})({'undefined': 1, 'boolean': 1, 'number': 1, 'string': 1});

export const registerEventHandler = (element, eventType, handler) => {
    if (typeof element.addEventListener === 'function') {
        element.addEventListener(eventType, catchFunctionErrors(handler), false);
        return;
    }
    throw new Error('Browser doesn\'t support addEventListener');
};

export const triggerEvent = (element, eventType) => {
    if (!(element && element.nodeType)) {
        throw new Error('element must be a DOM node when calling triggerEvent');
    }

    if (typeof element.dispatchEvent === 'function') {
        let eventCategory = KNOWN_EVENT_TYPES_BY_EVENT_NAME.get(eventType) || 'HTMLEvents',
            event = document.createEvent(eventCategory);
        event.initEvent(eventType, true, true, window, 0, 0, 0, 0, 0, false, false, false, false, 0, element);
        element.dispatchEvent(event);
        return;
    }
    throw new Error('The supplied element doesn\'t support dispatchEvent');
};

export const setTextContent = (element, textContent) => {
    let value = unwrapObservable(textContent);
    if (value === null || value === undefined) {
        value = '';
    }

    // We need there to be exactly one child: a text node.
    // If there are no children, more than one, or if it's not a text node,
    // we'll clear everything and create a single text node.
    let innerTextNode = firstChild(element);
    if (!innerTextNode || innerTextNode.nodeType !== 3 || nextSibling(innerTextNode)) {
        virtualElementsSetDomNodeChildren(element, [element.ownerDocument.createTextNode(value)]);
    } else {
        innerTextNode.data = value;
    }
};

/** @deprecated - too trivial*/
export const setElementName = (element, name) => element.name = name;

export const range = function (min, max) {
    let result = [];
    for (let i = unwrapObservable(min), max = unwrapObservable(max); i <= max; i++) {
        result.push(i);
    }
    return result;
};

/** @deprecated - modern ES has enough means to turn array-like structures into Arrays -> Array.from(), [...values] */
export const makeArray = (arrayLikeObject) => {
    let result = [];
    for (let i = 0, j = arrayLikeObject.length; i < j; i++) {
        result[i] = arrayLikeObject[i];
    }
    return result;
};

/**
 * @param {string} identifier
 * @return {symbol}
 * @deprecated - in here for legacy purposes only
 */
export const createSymbolOrString = identifier => Symbol(identifier);

export const getFormFields = (form, fieldName) => {
    let fields = [...form.getElementsByTagName('input'), ...form.getElementsByTagName('textarea')];
    let isMatchingField = (typeof fieldName === 'string') ? (field) => field.name === fieldName
                                                         : (field) => fieldName.test(field.name);
        // Treat fieldName as regex or object containing predicate
    let matches = [];
    for (let i = fields.length - 1; i >= 0; i--) {
        if (isMatchingField(fields[i])) {
            matches.push(fields[i]);
        }
    }
    return matches;
};

// replacer and space are optional
export const stringifyJson = (data, replacer, space) => JSON.stringify(unwrapObservable(data), replacer, space);

export const postJson = function(urlOrForm, data, options) {
    options = options || {};
    let params = options['params'] || {},
        includeFields = options['includeFields'] || fieldsIncludedWithJsonPost,
        url = urlOrForm;

    // If we were given a form, use its 'action' URL and pick out any requested field values
    if ((typeof urlOrForm === 'object') && (tagNameLower(urlOrForm) === 'form')) {
        let originalForm = urlOrForm;
        url = originalForm.action;
        for (let i = includeFields.length - 1; i >= 0; i--) {
            let fields = getFormFields(originalForm, includeFields[i]);
            for (let j = fields.length - 1; j >= 0; j--) {
                params[fields[j].name] = fields[j].value;
            }
        }
    }
    data = unwrapObservable(data);
    let form = document.createElement('form');
    form.style.display = 'none';
    form.action = url;
    form.method = 'post';
    if (data) {
        for (let key of Object.keys(data)) {
            // Since 'data' this is a model object, we include all properties including those inherited from its prototype
            let input = document.createElement('input');
            input.type = 'hidden';
            input.name = key;
            input.value = stringifyJson(unwrapObservable(data[key]));
            form.appendChild(input);
        }
    }
    if (params) {
        for (let key of Object.keys(params)) {
            let input = document.createElement('input');
            input.type = 'hidden';
            input.name = key;
            input.value = params[key];
            form.appendChild(input);
        }
    }
    document.body.appendChild(form);
    options.submitter ? options.submitter(form) : form.submit();
    setTimeout(() => form.parentNode.removeChild(form), 0);
};

/**
 * Converts a kebab-case string into camelCase.
 * @param {string} s - a kebab string; a leading dash or contained double dashes are considered non-kebab
 * @return {string} - the converted string if the input was kebab, otherwise the original string
 */
export const kebabToCamelCase = (s) => {
    let lastI = 0,
        i = s.indexOf('-'),
        out = '';

    while (i > 0) {
        if (s[i+1] === '-') {
            return s; // early-exit if non-kebab detected
        }
        out += s.substring(lastI, i) + s[i+1].toUpperCase();
        i = s.indexOf('-', lastI = i + 2);
    }
    return lastI ? out + s.substring(lastI) : s;
};
