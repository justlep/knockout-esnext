/*!
 * Knockout JavaScript library v3.5.1-mod6-esnext-debug
 * ESNext Edition - https://github.com/justlep/knockout-esnext
 * (c) The Knockout.js team - http://knockoutjs.com/
 * License: MIT (http://www.opensource.org/licenses/mit-license.php)
 */

(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
    (global = global || self, global.ko = factory());
}(this, (function () {
    const DEBUG = true; // inserted by rollup intro
    const version = '3.5.1-mod6'; // inserted by rollup intro

    /** @type {function} */
    let onError = null;

    const _overrideOnError = (fnOrNull) => {
        if (fnOrNull && typeof fnOrNull !== 'function') {
            throw new Error('ko.onError must be function or nullish');
        }
        onError = fnOrNull;
    };

    const DATASTORE_PROP = Symbol('ko-domdata');
    const KEY_PREFIX = 'ko_' + Date.now().toString(36) + '_';

    let _keyCount = 0;


    const getDomData = (node, key) => {
        let dataForNode = node[DATASTORE_PROP];
        return dataForNode && dataForNode[key];
    };

    /**
     * Returns a function that removes a given item from an array located under the node's domData[itemArrayDomDataKey].
     * If the array IS or BECOMES empty, it will be deleted from the domData. 
     * @return {function(Node, *): void}
     */
    const getCurriedDomDataArrayItemRemovalFunctionForArrayDomDataKey = (itemArrayDomDataKey) => (node, itemToRemove) => {
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
    const getCurriedDomDataArrayItemAddFunctionForArrayDomDataKey = (itemArrayDomDataKey) => (node, itemToAdd) => {
        let dataForNode = node[DATASTORE_PROP] || (node[DATASTORE_PROP] = Object.create(null)),
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
    const getCurriedDomDataArrayInvokeEachAndClearDomDataFunctionForArrayDomDataKey = (itemArrayDomDataKey) => (node) => {
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
    };

    const setDomData = (node, key, value) => {
        // Make sure we don't actually create a new domData key if we are actually deleting a value
        let dataForNode = node[DATASTORE_PROP] || (value !== undefined && (node[DATASTORE_PROP] = Object.create(null)));
        if (dataForNode) {
            dataForNode[key] = value;
        }
    };

    const getOrSetDomData = (node, key, value) => {
        let dataForNode = node[DATASTORE_PROP] || (node[DATASTORE_PROP] = Object.create(null)),
            existingValue = dataForNode[key];

        return existingValue || (dataForNode[key] = value);
    };

    const clearDomData = (node) => {
        if (node[DATASTORE_PROP]) {
            delete node[DATASTORE_PROP];
            return true; // Exposing "did clean" flag purely so specs can infer whether things have been cleaned up as intended
        }
        return false;
    };

    const nextDomDataKey = () => KEY_PREFIX + (++_keyCount);

    const IS_SUBSCRIBABLE = Symbol('IS_SUBSCRIBABLE');
    const isSubscribable = (obj) => !!(obj && obj[IS_SUBSCRIBABLE]);

    const IS_OBSERVABLE = Symbol('IS_OBSERVABLE');
    //export const isObservable = (obj) => !!(obj && obj[IS_OBSERVABLE]);
    const isObservable = (obj) => {
        if (!obj) {
            return false;
        }
        if (obj.__ko_proto__) {
            // TODO left this only for not breaking the asyncBehaviors.js tests; remove later 
            throw Error("Invalid object that looks like an observable; possibly from another Knockout instance");
        }
        return !!obj[IS_OBSERVABLE];
    };

    const IS_OBSERVABLE_ARRAY = Symbol('IS_OBSERVABLE_ARRAY');
    const isObservableArray = (obj) => !!(obj && obj[IS_OBSERVABLE_ARRAY]);

    const IS_COMPUTED = Symbol('IS_COMPUTED');
    const isComputed = (obj) => !!(obj && obj[IS_COMPUTED]);

    const IS_PURE_COMPUTED = Symbol('IS_PURE_COMPUTED');
    const isPureComputed = (obj) => !!(obj && obj[IS_PURE_COMPUTED]);

    const isWritableObservable = (obj) => !!(obj && (obj[IS_COMPUTED] ? obj.hasWriteFunction : obj[IS_OBSERVABLE]));

    const outerFrames = [];
    let currentFrame,
        lastId = 0;

    const beginDependencyDetection = options => {
        outerFrames.push(currentFrame);
        currentFrame = options;
    };

    const endDependencyDetection = () => currentFrame = outerFrames.pop();

    const ignoreDependencyDetection = (callback, callbackTarget, callbackArgs) => {
        try {
            beginDependencyDetection();
            // there's a high percentage of calls without callbackTarget and/or callbackArgs, 
            // so let's speed up things by not using `apply` or args in those cases
            return callbackTarget ? callback.apply(callbackTarget, callbackArgs || []) :
                callbackArgs ? callback(...callbackArgs) : callback();
        } finally {
            endDependencyDetection();
        }
    };

    // Return a unique ID that can be assigned to an observable for dependency tracking.
    // Theoretically, you could eventually overflow the number storage size, resulting
    // in duplicate IDs. But in JavaScript, the largest exact integral value is 2^53
    // or 9,007,199,254,740,992. If you created 1,000,000 IDs per second, it would
    // take over 285 years to reach that number.
    // Reference http://blog.vjeux.com/2010/javascript/javascript-max_int-number-limits.html
    const _getId = () => ++lastId;

    const registerDependency = (subscribable) => {
        if (currentFrame) {
            if (!isSubscribable(subscribable)) {
                throw new Error('Only subscribable things can act as dependencies');
            }
            currentFrame.callback.call(currentFrame.callbackTarget, subscribable, subscribable._id || (subscribable._id = _getId()));
        }
    };

    const getDependenciesCount = () => currentFrame ? currentFrame.computed.getDependenciesCount() : undefined;
    const getDependencies = () => currentFrame ? currentFrame.computed.getDependencies() : undefined;
    const isInitialDependency = () => currentFrame ? currentFrame.isInitial : undefined;
    const getCurrentComputed = () => currentFrame ? currentFrame.computed : undefined;

    const DISPOSE_CALLBACKS_DOM_DATA_KEY = nextDomDataKey();
    const CLEANABLE_NODE_TYPES = {1: true, 8: true, 9: true};                   // Element, Comment, Document
    const CLEANABLE_NODE_TYPES_WITH_DESCENDENTS = {1: true, 8: false, 9: true}; // Element, Comment(not), Document


    /** @type {function} */
    let _cleanExternalData = null;
    const _overrideCleanExternalData = (fn) => _cleanExternalData = fn;

    const _runDisposalCallbacksAndClearDomData = getCurriedDomDataArrayInvokeEachAndClearDomDataFunctionForArrayDomDataKey(DISPOSE_CALLBACKS_DOM_DATA_KEY);

    const _cleanSingleNode = (node) => {
        // Run all the dispose callbacks & ease the DOM data
        _runDisposalCallbacksAndClearDomData(node);

        // Perform cleanup needed by external libraries (currently only jQuery, but can be extended)
        if (_cleanExternalData) {
            _cleanExternalData(node);
        }
        
        // Clear any immediate-child comment nodes, as these wouldn't have been found by
        // node.getElementsByTagName("*") in cleanNode() (comment nodes aren't elements)
        if (CLEANABLE_NODE_TYPES_WITH_DESCENDENTS[node.nodeType]) {
            let cleanableNodesList = node.childNodes;
            if (cleanableNodesList.length) {
                _cleanNodesInList(cleanableNodesList, true /*onlyComments*/);
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

    /** @type {function(Node, Function): void} */
    const addDisposeCallback = getCurriedDomDataArrayItemAddFunctionForArrayDomDataKey(DISPOSE_CALLBACKS_DOM_DATA_KEY);

    /** @type {function(Node, Function): void} */
    const removeDisposeCallback = getCurriedDomDataArrayItemRemovalFunctionForArrayDomDataKey(DISPOSE_CALLBACKS_DOM_DATA_KEY); 

    const cleanNode = (node) => {
        if (CLEANABLE_NODE_TYPES[node.nodeType]) {
            ignoreDependencyDetection(() => {
                // First clean this node, where applicable
                _cleanSingleNode(node);
                // ... then its descendants, where applicable
                if (CLEANABLE_NODE_TYPES_WITH_DESCENDENTS[node.nodeType]) {
                    let cleanableNodesList = node.getElementsByTagName('*');
                    if (cleanableNodesList.length) {
                        _cleanNodesInList(cleanableNodesList);
                    }
                }
            });
        }
        return node;
    };

    const removeNode = (node) => cleanNode(node).remove();

    const emptyDomNode = (domNode) => {
        let child;
        while (child = domNode.firstChild) {
            removeNode(child);
        }
    };

    const setDomNodeChildren = (domNode, childNodes) => {
        emptyDomNode(domNode);
        if (childNodes) {
            for (let i = 0, j = childNodes.length; i < j; i++) {
                domNode.appendChild(childNodes[i]);
            }
        }
    };

    // "Virtual elements" is an abstraction on top of the usual DOM API which understands the notion that comment nodes

    const START_COMMENT_REGEX = /^\s*ko(?:\s+([\s\S]+))?\s*$/;

    const END_COMMENT_REGEX =   /^\s*\/ko\s*$/;
    const SYM_MATCHED_END_COMMENT = Symbol('__ko_matchedEndComment__');
    const HTML_TAGS_WITH_OPTIONAL_CLOSING_CHILDREN = {ul: true, ol: true};

    const allowedBindings = {};
    const allowedVirtualElementBindings = allowedBindings;

    const _isStartComment = (node) => (node.nodeType === 8) && START_COMMENT_REGEX.test(node.nodeValue); //@inline

    const hasBindingValue = _isStartComment;

    const _getVirtualChildren = (startComment, allowUnbalanced) => {
            let currentNode = startComment.nextSibling,
                depth = 1,
                childIndex = -1,
                children = [];
            
            while (currentNode) {
                if (((currentNode.nodeType === 8) && END_COMMENT_REGEX.test(currentNode.nodeValue))) {
                    currentNode[SYM_MATCHED_END_COMMENT] = true;
                    if (!--depth) {
                        return children;
                    }
                }
                children[++childIndex] = currentNode;
                if (((currentNode.nodeType === 8) && START_COMMENT_REGEX.test(currentNode.nodeValue))) {
                    depth++;
                }
                currentNode = currentNode.nextSibling;
            }
            if (!allowUnbalanced) {
                throw new Error('Cannot find closing comment tag to match: ' + startComment.nodeValue);
            }
            return null;
        };

    const _getMatchingEndComment = (startComment, allowUnbalanced) => {
        let allVirtualChildren = _getVirtualChildren(startComment, allowUnbalanced);
        if (allVirtualChildren) {
            let totalVirtualChildren = allVirtualChildren.length;
            return (totalVirtualChildren ? allVirtualChildren[totalVirtualChildren - 1] : startComment).nextSibling;
        }
        return null; // Must have no matching end comment, and allowUnbalanced is true
    };

    const _getUnbalancedChildTags = (node) => {
        // e.g., from <div>OK</div><!-- ko blah --><span>Another</span>, returns: <!-- ko blah --><span>Another</span>
        //       from <div>OK</div><!-- /ko --><!-- /ko -->,             returns: <!-- /ko --><!-- /ko -->
        let childNode = node.firstChild, 
            captureRemaining = null;
        
        while (childNode) {
            if (captureRemaining) {
                // We already hit an unbalanced node and are now just scooping up all subsequent nodes
                captureRemaining.push(childNode);
            } else if (((childNode.nodeType === 8) && START_COMMENT_REGEX.test(childNode.nodeValue))) {
                let matchingEndComment = _getMatchingEndComment(childNode, /* allowUnbalanced: */ true);
                if (matchingEndComment) {
                    childNode = matchingEndComment; // It's a balanced tag, so skip immediately to the end of this virtual set
                } else {
                    captureRemaining = [childNode]; // It's unbalanced, so start capturing from this point
                }
            } else if (((childNode.nodeType === 8) && END_COMMENT_REGEX.test(childNode.nodeValue))) {
                captureRemaining = [childNode];     // It's unbalanced (if it wasn't, we'd have skipped over it already), so start capturing
            }
            
            childNode = childNode.nextSibling;
        }
        return captureRemaining;
    };

    const childNodes = (node) => ((node.nodeType === 8) && START_COMMENT_REGEX.test(node.nodeValue)) ? _getVirtualChildren(node) : node.childNodes;

    const emptyNode = (node) => {
        if (!((node.nodeType === 8) && START_COMMENT_REGEX.test(node.nodeValue))) {
            emptyDomNode(node);
            return;
        }
        let virtualChildren = childNodes(node);
        for (let i = 0, j = virtualChildren.length; i < j; i++) {
            removeNode(virtualChildren[i]);
        }
    };

    const setDomNodeChildren$1 = (node, childNodes) => {
        if (!((node.nodeType === 8) && START_COMMENT_REGEX.test(node.nodeValue))) {
            setDomNodeChildren(node, childNodes);
            return;
        }
        emptyNode(node);
        let endCommentNode = node.nextSibling; // Must be the next sibling, as we just emptied the children
        for (let i = 0, j = childNodes.length; i < j; i++) {
            endCommentNode.parentNode.insertBefore(childNodes[i], endCommentNode);
        }
    };

    const prepend = (containerNode, nodeToPrepend) => {
        let insertBeforeNode;

        if (((containerNode.nodeType === 8) && START_COMMENT_REGEX.test(containerNode.nodeValue))) {
            // Start comments must always have a parent and at least one following sibling (the end comment)
            insertBeforeNode = containerNode.nextSibling;
            containerNode = containerNode.parentNode;
        } else {
            insertBeforeNode = containerNode.firstChild;
        }

        if (!insertBeforeNode) {
            containerNode.appendChild(nodeToPrepend);
        } else if (nodeToPrepend !== insertBeforeNode) {       // IE will sometimes crash if you try to insert a node before itself
            containerNode.insertBefore(nodeToPrepend, insertBeforeNode);
        }
    };

    const insertAfter = (containerNode, nodeToInsert, insertAfterNode) => {
        if (!insertAfterNode) {
            prepend(containerNode, nodeToInsert);
            return;
        }
        // Children of start comments must always have a parent and at least one following sibling (the end comment)
        let insertBeforeNode = insertAfterNode.nextSibling;

        if (((containerNode.nodeType === 8) && START_COMMENT_REGEX.test(containerNode.nodeValue))) {
            containerNode = containerNode.parentNode;
        }

        if (!insertBeforeNode) {
            containerNode.appendChild(nodeToInsert);
        } else if (nodeToInsert !== insertBeforeNode) {       // IE will sometimes crash if you try to insert a node before itself
            containerNode.insertBefore(nodeToInsert, insertBeforeNode);
        }
    };

    const firstChild = (node) => {
        if (!((node.nodeType === 8) && START_COMMENT_REGEX.test(node.nodeValue))) {
            let _nodeFirstChild = node.firstChild; 
            if (_nodeFirstChild && ((_nodeFirstChild.nodeType === 8) && END_COMMENT_REGEX.test(_nodeFirstChild.nodeValue))) {
                throw new Error('Found invalid end comment, as the first child of ' + node);
            }
            return _nodeFirstChild;
        } 
        let _nodeNextSibling = node.nextSibling;
        if (!_nodeNextSibling|| ((_nodeNextSibling.nodeType === 8) && END_COMMENT_REGEX.test(_nodeNextSibling.nodeValue))) {
            return null;
        }
        return _nodeNextSibling;
    };

    const nextSibling = (node) => {
        if (((node.nodeType === 8) && START_COMMENT_REGEX.test(node.nodeValue))) {
            node = _getMatchingEndComment(node);
        }
        let _nodeNextSibling = node.nextSibling;
        if (_nodeNextSibling && ((_nodeNextSibling.nodeType === 8) && END_COMMENT_REGEX.test(_nodeNextSibling.nodeValue))) {
            if (!_nodeNextSibling[SYM_MATCHED_END_COMMENT]) {
                // unmatched end comment!
                throw Error('Found end comment without a matching opening comment, as child of ' + node);
            } 
            return null;
        }
        return _nodeNextSibling;
    };

    const normaliseVirtualElementDomStructure = (elementVerified) => {
        // Workaround for https://github.com/SteveSanderson/knockout/issues/155
        // (IE <= 8 or IE 9 quirks mode parses your HTML weirdly, treating closing </li> tags as if they don't exist, thereby moving comment nodes
        // that are direct descendants of <ul> into the preceding <li>)
        const tagNameLower = elementVerified.tagName && elementVerified.tagName.toLowerCase();
        if (tagNameLower && !HTML_TAGS_WITH_OPTIONAL_CLOSING_CHILDREN[tagNameLower]) {
            return;
        }
        
        // Scan immediate children to see if they contain unbalanced comment tags. If they do, those comment tags
        // must be intended to appear *after* that child, so move them there.
        let childNode = elementVerified.firstChild;
        while (childNode) {
            if (childNode.nodeType === 1) {
                let unbalancedTags = _getUnbalancedChildTags(childNode);
                if (unbalancedTags) {
                    // Fix up the DOM by moving the unbalanced tags to where they most likely were intended to be placed - *after* the child
                    let nodeToInsertBefore = childNode.nextSibling;
                     for (let i = 0; i < unbalancedTags.length; i++) {
                        if (nodeToInsertBefore) {
                            elementVerified.insertBefore(unbalancedTags[i], nodeToInsertBefore);
                        } else {
                            elementVerified.appendChild(unbalancedTags[i]);
                        }
                    }
                }
            }
            childNode = childNode.nextSibling;
        }
    };

    // For any options that may affect various areas of Knockout and aren't directly associated with data binding.
    const options = {
        deferUpdates: false,
        useOnlyNativeEvents: false,
        foreachHidesDestroyed: false
    };

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

    const canSetPrototype = ({__proto__: []} instanceof Array);
        
    const hasOwnProperty = Object.prototype.hasOwnProperty;

    const objectForEach = (obj, action) => {
        if (obj) {
            for (let prop of Object.keys(obj)) {
                action(prop, obj[prop]);
            }
        }
    };

    const extend = Object.assign;

    const setPrototypeOf = (obj, proto)  => {
        obj.__proto__ = proto;
        return obj;
    };

    // shortcut for if (canSetPrototype) ... 
    const trySetPrototypeOf = canSetPrototype ? setPrototypeOf : () => null;

    const setPrototypeOfOrExtend = canSetPrototype ? setPrototypeOf : extend;

    const toggleObjectClassPropertyString = (obj, prop, classNames, shouldHaveClass) => {
        // obj/prop is either a node/'className' or a SVGAnimatedString/'baseVal'.
        let currentClassNames = obj[prop].match(CSS_CLASSNAME_REGEX) || [];
        for (let className of classNames.match(CSS_CLASSNAME_REGEX)) {
            addOrRemoveItem(currentClassNames, className, shouldHaveClass);
        }
        obj[prop] = currentClassNames.join(' ');
    };

    const toggleDomNodeCssClass = (node, classNames, shouldHaveClass) => {
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

    const fieldsIncludedWithJsonPost = ['authenticity_token', /^__RequestVerificationToken(_.*)?$/];

    const arrayForEach = (array, action, actionOwner) => {
        for (let i = 0, j = array.length; i < j; i++) {
            action.call(actionOwner, array[i], i, array);
        }
    };

    const arrayIndexOf = (array, item) => array.indexOf(item);

    const arrayFirst = function (array, predicate, predicateOwner) {
        for (let i = 0, j = array.length; i < j; i++) {
            if (predicate.call(predicateOwner, array[i], i, array)) {
                return array[i];
            }
        }
        return undefined;
    };

    const arrayRemoveItem = (array, itemToRemove) => {
        let index = (array && array.length) ? array.indexOf(itemToRemove) : -1;
        if (index === 0) {
            array.shift();
        } else if (index > 0) {
            array.splice(index, 1);
        }
    };

    const arrayGetDistinctValues = (array) => {
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

    const arrayMap = (array, mapping, mappingOwner) => {
        let result = [],
            nextIndex = 0;
        if (array) {
            for (let i = 0, j = array.length; i < j; i++) {
                result[nextIndex++] = mapping.call(mappingOwner, array[i], i);
            }
        }
        return result;
    };

    const arrayFilter = (array, predicate, predicateOwner) => {
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

    const arrayPushAll = (array, valuesToPush) => {
        for (let i = 0, targetIndex = array.length, len = valuesToPush.length; i < len; i++, targetIndex++) {
            array[targetIndex] = valuesToPush[i];
        }
        return array;
    };

    const peekObservable = (value) => isObservable(value) ? value.peek() : value;

    const addOrRemoveItem = (array, value, included) => {
        let existingEntryIndex = peekObservable(array).indexOf(value);
        if (existingEntryIndex < 0) {
            if (included) {
                array.push(value);
            }
        } else if (!included) {
            array.splice(existingEntryIndex, 1);
        }
    };

    const objectMap = (source, mapping, mappingOwner) => {
        if (!source) {
            return source;
        }
        let target = {};
        for (let prop of Object.keys(source)) {
            target[prop] = mapping.call(mappingOwner, source[prop], prop, source);
        }
        return target;
    };

    const moveCleanedNodesToContainerElement = (nodes) => {
        // Ensure it's a real array, as we're about to reparent the nodes and
        // we don't want the underlying collection to change while we're doing that.
        let nodesArray = [...nodes],
            templateDocument = (nodesArray[0] && nodesArray[0].ownerDocument) || document,
            container = templateDocument.createElement('div');
        
        for (let i = 0, j = nodesArray.length; i < j; i++) {
            container.appendChild(cleanNode(nodesArray[i]));
        }
        return container;
    };

    const cloneNodes = (nodesArray, shouldCleanNodes) => {
        let newNodesArray = [];
        for (let i = 0, j = nodesArray.length; i < j; i++) {
            let clonedNode = nodesArray[i].cloneNode(true);
            newNodesArray.push(shouldCleanNodes ? cleanNode(clonedNode) : clonedNode);
        }
        return newNodesArray;
    };

    const replaceDomNodes = (nodeToReplaceOrNodeArray, newNodesArray) => {
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

    const fixUpContinuousNodeArray = (continuousNodeArray, parentNode) => {
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

    const setOptionNodeSelectionState = (optionNode, isSelected) => optionNode.selected = isSelected;

    const stringTrim = (string) => (string === null || string === undefined) ? '' : 
                                           string.trim ? string.trim() : string.toString().trim();

    /** @deprecated */
    const stringStartsWith = (string, startsWith) => (string || '').startsWith(startsWith);

    const domNodeIsContainedBy = (node, containedByNode) => {
        if (node === containedByNode) {
            return true;
        }
        if (node.nodeType === 11) {
            return false; // Fixes issue #1162 - can't use node.contains for document fragments on IE8
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

    const domNodeIsAttachedToDocument = (node) => domNodeIsContainedBy(node, node.ownerDocument.documentElement);

    const anyDomNodeIsAttachedToDocument = (nodes) => !!arrayFirst(nodes, domNodeIsAttachedToDocument);

    // For HTML elements, tagName will always be upper case; for XHTML elements, it'll be lower case.
    // Possible future optimization: If we know it's an element from an XHTML document (not HTML),
    // we don't need to do the .toLowerCase() as it will always be lower case anyway.
    const tagNameLower = (element) => {
        let tagName = element && element.tagName;
        return tagName && tagName.toLowerCase();
    };

    const catchFunctionErrors = (delegate) => {
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

    const setTimeoutWithCatchError = (handler, timeout) => setTimeout(catchFunctionErrors(handler), timeout);

    const deferError = (error) => {
        setTimeout(() => {
            onError && onError(error);
            throw error;
        }, 0);
    };

    const valuesArePrimitiveAndEqual = (PRIMITIVE_TYPES => (a, b) => {
        let oldValueIsPrimitive = (a === null) || PRIMITIVE_TYPES[typeof a];
        return oldValueIsPrimitive ? (a === b) : false;
    })({'undefined': 1, 'boolean': 1, 'number': 1, 'string': 1});

    const registerEventHandler = (element, eventType, handler) => {
        if (typeof element.addEventListener === 'function') {
            element.addEventListener(eventType, catchFunctionErrors(handler), false);
            return;
        }
        throw new Error('Browser doesn\'t support addEventListener');
    };

    const triggerEvent = (element, eventType) => {
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

    const unwrapObservable = (value) => isObservable(value) ? value() : value;

    const setTextContent = (element, textContent) => {
        let value = unwrapObservable(textContent);
        if (value === null || value === undefined) {
            value = '';
        }

        // We need there to be exactly one child: a text node.
        // If there are no children, more than one, or if it's not a text node,
        // we'll clear everything and create a single text node.
        let innerTextNode = firstChild(element);
        if (!innerTextNode || innerTextNode.nodeType !== 3 || nextSibling(innerTextNode)) {
            setDomNodeChildren$1(element, [element.ownerDocument.createTextNode(value)]);
        } else {
            innerTextNode.data = value;
        }
    };

    /** @deprecated - too trivial*/
    const setElementName = (element, name) => element.name = name;

    const range = function (min, max) {
        let result = [];
        for (let i = unwrapObservable(min), max = unwrapObservable(max); i <= max; i++) {
            result.push(i);
        }
        return result;
    };

    /** @deprecated - modern ES has enough means to turn array-like structures into Arrays -> Array.from(), [...values] */
    const makeArray = (arrayLikeObject) => {
        let result = [];
        for (let i = 0, j = arrayLikeObject.length; i < j; i++) {
            result[i] = arrayLikeObject[i];
        }
        return result;
    };

    const createSymbolOrString = identifier => Symbol(identifier);

    const getFormFields = (form, fieldName) => {
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
    const stringifyJson = (data, replacer, space) => JSON.stringify(unwrapObservable(data), replacer, space);

    const postJson = function(urlOrForm, data, options) {
        options = options || {};
        let params = options['params'] || {},
            includeFields = options['includeFields'] || ko.utils.fieldsIncludedWithJsonPost,
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

    var utils = /*#__PURE__*/Object.freeze({
        __proto__: null,
        canSetPrototype: canSetPrototype,
        hasOwnProperty: hasOwnProperty,
        objectForEach: objectForEach,
        extend: extend,
        setPrototypeOf: setPrototypeOf,
        trySetPrototypeOf: trySetPrototypeOf,
        setPrototypeOfOrExtend: setPrototypeOfOrExtend,
        toggleObjectClassPropertyString: toggleObjectClassPropertyString,
        toggleDomNodeCssClass: toggleDomNodeCssClass,
        fieldsIncludedWithJsonPost: fieldsIncludedWithJsonPost,
        arrayForEach: arrayForEach,
        arrayIndexOf: arrayIndexOf,
        arrayFirst: arrayFirst,
        arrayRemoveItem: arrayRemoveItem,
        arrayGetDistinctValues: arrayGetDistinctValues,
        arrayMap: arrayMap,
        arrayFilter: arrayFilter,
        arrayPushAll: arrayPushAll,
        peekObservable: peekObservable,
        addOrRemoveItem: addOrRemoveItem,
        objectMap: objectMap,
        moveCleanedNodesToContainerElement: moveCleanedNodesToContainerElement,
        cloneNodes: cloneNodes,
        replaceDomNodes: replaceDomNodes,
        fixUpContinuousNodeArray: fixUpContinuousNodeArray,
        setOptionNodeSelectionState: setOptionNodeSelectionState,
        stringTrim: stringTrim,
        stringStartsWith: stringStartsWith,
        domNodeIsContainedBy: domNodeIsContainedBy,
        domNodeIsAttachedToDocument: domNodeIsAttachedToDocument,
        anyDomNodeIsAttachedToDocument: anyDomNodeIsAttachedToDocument,
        tagNameLower: tagNameLower,
        catchFunctionErrors: catchFunctionErrors,
        setTimeoutWithCatchError: setTimeoutWithCatchError,
        deferError: deferError,
        valuesArePrimitiveAndEqual: valuesArePrimitiveAndEqual,
        registerEventHandler: registerEventHandler,
        triggerEvent: triggerEvent,
        unwrapObservable: unwrapObservable,
        setTextContent: setTextContent,
        setElementName: setElementName,
        range: range,
        makeArray: makeArray,
        createSymbolOrString: createSymbolOrString,
        getFormFields: getFormFields,
        stringifyJson: stringifyJson,
        postJson: postJson
    });

    const _taskQueue = [];

    let _taskQueueLength = 0,
        _nextHandle = 1,
        _nextIndexToProcess = 0;

    let _scheduler;

    // allows for overriding the default scheduler by assigning 'ko.tasks.scheduler = someCustomScheduler' (see ko.js)
    const _overrideScheduler = newScheduler => {
        if (typeof newScheduler !== 'function') {
            throw new Error('Scheduler must be a function');    
        }
        _scheduler = newScheduler;
    };

    const _processTasks = () => {
        if (!_taskQueueLength) {
            return;
        }
        // Each mark represents the end of a logical group of tasks and the number of these groups is
        // limited to prevent unchecked recursion.
        let mark = _taskQueueLength, countMarks = 0;

        // _nextIndexToProcess keeps track of where we are in the queue; processTasks can be called recursively without issue
        for (let task; _nextIndexToProcess < _taskQueueLength;) {
            if (!(task = _taskQueue[_nextIndexToProcess++])) {
                continue;
            }
            if (_nextIndexToProcess > mark) {
                if (++countMarks >= 5000) {
                    _nextIndexToProcess = _taskQueueLength;   // skip all tasks remaining in the queue since any of them could be causing the recursion
                    deferError(Error("'Too much recursion' after processing " + countMarks + " task groups."));
                    break;
                }
                mark = _taskQueueLength;
            }
            try {
                task();
            } catch (ex) {
                deferError(ex);
            }
        }
    };

    const _scheduledProcess = () => {
        _processTasks();
        // Reset the queue
        _nextIndexToProcess = 0;
        _taskQueueLength = 0;
        _taskQueue.length = 0;
    };

    if (typeof MutationObserver !== 'undefined') {
        // Chrome 27+, Firefox 14+, IE 11+, Opera 15+, Safari 6.1+
        // From https://github.com/petkaantonov/bluebird * Copyright (c) 2014 Petka Antonov * License: MIT
        _scheduler = (callback => {
            let elem = document.createElement('b'),
                val = 1;
            new MutationObserver(callback).observe(elem, {attributes: true});
            return () => elem.title = (val = -val); // original classList.toggle is 60% slower in Chrome 85
        })(_scheduledProcess);

    } else if (typeof process === 'object') {
        // Running tests in NodeJS
        _scheduler = (callback) => setTimeout(callback, 0);
    } else {
        throw new Error('Browser is too old, does not know MutationObserver');
    }

    const scheduleTask = (func) => {
        if (!_taskQueueLength) {
            _scheduler(_scheduledProcess);
        }
        _taskQueue[_taskQueueLength++] = func;
        return _nextHandle++;
    };

    const cancelTask = (handle) => {
        let index = handle - (_nextHandle - _taskQueueLength);
        if (index >= _nextIndexToProcess && index < _taskQueueLength) {
            _taskQueue[index] = null;
        }
    };

    // For testing only: reset the queue and return the previous queue length
    const resetForTesting = () => {
        let length = _taskQueueLength - _nextIndexToProcess;
        _nextIndexToProcess = _taskQueueLength = _taskQueue.length = 0;
        return length;
    };

    const runEarly = _processTasks;

    const deferredExtender = (target, options) => {
        if (options !== true) {
            throw new Error('The \'deferred\' extender only accepts the value \'true\', because it is not supported to turn deferral off once enabled.');
        }
        if (target._deferUpdates) {
            return;
        }
        target._deferUpdates = true;
        target.limit(callback => {
            let ignoreUpdates = false,
                handle;

            return () => {
                if (ignoreUpdates) {
                    return;
                }
                cancelTask(handle);
                handle = scheduleTask(callback);

                try {
                    ignoreUpdates = true;
                    target.notifySubscribers(undefined, 'dirty');
                } finally {
                    ignoreUpdates = false;
                }
            };
        });
    };

    const extenders = Object.create(null);

    extenders.deferred = deferredExtender;

    function applyExtenders(requestedExtenders) {
        let target = this;
        if (requestedExtenders) {
            for (let key of Object.keys(requestedExtenders)) {
                let extenderHandler = extenders[key];
                if (typeof extenderHandler === 'function') {
                    target = extenderHandler(target, requestedExtenders[key]) || target;
                } else {
                    console.warn('Missing extender: ' + key);
                }
            }
        }
        return target;
    }

    const _throttle = (callback, timeout) => {
        let timeoutInstance;
        return () => {
            if (timeoutInstance) {
                return;
            }
            timeoutInstance = setTimeout(() => {
                timeoutInstance = undefined;
                callback();
            }, timeout);
        };
    };

    const _debounce = (callback, timeout) => {
        let timeoutInstance;
        return () => {
            clearTimeout(timeoutInstance);
            timeoutInstance = setTimeout(callback, timeout);
        };
    };

    extenders.rateLimit = (target, options) => {
        let timeout, 
            method, 
            limitFunction;

        if (typeof options === 'number') {
            timeout = options;
        } else {
            timeout = options.timeout;
            method = options.method;
        }

        // rateLimit supersedes deferred updates
        target._deferUpdates = false;

        limitFunction = (typeof method === 'function') ? method : (method === 'notifyWhenChangesStop') ? _debounce : _throttle;
        target.limit(callback => limitFunction(callback, timeout, options));
    };

    extenders.notify = (target, notifyWhen) => {
        // null equalityComparer means to always notify
        target.equalityComparer = (notifyWhen === 'always') ? null : valuesArePrimitiveAndEqual;
    };

    const defineThrottleExtender = (dependentObservable) => {
        extenders.throttle = (target, timeout) => {
            // Throttling means two things:

            // (1) For dependent observables, we throttle *evaluations* so that, no matter how fast its dependencies
            //     notify updates, the target doesn't re-evaluate (and hence doesn't notify) faster than a certain rate
            target.throttleEvaluation = timeout;

            // (2) For writable targets (observables, or writable dependent observables), we throttle *writes*
            //     so the target cannot change value synchronously or faster than a certain rate
            let writeTimeoutInstance = null;
            return dependentObservable({
                read: target,
                write(value) {
                    clearTimeout(writeTimeoutInstance);
                    writeTimeoutInstance = setTimeout(() => target(value), timeout);
                }
            });
        };
    };

    class Subscription {
        
        constructor(target, callback, disposeCallback) {
            this._target = target;
            this._callback = callback;
            this._disposeCallback = disposeCallback;
            this._isDisposed = false;
            this._node = null;
            this._domNodeDisposalCallback = null;
        }
        
        dispose() {
            if (this._isDisposed) {
                return;
            }
            if (this._domNodeDisposalCallback) {
                removeDisposeCallback(this._node, this._domNodeDisposalCallback);
            }
            this._isDisposed = true;
            this._disposeCallback();
            this._target = this._callback = this._disposeCallback = this._node = this._domNodeDisposalCallback = null;
        }
        
        disposeWhenNodeIsRemoved(node) {
            this._node = node;
            addDisposeCallback(node, this._domNodeDisposalCallback = this.dispose.bind(this));
        }
    }

    const DEFAULT_EVENT = 'change';

    // Moved out of "limit" to avoid the extra closure
    function _limitNotifySubscribers(value, event) {
        if (!event || event === DEFAULT_EVENT) {
            this._limitChange(value);
        } else if (event === 'beforeChange') {
            this._limitBeforeChange(value);
        } else {
            this._origNotifySubscribers(value, event);
        }
    }

    const SUBSCRIBABLE_PROTOTYPE = {
        [IS_SUBSCRIBABLE]: true,
        
        init(instance) {
            instance._subscriptions = {change: []}; // cleaner but slower would be { [DEFAULT_EVENT]: [] } 
            instance._versionNumber = 1;
        },

        subscribe(callback, callbackTarget, event) {
            event = event || DEFAULT_EVENT;
            let boundCallback = callbackTarget ? callback.bind(callbackTarget) : callback;

            let subscription = new Subscription(this, boundCallback, () => {
                let _subscriptions = this._subscriptions[event],
                    foundIndex = _subscriptions.indexOf(subscription);
                if (foundIndex >= 0) {
                    _subscriptions.splice(foundIndex, 1);
                }
                if (this.afterSubscriptionRemove) {
                    this.afterSubscriptionRemove(event);
                }
            });

            if (this.beforeSubscriptionAdd) {
                this.beforeSubscriptionAdd(event);
            }
            let _subscriptions = this._subscriptions,
                existingSubscriptionsForEvent = _subscriptions[event]; 
            if (existingSubscriptionsForEvent) {
                existingSubscriptionsForEvent.push(subscription);
            } else {
                _subscriptions[event] = [subscription];
            }
            return subscription;
        },

        notifySubscribers(valueToNotify, event) {
            event = event || DEFAULT_EVENT;
            if (event === DEFAULT_EVENT) {
                this.updateVersion();
            }
            if (!this.hasSubscriptionsForEvent(event)) {
                return;
            }
            let subs = event === DEFAULT_EVENT && this._changeSubscriptions || this._subscriptions[event].slice();
            try {
                beginDependencyDetection(); // Begin suppressing dependency detection (by setting the top frame to undefined)
                for (let i = 0, subscription; subscription = subs[i]; ++i) {
                    // In case a subscription was disposed during the arrayForEach cycle, check
                    // for isDisposed on each subscription before invoking its callback
                    if (!subscription._isDisposed) {
                        subscription._callback(valueToNotify);
                    }
                }
            } finally {
                endDependencyDetection(); // End suppressing dependency detection
            }
        },

        getVersion() {
            return this._versionNumber;
        },

        hasChanged(versionToCheck) {
            // Do NOT shortcut to this._versionNumber!
            return this.getVersion() !== versionToCheck;
        },

        updateVersion() {
            ++this._versionNumber;
        },

        limit(limitFunction) {
            let selfIsObservable = isObservable(this),
                ignoreBeforeChange, 
                notifyNextChange, 
                previousValue, 
                pendingValue, 
                didUpdate,
                beforeChange = 'beforeChange';

            if (!this._origNotifySubscribers) {
                this._origNotifySubscribers = this.notifySubscribers;
                this.notifySubscribers = _limitNotifySubscribers;
            }

            let finish = limitFunction(() => {
                this._notificationIsPending = false;

                // If an observable provided a reference to itself, access it to get the latest value.
                // This allows computed observables to delay calculating their value until needed.
                if (selfIsObservable && pendingValue === this) {
                    pendingValue = this._evalIfChanged ? this._evalIfChanged() : this();
                }
                let shouldNotify = notifyNextChange || (didUpdate && (!this.equalityComparer || !this.equalityComparer(previousValue, pendingValue)));

                didUpdate = notifyNextChange = ignoreBeforeChange = false;

                if (shouldNotify) {
                    this._origNotifySubscribers(previousValue = pendingValue);
                }
            });

            this._limitChange = (value, isDirty) => {
                if (!isDirty || !this._notificationIsPending) {
                    didUpdate = !isDirty;
                }
                this._changeSubscriptions = this._subscriptions[DEFAULT_EVENT].slice();
                this._notificationIsPending = ignoreBeforeChange = true;
                pendingValue = value;
                finish();
            };
            this._limitBeforeChange = (value) => {
                if (!ignoreBeforeChange) {
                    previousValue = value;
                    this._origNotifySubscribers(value, beforeChange);
                }
            };
            this._recordUpdate = () => didUpdate = true;

            this._notifyNextChangeIfValueIsDifferent = () => {
                let equalityComparer = this.equalityComparer;
                if (!equalityComparer || !equalityComparer(previousValue, this.peek(true /*evaluate*/))) {
                    notifyNextChange = true;
                }
            };
        },

        hasSubscriptionsForEvent(event) {
            let subscriptions = this._subscriptions[event]; 
            return subscriptions && subscriptions.length;
        },

        getSubscriptionsCount(event) {
            let event2subscriptions = this._subscriptions;
            if (event) {
                let subscriptions = event2subscriptions[event]; 
                return subscriptions ? subscriptions.length : 0;
            }
            let total = 0;
            if (event2subscriptions) {
                for (let eventName of Object.keys(event2subscriptions)) {
                    let subscriptions = event2subscriptions[eventName];
                    if (eventName !== 'dirty') {
                        total += subscriptions.length;
                    }
                }
            }
            return total;
        },

        // /** @deprecated */
        // isDifferent(oldValue, newValue) {
        //     return !this.equalityComparer || !this.equalityComparer(oldValue, newValue);
        // },

        toString() {
          return '[object Object]';
        },

        extend: applyExtenders
    };

    /**
     * @constructor
     */
    const Subscribable = function () {
        SUBSCRIBABLE_PROTOTYPE.init(this);
    };

    Subscribable.prototype = SUBSCRIBABLE_PROTOTYPE;
    Subscribable.fn = SUBSCRIBABLE_PROTOTYPE;

    // For browsers that support proto assignment, we overwrite the prototype of each
    // observable instance. Since observables are functions, we need Function.prototype
    // to still be in the prototype chain.
    trySetPrototypeOf(SUBSCRIBABLE_PROTOTYPE, Function.prototype);

    const COMPUTED_STATE = Symbol('_state');

    function computed(evaluatorFunctionOrOptions, evaluatorFunctionTarget, options$1) {
        if (typeof evaluatorFunctionOrOptions === "object") {
            // Single-parameter syntax - everything is on this "options" param
            options$1 = evaluatorFunctionOrOptions;
        } else {
            // Multi-parameter syntax - construct the options according to the params passed
            options$1 = options$1 || {};
            if (evaluatorFunctionOrOptions) {
                options$1.read = evaluatorFunctionOrOptions;
            }
        }
        if (typeof options$1.read !== 'function') {
            throw Error("Pass a function that returns the value of the ko.computed");
        }

        let writeFunction = options$1.write,
            state = {
                latestValue: undefined,
                isStale: true,
                isDirty: true,
                isBeingEvaluated: false,
                suppressDisposalUntilDisposeWhenReturnsFalse: false,
                isDisposed: false,
                pure: false,
                isSleeping: false,
                readFunction: options$1.read,
                evaluatorFunctionTarget: evaluatorFunctionTarget || options$1.owner,
                disposeWhenNodeIsRemoved: options$1.disposeWhenNodeIsRemoved || options$1.disposeWhenNodeIsRemoved || null,
                disposeWhen: options$1.disposeWhen,
                domNodeDisposalCallback: null,
                dependencyTracking: {},
                dependenciesCount: 0,
                evaluationTimeoutInstance: null
            };

        function _computedObservable() {
            if (arguments.length) {
                if (typeof writeFunction === 'function') {
                    // Writing a value
                    writeFunction.apply(state.evaluatorFunctionTarget, arguments);
                    return this; // Permits chained assignments
                } 
                throw new Error("Cannot write a value to a ko.computed unless you specify a 'write' option. If you wish to read the current value, don't pass any parameters.");
            } 
            // Reading the value
            if (!state.isDisposed) {
                registerDependency(_computedObservable);
            }
            if (state.isDirty || (state.isSleeping && _computedObservable.haveDependenciesChanged())) {
                _computedObservable.evaluateImmediate();
            }
            return state.latestValue;
        }

        _computedObservable[COMPUTED_STATE] = state;
        _computedObservable.hasWriteFunction = typeof writeFunction === 'function';
        
        // Inherit from './subscribable.js'
        if (!canSetPrototype) {
            // 'subscribable' won't be on the prototype chain unless we put it there directly
            Object.assign(_computedObservable, SUBSCRIBABLE_PROTOTYPE);
        }
        SUBSCRIBABLE_PROTOTYPE.init(_computedObservable);

        // Inherit from './computed.js'
        setPrototypeOfOrExtend(_computedObservable, COMPUTED_PROTOTYPE);

        if (options$1.pure) {
            _computedObservable[IS_PURE_COMPUTED] = true;
            state.pure = true;
            state.isSleeping = true;     // Starts off sleeping; will awake on the first subscription
            Object.assign(_computedObservable, pureComputedOverrides);
        } else if (options$1.deferEvaluation) {
            Object.assign(_computedObservable, deferEvaluationOverrides);
        }

        if (options.deferUpdates) {
            deferredExtender(_computedObservable, true);
        }

        if (DEBUG) {
            // #1731 - Aid debugging by exposing the computed's options
            _computedObservable._options = options$1;
        }

        let __disposeWhenNodeIsRemoved = state.disposeWhenNodeIsRemoved; 
        
        if (__disposeWhenNodeIsRemoved) {
            // Since this computed is associated with a DOM node, and we don't want to dispose the computed
            // until the DOM node is *removed* from the document (as opposed to never having been in the document),
            // we'll prevent disposal until "disposeWhen" first returns false.
            state.suppressDisposalUntilDisposeWhenReturnsFalse = true;

            // disposeWhenNodeIsRemoved: true can be used to opt into the "only dispose after first false result"
            // behaviour even if there's no specific node to watch. In that case, clear the option so we don't try
            // to watch for a non-node's disposal. This technique is intended for KO's internal use only and shouldn't
            // be documented or used by application code, as it's likely to change in a future version of KO.
            if (!__disposeWhenNodeIsRemoved.nodeType) {
                state.disposeWhenNodeIsRemoved = null;
            }
        }

        // Evaluate, unless sleeping or deferEvaluation is true
        if (!state.isSleeping && !options$1.deferEvaluation) {
            _computedObservable.evaluateImmediate();
        }

        // Attach a DOM node disposal callback so that the computed will be proactively disposed as soon as the node is
        // removed using ko.removeNode. But skip if isActive is false (there will never be any dependencies to dispose).
        __disposeWhenNodeIsRemoved = state.disposeWhenNodeIsRemoved;
        if (__disposeWhenNodeIsRemoved && _computedObservable.isActive()) {
            addDisposeCallback(__disposeWhenNodeIsRemoved, state.domNodeDisposalCallback = () => _computedObservable.dispose());
        }

        return _computedObservable;
    }

    // This function gets called each time a dependency is detected while evaluating a computed.
    // It's factored out as a shared function to avoid creating unnecessary function instances during evaluation.
    function computedBeginDependencyDetectionCallback(subscribable, id) {
        let computedObservable = this.computedObservable,
            state = computedObservable[COMPUTED_STATE];
        
        if (!state.isDisposed) {
            let __disposalCandidate = this.disposalCount && this.disposalCandidates[id];
            if (__disposalCandidate) {
                // Don't want to dispose this subscription, as it's still being used
                computedObservable.addDependencyTracking(id, subscribable, __disposalCandidate);
                this.disposalCandidates[id] = null; // No need to actually delete the property - disposalCandidates is a transient object anyway
                --this.disposalCount;
            } else if (!state.dependencyTracking[id]) {
                // Brand new subscription - add it
                computedObservable.addDependencyTracking(id, subscribable, state.isSleeping ? {_target: subscribable} : computedObservable.subscribeToDependency(subscribable));
            }
            // If the observable we've accessed has a pending notification, ensure we get notified of the actual final value (bypass equality checks)
            if (subscribable._notificationIsPending) {
                subscribable._notifyNextChangeIfValueIsDifferent();
            }
        }
    }

    const COMPUTED_PROTOTYPE = {
        [IS_OBSERVABLE]: true,
        [IS_COMPUTED]: true,
        equalityComparer: valuesArePrimitiveAndEqual,
        
        getDependenciesCount() {
            return this[COMPUTED_STATE].dependenciesCount;
        },
        getDependencies() {
            let dependencyTracking = this[COMPUTED_STATE].dependencyTracking,
                dependentObservables = [];
            
            if (dependencyTracking) {
                for (let id of Object.keys(dependencyTracking)) {
                    let dependency = dependencyTracking[id];
                    dependentObservables[dependency._order] = dependency._target;
                }
            }
            return dependentObservables;
        },
        hasAncestorDependency(obs) {
            let computedState = this[COMPUTED_STATE];
            if (!computedState.dependenciesCount) {
                return false;
            }
            /**
             * Given how often this method is called and regarding its recursive nature,
             * let's forget DRY for a sec & pull a copy of `getDependencies` right here..
             */
            let dependencyTracking = computedState.dependencyTracking;
            if (!dependencyTracking) {
                return false;
            }
            let dependentObservables = [];
            
            for (let id of Object.keys(dependencyTracking)) {
                let dependency = dependencyTracking[id];
                dependentObservables[dependency._order] = dependency._target;
            }
            return dependentObservables.includes(obs) || !!dependentObservables.find(dep => dep.hasAncestorDependency && dep.hasAncestorDependency(obs));
        },
        addDependencyTracking(id, target, trackingObj) {
            let computedState = this[COMPUTED_STATE]; 
            if (computedState.pure && target === this) {
                throw Error("A 'pure' computed must not be called recursively");
            }
            computedState.dependencyTracking[id] = trackingObj;
            trackingObj._order = computedState.dependenciesCount++;
            trackingObj._version = target.getVersion();
        },
        haveDependenciesChanged() {
            let dependencyTracking = this[COMPUTED_STATE].dependencyTracking;
            if (dependencyTracking) {
                let hasEvalDelayed = this._evalDelayed;
                for (let id of Object.keys(dependencyTracking)) {
                    let dependency = dependencyTracking[id],
                        depTarget = dependency._target;
                    if ((hasEvalDelayed && depTarget._notificationIsPending) || depTarget.hasChanged(dependency._version)) {
                        return true;
                    }
                }
            }
            return false;
        },
        markDirty() {
            let __evalDelayed = this._evalDelayed;
            // Process "dirty" events if we can handle delayed notifications
            if (__evalDelayed && !this[COMPUTED_STATE].isBeingEvaluated) {
                __evalDelayed(false /*isChange*/);
            }
        },
        isActive() {
            let state = this[COMPUTED_STATE];
            return state.isDirty || state.dependenciesCount > 0;
        },
        respondToChange() {
            // Ignore "change" events if we've already scheduled a delayed notification
            if (!this._notificationIsPending) {
                this.evaluatePossiblyAsync();
                return;
            }
            let computedState = this[COMPUTED_STATE];
            if (computedState.isDirty) {
                computedState.isStale = true;
            }
        },
        subscribeToDependency(target) {
            if (target._deferUpdates) {
                let dirtySub = target.subscribe(this.markDirty, this, 'dirty'),
                    changeSub = target.subscribe(this.respondToChange, this);
                return {
                    _target: target,
                    dispose: () => {
                        dirtySub.dispose();
                        changeSub.dispose();
                    }
                };
            }
            return target.subscribe(this.evaluatePossiblyAsync, this);
        },
        evaluatePossiblyAsync() {
            let computedObservable = this,
                throttleEvaluationTimeout = computedObservable.throttleEvaluation;
            
            if (throttleEvaluationTimeout && throttleEvaluationTimeout >= 0) {
                let computedState = this[COMPUTED_STATE]; 
                clearTimeout(computedState.evaluationTimeoutInstance);
                computedState.evaluationTimeoutInstance = setTimeout(() => computedObservable.evaluateImmediate(true /*notifyChange*/), throttleEvaluationTimeout);
            } else if (computedObservable._evalDelayed) {
                computedObservable._evalDelayed(true /*isChange*/);
            } else {
                computedObservable.evaluateImmediate(true /*notifyChange*/);
            }
        },
        evaluateImmediate(notifyChange) {
            let computedObservable = this,
                state = computedObservable[COMPUTED_STATE],
                disposeWhen = state.disposeWhen,
                changed = false;

            if (state.isBeingEvaluated) {
                // If the evaluation of a ko.computed causes side effects, it's possible that it will trigger its own re-evaluation.
                // This is not desirable (it's hard for a developer to realise a chain of dependencies might cause this, and they almost
                // certainly didn't intend infinite re-evaluations). So, for predictability, we simply prevent ko.computeds from causing
                // their own re-evaluation. Further discussion at https://github.com/SteveSanderson/knockout/pull/387
                return;
            }

            // Do not evaluate (and possibly capture new dependencies) if disposed
            if (state.isDisposed) {
                return;
            }

            if (state.disposeWhenNodeIsRemoved && !domNodeIsAttachedToDocument(state.disposeWhenNodeIsRemoved) || disposeWhen && disposeWhen()) {
                // See comment above about suppressDisposalUntilDisposeWhenReturnsFalse
                if (!state.suppressDisposalUntilDisposeWhenReturnsFalse) {
                    computedObservable.dispose();
                    return;
                }
            } else {
                // It just did return false, so we can stop suppressing now
                state.suppressDisposalUntilDisposeWhenReturnsFalse = false;
            }

            state.isBeingEvaluated = true;
            try {
                changed = this.evaluateImmediate_CallReadWithDependencyDetection(notifyChange);
            } finally {
                state.isBeingEvaluated = false;
            }

            return changed;
        },
        evaluateImmediate_CallReadWithDependencyDetection(notifyChange) {  // eslint-disable-line camelcase
            // This function is really just part of the evaluateImmediate logic. You would never call it from anywhere else.
            // Factoring it out into a separate function means it can be independent of the try/catch block in evaluateImmediate,
            // which contributes to saving about 40% off the CPU overhead of computed evaluation (on V8 at least).

            let computedObservable = this,
                state = computedObservable[COMPUTED_STATE],
                changed = false;

            // Initially, we assume that none of the subscriptions are still being used (i.e., all are candidates for disposal).
            // Then, during evaluation, we cross off any that are in fact still being used.
            let isInitial = state.pure ? undefined : !state.dependenciesCount,   // If we're evaluating when there are no previous dependencies, it must be the first time
                dependencyDetectionContext = {
                    computedObservable,
                    disposalCandidates: state.dependencyTracking,
                    disposalCount: state.dependenciesCount
                };

            beginDependencyDetection({
                callbackTarget: dependencyDetectionContext,
                callback: computedBeginDependencyDetectionCallback,
                computed: computedObservable,
                isInitial
            });

            // TODO check: Map might be more efficient (at least in Chrome, how about firefox?)
            state.dependencyTracking = {};
            state.dependenciesCount = 0;

            let newValue = this.evaluateImmediate_CallReadThenEndDependencyDetection(state, dependencyDetectionContext);

            if (!state.dependenciesCount) {
                computedObservable.dispose();
                changed = true; // When evaluation causes a disposal, make sure all dependent computeds get notified so they'll see the new state
            } else {
                let equalityComparer = computedObservable.equalityComparer;
                changed = !equalityComparer || !equalityComparer(state.latestValue, newValue);
            }

            if (changed) {
                if (!state.isSleeping) {
                    computedObservable.notifySubscribers(state.latestValue, "beforeChange");
                } else {
                    computedObservable.updateVersion();
                }

                state.latestValue = newValue;
                if (DEBUG) {
                    computedObservable._latestValue = newValue;
                }

                computedObservable.notifySubscribers(state.latestValue, "spectate");

                if (!state.isSleeping && notifyChange) {
                    computedObservable.notifySubscribers(state.latestValue);
                }
                if (computedObservable._recordUpdate) {
                    computedObservable._recordUpdate();
                }
            }

            if (isInitial) {
                computedObservable.notifySubscribers(state.latestValue, "awake");
            }

            return changed;
        },
        evaluateImmediate_CallReadThenEndDependencyDetection(state, dependencyDetectionContext) {  // eslint-disable-line camelcase
            // This function is really part of the evaluateImmediate_CallReadWithDependencyDetection logic.
            // You'd never call it from anywhere else. Factoring it out means that evaluateImmediate_CallReadWithDependencyDetection
            // can be independent of try/finally blocks, which contributes to saving about 40% off the CPU
            // overhead of computed evaluation (on V8 at least).

            try {
                let readFunction = state.readFunction;
                return state.evaluatorFunctionTarget ? readFunction.call(state.evaluatorFunctionTarget) : readFunction();
            } finally {
                endDependencyDetection();

                // For each subscription no longer being used, remove it from the active subscriptions list and dispose it
                if (dependencyDetectionContext.disposalCount && !state.isSleeping) {
                    for (let entryToDispose of Object.values(dependencyDetectionContext.disposalCandidates)) {
                        if (entryToDispose && entryToDispose.dispose) {
                            entryToDispose.dispose();
                        }
                    }
                }

                state.isStale = state.isDirty = false;
            }
        },
        peek(evaluate) {
            // By default, peek won't re-evaluate, except while the computed is sleeping or to get the initial value when "deferEvaluation" is set.
            // Pass in true to evaluate if needed.
            let state = this[COMPUTED_STATE];
            if ((state.isDirty && (evaluate || !state.dependenciesCount)) || (state.isSleeping && this.haveDependenciesChanged())) {
                this.evaluateImmediate();
            }
            return state.latestValue;
        },
        limit(limitFunction) {
            // Override the limit function with one that delays evaluation as well
            SUBSCRIBABLE_PROTOTYPE.limit.call(this, limitFunction);
            this._evalIfChanged = () => {
                let computedState = this[COMPUTED_STATE];
                if (!computedState.isSleeping) {
                    if (computedState.isStale) {
                        this.evaluateImmediate();
                    } else {
                        computedState.isDirty = false;
                    }
                }
                return computedState.latestValue;
            };
            this._evalDelayed = (isChange) => {
                let computedState = this[COMPUTED_STATE];
                this._limitBeforeChange(computedState.latestValue);

                // Mark as dirty
                computedState.isDirty = true;
                if (isChange) {
                    computedState.isStale = true;
                }
                // Pass the observable to the "limit" code, which will evaluate it when
                // it's time to do the notification.
                this._limitChange(this, !isChange /* isDirty */);
            };
        },
        dispose() {
            let state = this[COMPUTED_STATE];
            if (!state.isSleeping) {
                let __depTracking = state.dependencyTracking;
                if (__depTracking) {
                    for (let id of Object.keys(__depTracking)) {
                        let dep = __depTracking[id];
                        if (dep.dispose) {
                            dep.dispose();
                        }
                    }
                }
            }
            if (state.disposeWhenNodeIsRemoved && state.domNodeDisposalCallback) {
                removeDisposeCallback(state.disposeWhenNodeIsRemoved, state.domNodeDisposalCallback);
            }
            state.dependencyTracking = undefined;
            state.dependenciesCount = 0;
            state.isDisposed = true;
            state.isStale = false;
            state.isDirty = false;
            state.isSleeping = false;
            state.disposeWhenNodeIsRemoved = undefined;
            state.disposeWhen = undefined;
            state.readFunction = undefined;
            if (!this.hasWriteFunction) {
                state.evaluatorFunctionTarget = undefined;
            }
        }
    };

    const pureComputedOverrides = {
        beforeSubscriptionAdd(event) {
            // If asleep, wake up the computed by subscribing to any dependencies.
            let computedObservable = this,
                state = computedObservable[COMPUTED_STATE];
            if (!state.isDisposed && state.isSleeping && event === 'change') {
                state.isSleeping = false;
                if (state.isStale || computedObservable.haveDependenciesChanged()) {
                    state.dependencyTracking = null;
                    state.dependenciesCount = 0;
                    if (computedObservable.evaluateImmediate()) {
                        computedObservable.updateVersion();
                    }
                } else {
                    // First put the dependencies in order
                    let dependenciesOrder = [],
                        __dependencyTracking = state.dependencyTracking;
                    
                    if (__dependencyTracking) {
                        for (let id of Object.keys(__dependencyTracking)) {
                            dependenciesOrder[__dependencyTracking[id]._order] = id;
                        }
                    }
                    
                    // Next, subscribe to each one
                    dependenciesOrder.forEach((id, order) => {
                        let dependency = __dependencyTracking[id],
                            subscription = computedObservable.subscribeToDependency(dependency._target);
                        subscription._order = order;
                        subscription._version = dependency._version;
                        __dependencyTracking[id] = subscription;
                    });
                    
                    // Waking dependencies may have triggered effects
                    if (computedObservable.haveDependenciesChanged()) {
                        if (computedObservable.evaluateImmediate()) {
                            computedObservable.updateVersion();
                        }
                    }
                }

                if (!state.isDisposed) {     // test since evaluating could trigger disposal
                    computedObservable.notifySubscribers(state.latestValue, "awake");
                }
            }
        },
        afterSubscriptionRemove(event) {
            let state = this[COMPUTED_STATE];
            if (!state.isDisposed && event === 'change' && !this.hasSubscriptionsForEvent('change')) {
                let __dependencyTracking = state.dependencyTracking;
                if (__dependencyTracking) {
                    for (let id of Object.keys(__dependencyTracking)) {
                        let dependency = __dependencyTracking[id];
                        if (dependency.dispose) {
                            __dependencyTracking[id] = {
                                _target: dependency._target,
                                _order: dependency._order,
                                _version: dependency._version
                            };
                            dependency.dispose();
                        }
                    }
                }
                state.isSleeping = true;
                this.notifySubscribers(undefined, "asleep");
            }
        },
        getVersion() {
            // Because a pure computed is not automatically updated while it is sleeping, we can't
            // simply return the version number. Instead, we check if any of the dependencies have
            // changed and conditionally re-evaluate the computed observable.
            let state = this[COMPUTED_STATE];
            if (state.isSleeping && (state.isStale || this.haveDependenciesChanged())) {
                this.evaluateImmediate();
            }
            return SUBSCRIBABLE_PROTOTYPE.getVersion.call(this);
        }
    };

    const deferEvaluationOverrides = {
        beforeSubscriptionAdd(event) {
            // This will force a computed with deferEvaluation to evaluate when the first subscription is registered.
            if (event === 'change' || event === 'beforeChange') {
                this.peek();
            }
        }
    };

    // Note that for browsers that don't support proto assignment, the
    // inheritance chain is created manually in the ko.computed constructor
    trySetPrototypeOf(COMPUTED_PROTOTYPE, SUBSCRIBABLE_PROTOTYPE);

    // const PROTO_PROPERTY = ko.observable.protoProperty; // already defined in observable.js 

    computed.fn = COMPUTED_PROTOTYPE;

    const dependentObservable = computed;

    defineThrottleExtender(dependentObservable);

    const pureComputed = function (evaluatorFunctionOrOptions, evaluatorFunctionTarget) {
        if (typeof evaluatorFunctionOrOptions === 'function') {
            return computed(evaluatorFunctionOrOptions, evaluatorFunctionTarget, {pure: true});
        } 
        evaluatorFunctionOrOptions = Object.assign({}, evaluatorFunctionOrOptions); // make a copy of the parameter object
        evaluatorFunctionOrOptions.pure = true;
        return computed(evaluatorFunctionOrOptions, evaluatorFunctionTarget);
    };

    const bindingHandlers = Object.create(null);

    // Use an overridable method for retrieving binding handlers so that plugins may support dynamically created handlers
    let getBindingHandler = bindingKey => bindingHandlers[bindingKey];

    const _overrideGetBindingHandler = (fn) => getBindingHandler = fn;

    const JS_RESERVED_WORDS = {'true': true, 'false': true, 'null': true, 'undefined': true};

    const PROPERTY_WRITERS_BINDING_KEY = '_ko_property_writers';

    /**
     * Matches something that can be assigned to--either an isolated identifier or something ending with a property accessor
     * This is designed to be simple and avoid false negatives, but could produce false positives (e.g., a+b.c).
     * This also will not properly handle nested brackets (e.g., obj1[obj2['prop']]; see #911).
     * */
    const JS_ASSIGNMENT_TARGET = /^(?:[$_a-z][$\w]*|(.+)(\.\s*[$_a-z][$\w]*|\[.+]))$/i;

    // The following regular expressions will be used to split an object-literal string into tokens

    /** These characters have special meaning to the parser and must not appear in the middle of a token, except as part of a string. */
    const SPECIALS = ',"\'`{}()/:[\\]';

    /** The actual regular expression by or-ing the following regex strings. The order is important. */
    const BINDING_TOKEN = RegExp([
        // These match strings, either with double quotes, single quotes, or backticks
        '"(?:\\\\.|[^"])*"',
        "'(?:\\\\.|[^'])*'",
        "`(?:\\\\.|[^`])*`",
        // Match C style comments
        "/\\*(?:[^*]|\\*+[^*/])*\\*+/",
        // Match C++ style comments
        "//.*\n",
        // Match a regular expression (text enclosed by slashes), but will also match sets of divisions
        // as a regular expression (this is handled by the parsing loop below).
        '/(?:\\\\.|[^/])+/\\w*',
        // Match text (at least two characters) that does not contain any of the above special characters,
        // although some of the special characters are allowed to start it (all but the colon and comma).
        // The text can contain spaces, but leading or trailing spaces are skipped.
        '[^\\s:,/][^' + SPECIALS + ']*[^\\s' + SPECIALS + ']',
        // Match any non-space character not matched already. This will match colons and commas, since they're
        // not matched by "everyThingElse", but will also match any other single character that wasn't already
        // matched (for example: in "a: 1, b: 2", each of the non-space characters will be matched by oneNotSpace).
        '[^\\s]'
    ].join('|'), 'g');

    // Match end of previous token to determine whether a slash is a division or regex.
    const DIVISION_LOOK_BEHIND = /[\])"'A-Za-z0-9_$]+$/;
    const KEYWORD_REGEX_LOOK_BEHIND = {'in': 1, 'return': 1, 'typeof': 1};

    const parseObjectLiteral = (objectLiteralString) => {
        // Trim leading and trailing spaces from the string
        let str = objectLiteralString ? objectLiteralString.trim() : '';

        // Trim braces '{' surrounding the whole object literal
        if (str && str[0] === '{') {
            str = str.slice(1, -1);
        }

        // Add a newline to correctly match a C++ style comment at the end of the string and
        // add a comma so that we don't need a separate code block to deal with the last item
        str += "\n,";

        // Split into tokens
        let result = [],
            tokens = str.match(BINDING_TOKEN);

        if (tokens.length > 1) {
            let depth = 0;
            for (let i = 0, tok, key = null, values = []; tok = tokens[i]; ++i) {
                let c = tok.charCodeAt(0);
                // A comma signals the end of a key/value pair if depth is zero
                if (c === 44) { // ","
                    if (depth <= 0) {
                        result.push((key && values.length) ? {key, value: values.join('')} :
                            {unknown: key || values.join('')});
                        key = 0;
                        depth = 0;
                        values = [];
                        continue;
                    }
                    // Simply skip the colon that separates the name and value
                } else if (c === 58) { // ":"
                    if (!depth && !key && values.length === 1) {
                        key = values.pop();
                        continue;
                    }
                    // Comments: skip them
                } else if (c === 47 && tok.length > 1 && (tok.charCodeAt(1) === 47 || tok.charCodeAt(1) === 42)) {  // "//" or "/*"
                    continue;
                    // A set of slashes is initially matched as a regular expression, but could be division
                } else if (c === 47 && i && tok.length > 1) {  // "/"
                    // Look at the end of the previous token to determine if the slash is actually division
                    let match = tokens[i - 1].match(DIVISION_LOOK_BEHIND);
                    if (match && !KEYWORD_REGEX_LOOK_BEHIND[match[0]]) {
                        // The slash is actually a division punctuator; re-parse the remainder of the string (not including the slash)
                        str = str.substr(str.indexOf(tok) + 1);
                        tokens = str.match(BINDING_TOKEN);
                        i = -1;
                        // Continue with just the slash
                        tok = '/';
                    }
                    // Increment depth for parentheses, braces, and brackets so that interior commas are ignored
                } else if (c === 40 || c === 123 || c === 91) { // '(', '{', '['
                    ++depth;
                } else if (c === 41 || c === 125 || c === 93) { // ')', '}', ']'
                    --depth;
                    // The key will be the first token; if it's a string, trim the quotes
                } else if (!key && !values.length && (c === 34 || c === 39)) { // '"', "'"
                    tok = tok.slice(1, -1);
                }
                values.push(tok);
            }
            if (depth > 0) {
                throw Error("Unbalanced parentheses, braces, or brackets");
            }
        }
        return result;
    };

    // Two-way bindings include a write function that allow the handler to update the value even if it's not an observable.
    const twoWayBindings = {};

    const preProcessBindings = (bindingsStringOrKeyValueArray, bindingOptions) => {
        bindingOptions = bindingOptions || {};

        const _processKeyValue = (key, val) => {
            const _callPreprocessHook = (obj) => (obj && obj.preprocess) ? (val = obj.preprocess(val, key, _processKeyValue)) : true;

            if (!bindingParams) {
                if (!_callPreprocessHook(getBindingHandler(key))) {
                    return;
                }

                let twoWayBindingsValue = twoWayBindings[key],
                    match = twoWayBindingsValue && !JS_RESERVED_WORDS[val] && val.match(JS_ASSIGNMENT_TARGET);
                if (match) {
                    let writableVal = match[1] ? ('Object(' + match[1] + ')' + match[2]) : val;
                    // For two-way bindings, provide a write method in case the value
                    // isn't a writable observable.
                    let writeKey = typeof twoWayBindingsValue === 'string' ? twoWayBindingsValue : key;
                    propertyAccessorResultStrings.push("'" + writeKey + "':function(_z){" + writableVal + "=_z}");
                }
            }
            // Values are wrapped in a function so that each value can be accessed independently
            if (makeValueAccessors) {
                val = 'function(){return ' + val + ' }';
            }
            resultStrings.push("'" + key + "':" + val);
        };

        let resultStrings = [],
            propertyAccessorResultStrings = [],
            makeValueAccessors = bindingOptions['valueAccessors'],
            bindingParams = bindingOptions['bindingParams'],
            keyValueArray = typeof bindingsStringOrKeyValueArray === "string" ?
                parseObjectLiteral(bindingsStringOrKeyValueArray) : bindingsStringOrKeyValueArray;

        for (let keyValue of keyValueArray) {
            _processKeyValue(keyValue.key || keyValue.unknown, keyValue.value);
        }

        if (propertyAccessorResultStrings.length) {
            _processKeyValue(PROPERTY_WRITERS_BINDING_KEY, "{" + propertyAccessorResultStrings.join(",") + " }");
        }

        return resultStrings.join(",");
    };

    const bindingRewriteValidators = [];

    const keyValueArrayContainsKey = (keyValueArray, key) => {
            // unfortunately !!keyValueArray.find(keyVal => keyVal.key === key)` is 10x slower in Chrome 
            for (let i = 0, len = keyValueArray.length; i < len; i++) {
                if (keyValueArray[i].key === key) {
                    return true;
                }
            }
            return false;
        };

    // Internal, private KO utility for updating model properties from within bindings
    // property:            If the property being updated is (or might be) an observable, pass it here
    //                      If it turns out to be a writable observable, it will be written to directly
    // allBindings:         An object with a get method to retrieve bindings in the current execution context.
    //                      This will be searched for a '_ko_property_writers' property in case you're writing to a non-observable
    // key:                 The key identifying the property to be written. Example: for { hasFocus: myValue }, write to 'myValue' by specifying the key 'hasFocus'
    // value:               The value to be written
    // checkIfDifferent:    If true, and if the property being written is a writable observable, the value will only be written if
    //                      it is !== existing value on that writable observable
    const writeValueToProperty = (property, allBindings, key, value, checkIfDifferent) => {
        if (!property || !isObservable(property)) {
            let propWriters = allBindings.get(PROPERTY_WRITERS_BINDING_KEY);
            if (propWriters && propWriters[key]) {
                propWriters[key](value);
            }
        } else if (isWritableObservable(property) && (!checkIfDifferent || property.peek() !== value)) {
            property(value);
        }
    };

    // Making bindings explicitly declare themselves as "two way" isn't ideal in the long term (it would be better if
    // all bindings could use an official 'property writer' API without needing to declare that they might). However,
    // since this is not, and has never been, a public API (_ko_property_writers was never documented), it's acceptable
    // as an internal implementation detail in the short term.
    // For those developers who rely on _ko_property_writers in their custom bindings, we expose _twoWayBindings as an
    // undocumented feature that makes it relatively easy to upgrade to KO 3.0. However, this is still not an official
    // public API, and we reserve the right to remove it at any time if we create a real public property writers API.
    const _twoWayBindings = twoWayBindings;

    // alias For backward compatibility (see 'ko.jsonExpressionRewriting' alias below)
    // TODO removed, add to documentation
    // export const insertPropertyAccessorsIntoJson = preProcessBindings;

    const _loadingSubscribablesCache = new Map(); // Tracks component loads that are currently in flight
    const _loadedDefinitionsCache = new Map();    // Tracks component loads that have already completed

    let loaders = [];

    const _setComponentLoaders = (newLoaders) => loaders = newLoaders;

    const getComponent = (componentName, callback) => {
        let cachedDefinition = _loadedDefinitionsCache.get(componentName);
        if (cachedDefinition) {
            // It's already loaded and cached. Reuse the same definition object.
            // Note that for API consistency, even cache hits complete asynchronously by default.
            // You can bypass this by putting synchronous:true on your component config.
            if (cachedDefinition.isSynchronousComponent) {
                // See comment in loaderRegistryBehaviors.js for reasoning
                ignoreDependencyDetection(() => callback(cachedDefinition.definition));
            } else {
                scheduleTask(() => callback(cachedDefinition.definition));
            }
        } else {
            // Join the loading process that is already underway, or start a new one.
            let loadingSubscribable = _loadingSubscribablesCache.get(componentName);
            if (loadingSubscribable) {
                loadingSubscribable.subscribe(callback);
            } else {
                _loadNotYetLoadingComponentAndNotify(componentName, callback);
            }
        }
    };

    const clearCachedDefinition = (componentName) => {
        _loadedDefinitionsCache.delete(componentName);
    };

    /**
     * Start loading a component that is not yet loading, and when it's done, move it to loadedDefinitionsCache.
     * @param {string} componentName
     * @param {function} callback
     * @private
     */
    const _loadNotYetLoadingComponentAndNotify = (componentName, callback) => {
        // if (_loadingSubscribablesCache.has(componentName)) {
        //     throw new Error('Component "' + componentName + '" is already loading');
        // }
        let _subscribable = new Subscribable(),
            completedAsync;
        
        _loadingSubscribablesCache.set(componentName, _subscribable);
        _subscribable.subscribe(callback);

        _beginLoadingComponent(componentName, (definition, config) => {
            let isSynchronousComponent = !!(config && config.synchronous);
            _loadedDefinitionsCache.set(componentName, {definition, isSynchronousComponent});
            _loadingSubscribablesCache.delete(componentName);

            // For API consistency, all loads complete asynchronously. However we want to avoid
            // adding an extra task schedule if it's unnecessary (i.e., the completion is already
            // async).
            //
            // You can bypass the 'always asynchronous' feature by putting the synchronous:true
            // flag on your component configuration when you register it.
            if (completedAsync || isSynchronousComponent) {
                // Note that notifySubscribers ignores any dependencies read within the callback.
                // See comment in loaderRegistryBehaviors.js for reasoning
                _subscribable.notifySubscribers(definition);
            } else {
                scheduleTask(() => _subscribable.notifySubscribers(definition));
            }
        });
        completedAsync = true;
    };

    const _beginLoadingComponent = (componentName, callback) => {
        _getFirstResultFromLoaders('getConfig', [componentName], config => {
            if (config) {
                // We have a config, so now load its definition
                _getFirstResultFromLoaders('loadComponent', [componentName, config], definition => void callback(definition, config));
            } else {
                // The component has no config - it's unknown to all the loaders.
                // Note that this is not an error (e.g., a module loading error) - that would abort the
                // process and this callback would not run. For this callback to run, all loaders must
                // have confirmed they don't know about this component.
                callback(null, null);
            }
        });
    };

    const _getFirstResultFromLoaders = (methodName, argsExceptCallback, callback, candidateLoaders) => {
        // On the first call in the stack, start with the full set of loaders
        if (!candidateLoaders) {
            candidateLoaders = loaders.slice(); // Use a copy, because we'll be mutating this array
        }

        // Try the next candidate
        let currentCandidateLoader = candidateLoaders.shift();
        if (!currentCandidateLoader) {
            // No candidates returned a value
            return callback(null);
        }
        
        if (!currentCandidateLoader[methodName]) {
            // This candidate doesn't have the relevant handler. Synchronously move on to the next one.
            return _getFirstResultFromLoaders(methodName, argsExceptCallback, callback, candidateLoaders);
        }
        let wasAborted = false,
            synchronousReturnValue = currentCandidateLoader[methodName](...argsExceptCallback, result => {
                if (wasAborted) {
                    callback(null);
                } else if (result !== null) {
                    // This candidate returned a value. Use it.
                    callback(result);
                } else {
                    // Try the next candidate
                    _getFirstResultFromLoaders(methodName, argsExceptCallback, callback, candidateLoaders);
                }
            });

        // Currently, loaders may not return anything synchronously. This leaves open the possibility
        // that we'll extend the API to support synchronous return values in the future. It won't be
        // a breaking change, because currently no loader is allowed to return anything except undefined.
        if (synchronousReturnValue !== undefined) {
            wasAborted = true;

            // Method to suppress exceptions will remain undocumented. This is only to keep
            // KO's specs running tidily, since we can observe the loading got aborted without
            // having exceptions cluttering up the console too.
            if (!currentCandidateLoader['suppressLoaderExceptions']) {
                throw new Error('Component loaders must supply values by invoking the callback, not by returning values synchronously.');
            }
        }
    };

    const NONE = [0, '', ''],
        TABLE = [1, '<table>', '</table>'],
        TBODY = [2, '<table><tbody>', '</tbody></table>'],
        TR = [3, '<table><tbody><tr>', '</tr></tbody></table>'],
        SELECT = [1, '<select multiple="multiple">', '</select>'],
        LOOKUP = {
            thead: TABLE, THEAD: TABLE,
            tbody: TABLE, TBODY: TABLE,
            tfoot: TABLE, TFOOT: TABLE,
            tr: TBODY, TR: TBODY, 
            td: TR, TD: TR,
            th: TR, TH: TR,
            option: SELECT, OPTION: SELECT,
            optgroup: SELECT, OPTGROUP: SELECT
        },
        TAGS_REGEX = /^(?:<!--.*?-->\s*?)*?<([a-zA-Z]+)[\s>]/;

    const parseHtmlFragment = (html, documentContext) => {
        if (!documentContext) {
            documentContext = document;
        }
        let windowContext = documentContext.parentWindow || documentContext.defaultView || window;

        // Based on jQuery's "clean" function, but only accounting for table-related elements.
        // If you have referenced jQuery, this won't be used anyway - KO will use jQuery's "clean" function directly

        // Note that there's still an issue in IE < 9 whereby it will discard comment nodes that are the first child of
        // a descendant node. For example: "<div><!-- mycomment -->abc</div>" will get parsed as "<div>abc</div>"
        // This won't affect anyone who has referenced jQuery, and there's always the workaround of inserting a dummy node
        // (possibly a text node) in front of the comment. So, KO does not attempt to workaround this IE issue automatically at present.

        // Trim whitespace, otherwise indexOf won't work as expected
        let div = documentContext.createElement('div'),
            wrap = (TAGS_REGEX.test((html || '').trim()) && LOOKUP[RegExp.$1]) || NONE,
            depth = wrap[0];

        // Go to html and back, then peel off extra wrappers
        // Note that we always prefix with some dummy text, because otherwise, IE<9 will strip out leading comment nodes in descendants. Total madness.
        let markup = 'ignored<div>' + wrap[1] + html + wrap[2] + '</div>';
        if (typeof windowContext['innerShiv'] === 'function') {
            // Note that innerShiv is deprecated in favour of html5shiv. We should consider adding
            // support for html5shiv (except if no explicit support is needed, e.g., if html5shiv
            // somehow shims the native APIs so it just works anyway)
            div.appendChild(windowContext['innerShiv'](markup));
        } else {
            div.innerHTML = markup;
        }

        // Move to the right depth
        while (depth--) {
            div = div.lastChild;
        }

        // return [...div.lastChild.childNodes];
        // Rest operator is slow (manual creation of nodes array is 60% faster in FF81, 80% faster in Chrome; re-check in the future)
        let nodesArray = [];
        for (let i = 0, nodeList = div.lastChild.childNodes, len = nodeList.length; i < len; i++) {
            nodesArray[i] = nodeList[i];
        }
        return nodesArray;
    };

    const parseHtmlForTemplateNodes = (html, documentContext) => {
        let nodes = parseHtmlFragment(html, documentContext);
        return (nodes.length && nodes[0].parentElement) || moveCleanedNodesToContainerElement(nodes);
    };

    const setHtml = (node, html) => {
        emptyDomNode(node);

        // There's no legitimate reason to display a stringified observable without unwrapping it, so we'll unwrap it
        html = unwrapObservable(html);

        let htmlType = html === null ? 'undefined' : typeof html;

        if (htmlType !== 'undefined') {
            if (htmlType !== 'string') {
                html = html.toString();
            }
            for (let parsedNode of parseHtmlFragment(html, node.ownerDocument)) {
                node.appendChild(parsedNode);
            }
        }
    };

    const CREATE_VIEW_MODEL_KEY = 'createViewModel';

    // The default loader is responsible for two things:
    // 1. Maintaining the default in-memory registry of component configuration objects
    //    (i.e., the thing you're writing to when you call ko.components.register(someName, ...))
    // 2. Answering requests for components by fetching configuration objects
    //    from that default in-memory registry and resolving them into standard
    //    component definition objects (of the form { createViewModel: ..., template: ... })
    // Custom loaders may override either of these facilities, i.e.,
    // 1. To supply configuration objects from some other source (e.g., conventions)
    // 2. Or, to resolve configuration objects by loading viewmodels/templates via arbitrary logic.
    const defaultConfigRegistry = new Map();

    const registerComponent = (componentName, config) => {
        if (!config) {
            throw new Error('Invalid configuration for ' + componentName);
        }
        if (defaultConfigRegistry.has(componentName)) {
            throw new Error('Component ' + componentName + ' is already registered');
        }
        defaultConfigRegistry.set(componentName, config);
    };

    /**
     * @type {function(string):boolean}
     */
    const isComponentRegistered = defaultConfigRegistry.has.bind(defaultConfigRegistry);

    const unregisterComponent = (componentName) => {
        defaultConfigRegistry.delete(componentName);
        clearCachedDefinition(componentName);
    };

    const defaultLoader = {
        getConfig(componentName, callback) {
            let result = defaultConfigRegistry.get(componentName) || null;
            callback(result);
        },
        
        loadComponent(componentName, config, callback) {
            let errorCallback = _makeErrorCallback(componentName);
            _possiblyGetConfigFromAmd(errorCallback, config, loadedConfig => _resolveConfig(componentName, errorCallback, loadedConfig, callback));
        },
        
        loadTemplate(componentName, templateConfig, callback) {
            _resolveTemplate(_makeErrorCallback(componentName), templateConfig, callback);
        },
        
        loadViewModel(componentName, viewModelConfig, callback) {
            _resolveViewModel(_makeErrorCallback(componentName), viewModelConfig, callback);
        }
    };

    // Takes a config object of the form { template: ..., viewModel: ... }, and asynchronously convert it
    // into the standard component definition format:
    //    { template: <ArrayOfDomNodes>, createViewModel: function(params, componentInfo) { ... } }.
    // Since both template and viewModel may need to be resolved asynchronously, both tasks are performed
    // in parallel, and the results joined when both are ready. We don't depend on any promises infrastructure,
    // so this is implemented manually below.
    const _resolveConfig = (componentName, errorCallback, config, callback) => {
        let result = {},
            makeCallBackWhenZero = 2,
            tryIssueCallback = () => (--makeCallBackWhenZero === 0) && callback(result),
            templateConfig = config['template'],
            viewModelConfig = config['viewModel'];

        if (templateConfig) {
            _possiblyGetConfigFromAmd(errorCallback, templateConfig, loadedConfig => {
                _getFirstResultFromLoaders('loadTemplate', [componentName, loadedConfig], resolvedTemplate => {
                    result['template'] = resolvedTemplate;
                    tryIssueCallback();
                });
            });
        } else {
            tryIssueCallback();
        }

        if (viewModelConfig) {
            _possiblyGetConfigFromAmd(errorCallback, viewModelConfig, loadedConfig => {
                _getFirstResultFromLoaders('loadViewModel', [componentName, loadedConfig], resolvedViewModel => {
                    result[CREATE_VIEW_MODEL_KEY] = resolvedViewModel;
                    tryIssueCallback();
                });
            });
        } else {
            tryIssueCallback();
        }
    };

    const _resolveTemplate = (errorCallback, templateConfig, callback) => {
        if (typeof templateConfig === 'string') {
            // Markup - parse it
            return callback(parseHtmlFragment(templateConfig));
        } 
        if (templateConfig.element) {
            let elementIdOrNode = templateConfig.element,
                elemNode;
            if (typeof elementIdOrNode === 'string') {
                elemNode = document.getElementById(elementIdOrNode);
                if (!elemNode) {
                    errorCallback('Cannot find element with ID ' + elementIdOrNode);
                }
            } else if (elementIdOrNode && elementIdOrNode.tagName && elementIdOrNode.nodeType === 1) {
                // isDomElement-check (= less precise than `instanceof HTMLElement' but a lot cheaper) 
                elemNode = elementIdOrNode;
            } else {
                errorCallback('Unknown element type: ' + elementIdOrNode);
            }
            // Element instance found - copy its child nodes
            return callback(_cloneNodesFromTemplateSourceElement(elemNode));
        }  
        if (Array.isArray(templateConfig)) {
            // Assume already an array of DOM nodes - pass through unchanged
            return callback(templateConfig);
        }
        if (_isDocumentFragment(templateConfig)) {
            // Document fragment - use its child nodes
            return callback([...templateConfig.childNodes]);
        } 
        errorCallback('Unknown template value: ' + templateConfig);
    };

    const _resolveViewModel = (errorCallback, viewModelConfig, callback) => {
        if (typeof viewModelConfig === 'function') {
            // Constructor - convert to standard factory function format
            // By design, this does *not* supply componentInfo to the constructor, as the intent is that
            // componentInfo contains non-viewmodel data (e.g., the component's element) that should only
            // be used in factory functions, not viewmodel constructors.
            return callback((params /*, componentInfo */) => new viewModelConfig(params));
        } 
        let factoryFn = viewModelConfig[CREATE_VIEW_MODEL_KEY];
        if (typeof factoryFn === 'function') {
            // Already a factory function - use it as-is
            return callback(factoryFn);
        } 
        let fixedInstance = viewModelConfig.instance;
        if (fixedInstance !== undefined) {
            // Fixed object instance - promote to createViewModel format for API consistency
            return callback((params, componentInfo) => fixedInstance);
        } 
        let viewModel = viewModelConfig.viewModel;
        if (viewModel !== undefined) {
            // Resolved AMD module whose value is of the form { viewModel: ... }
            return _resolveViewModel(errorCallback, viewModel, callback);
        } 
        errorCallback('Unknown viewModel value: ' + viewModelConfig);
    };

    const _cloneNodesFromTemplateSourceElement = (elemInstance) => {
        let tagName = elemInstance.tagName.toLowerCase();
        switch (tagName) {
            case 'script':   
                return parseHtmlFragment(elemInstance.text);
            case 'textarea': 
                return parseHtmlFragment(elemInstance.value);
            case 'template':
                // For browsers with proper <template> element support (i.e., where the .content property
                // gives a document fragment), use that document fragment.
                if (_isDocumentFragment(elemInstance.content)) {
                    return cloneNodes(elemInstance.content.childNodes);
                }
        }
        // Regular elements such as <div>, and <template> elements on old browsers that don't really
        // understand <template> and just treat it as a regular container
        return cloneNodes(elemInstance.childNodes);
    };

    const _isDocumentFragment = obj => obj && obj.nodeType === 11;

    const _possiblyGetConfigFromAmd = (errorCallback, config, callback) => {
        if (typeof config.require !== 'string') {
            callback(config);
            return;
        }
        // The config is the value of an AMD module
        let requireFn = typeof amdRequire === 'function' ? amdRequire : window.require; // eslint-disable-line no-undef
        if (requireFn) {
            requireFn([config.require], module => {
                if (module && (typeof module === 'object') && module.__esModule && module.default) {
                    module = module.default;
                }
                callback(module);
            });
        } else {
            errorCallback('Uses require, but no AMD loader is present');
        }
    };

    const _makeErrorCallback = (componentName) => message => {
        throw new Error('Component \'' + componentName + '\': ' + message);
    };

    // By default, the default loader is the only registered component loader
    loaders.push(defaultLoader);

    // Overridable API for determining which component name applies to a given node. By overriding this,
    // you can for example map specific tagNames to components that are not preregistered.
    const _overrideGetComponentNameForNode = fn => getComponentNameForNode = fn;

    let getComponentNameForNode = (node) => {
        let tagNameLower = (node && node.tagName || '').toLowerCase();
        if (tagNameLower && isComponentRegistered(tagNameLower)) {
            // Try to determine that this node can be considered a *custom* element; see https://github.com/knockout/knockout/issues/1603
            if (~tagNameLower.indexOf('-') || ('' + node) === "[object HTMLUnknownElement]") {
                return tagNameLower;
            }
        }
    };

    const addBindingsForCustomElement = (allBindings, node, bindingContext, valueAccessors) => {
        // Determine if it's really a custom element matching a component
        if (node.nodeType === 1) {
            let componentName = getComponentNameForNode(node);
            if (componentName) {
                // It does represent a component, so add a component binding for it
                allBindings = allBindings || {};

                if (allBindings.component) {
                    // Avoid silently overwriting some other 'component' binding that may already be on the element
                    throw new Error('Cannot use the "component" binding on a custom element matching a component');
                }

                let componentBindingValue = {name: componentName, params: _getComponentParamsFromCustomElement(node, bindingContext)};

                allBindings.component = valueAccessors
                    ? function() { return componentBindingValue; }
                    : componentBindingValue;
            }
        }

        return allBindings;
    };

    let _nativeBindingProviderInstance;

    const _setNativeBindingProviderInstance = bindingProvider => _nativeBindingProviderInstance = bindingProvider;

    const _getComponentParamsFromCustomElement = (elem, bindingContext) => {
        let paramsAttribute = elem.getAttribute('params');

        if (!paramsAttribute) {
            // For consistency, absence of a "params" attribute is treated the same as the presence of
            // any empty one. Otherwise component viewmodels need special code to check whether or not
            // 'params' or 'params.$raw' is null/undefined before reading subproperties, which is annoying.
            return {'$raw': {}};
        }
        
        let params = _nativeBindingProviderInstance.parseBindingsString(paramsAttribute, bindingContext, elem, {valueAccessors: true, bindingParams: true}),
            rawParamComputedValues = {},
            result = {},
            hadRawProperty = false; 
        
        Object.keys(params).forEach(paramName => {
            let paramValue = params[paramName],
                paramValueComputed = computed(paramValue, null, {disposeWhenNodeIsRemoved: elem}),
                paramValueComputedPeekedValue = paramValueComputed.peek();
            
            rawParamComputedValues[paramName] = paramValueComputed;

            // Does the evaluation of the parameter value unwrap any observables?
            if (!paramValueComputed.isActive()) {
                // No it doesn't, so there's no need for any computed wrapper. Just pass through the supplied value directly.
                // Example: "someVal: firstName, age: 123" (whether or not firstName is an observable/computed)
                result[paramName] = paramValueComputedPeekedValue;
            } else {
                // Yes it does. Supply a computed property that unwraps both the outer (binding expression)
                // level of observability, and any inner (resulting model value) level of observability.
                // This means the component doesn't have to worry about multiple unwrapping. If the value is a
                // writable observable, the computed will also be writable and pass the value on to the observable.
                result[paramName] = computed({
                    read: () => unwrapObservable(paramValueComputed()),
                    write: isWritableObservable(paramValueComputedPeekedValue) && (value => paramValueComputed()(value)),
                    disposeWhenNodeIsRemoved: elem
                });
            }
            
            if (paramName === '$raw') {
                hadRawProperty = true;
            }
        });
        
        if (!hadRawProperty) {
            // Give access to the raw computeds, as long as that wouldn't overwrite any custom param also called '$raw'
            // This is in case the developer wants to react to outer (binding) observability separately from inner
            // (model value) observability, or in case the model value observable has subobservables.
            result['$raw'] = rawParamComputedValues;
        }

        return result;
    };

    const DEFAULT_BINDING_ATTRIBUTE_NAME = "data-bind";


    class KoBindingProvider {

        // getter/setter only added to allow external scripts (jasmine) to replace the provider via 'ko.bindingProvider.instance'
        // Internally, the direct reference to 'bindingProviderInstance' is used 
        static get instance() { return bindingProviderInstance; }
        static set instance(newInstance) { bindingProviderInstance = newInstance; }
        
        constructor() {
            this._cache = new Map();
        }

        nodeHasBindings(node) {
            let nodeType = node.nodeType;
            // 1 == element, 8 == comment
            return (nodeType === 1) ? (node.getAttribute(DEFAULT_BINDING_ATTRIBUTE_NAME) !== null || getComponentNameForNode(node)) :
                   (nodeType === 8) ? hasBindingValue(node) : false;
        }

        getBindings(node, bindingContext) {
            let bindingsString = (node.nodeType === 1 ? node.getAttribute(DEFAULT_BINDING_ATTRIBUTE_NAME) : node.nodeType === 8 ? (START_COMMENT_REGEX.test(node.nodeValue) ? RegExp.$1 : null) : null),
                parsedBindings = bindingsString ? this.parseBindingsString(bindingsString, bindingContext, node) : null;
            return addBindingsForCustomElement(parsedBindings, node, bindingContext, /* valueAccessors */ false);
        }

        getBindingAccessors(node, bindingContext) {
            let bindingsString = (node.nodeType === 1 ? node.getAttribute(DEFAULT_BINDING_ATTRIBUTE_NAME) : node.nodeType === 8 ? (START_COMMENT_REGEX.test(node.nodeValue) ? RegExp.$1 : null) : null),
                parsedBindings = bindingsString ? this.parseBindingsString(bindingsString, bindingContext, node, {'valueAccessors': true}) : null;
            return addBindingsForCustomElement(parsedBindings, node, bindingContext, /* valueAccessors */ true);
        }

        // The following function is only used internally by this default provider.
        // It's not part of the interface definition for a general binding provider.
        parseBindingsString(bindingsString, bindingContext, node, options) {
            let cacheKey = bindingsString + (options && options['valueAccessors'] || ''),
                bindingFunction = this._cache.get(cacheKey);
            
            if (bindingFunction) {
                // the function has been parsed once, so skip the try-catch extra scope 
                return bindingFunction(bindingContext, node);
            }
            
            try {
                //binding = this._createBindingsStringEvaluator(bindingsString, options);
                // Build the source for a function that evaluates "expression"
                // For each scope variable, add an extra level of "with" nesting
                // Example result: with(sc1) { with(sc0) { return (expression) } }
                let rewrittenBindings = preProcessBindings(bindingsString, options),
                    functionBody = "with($context){with($data||{}){return{" + rewrittenBindings + "}}}",
                    bindingFnToCache = new Function("$context", "$element", functionBody);
                
                this._cache.set(cacheKey, bindingFnToCache);
                
                return bindingFnToCache(bindingContext, node);
            } catch (ex) {
                ex.message = "Unable to parse bindings.\nBindings value: " + bindingsString + "\nMessage: " + ex.message;
                throw ex;
            }
        }
    }

    let bindingProviderInstance = new KoBindingProvider();

    _setNativeBindingProviderInstance(new KoBindingProvider());

    // Hide or don't minify context properties, see https://github.com/knockout/knockout/issues/2294

    // pull frequently used methods closer (could become imports some day)
    // allows for faster access + efficient minification


    const CONTEXT_SUBSCRIBABLE = Symbol('_subscribable');
    const CONTEXT_ANCESTOR_BINDING_INFO = Symbol('_ancestorBindingInfo');
    const CONTEXT_DATA_DEPENDENCY = Symbol('_dataDependency');

    // The following element types will not be recursed into during binding.
    const BINDING_DOES_NOT_RECURSE_INTO_ELEMENT_TYPES = {
        // Don't want bindings that operate on text nodes to mutate <script> and <textarea> contents,
        // because it's unexpected and a potential XSS issue.
        // Also bindings should not operate on <template> elements since this breaks in Internet Explorer
        // and because such elements' contents are always intended to be bound in a different context
        // from where they appear in the document.
        script: 1,
        SCRIPT: 1,
        textarea: 1,
        TEXTAREA: 1,
        template: 1,
        TEMPLATE: 1
    };


    const INHERIT_PARENT_VM_DATA = Symbol();

    const IS_BINDING_CONTEXT_INSTANCE = Symbol();

    let _koReferenceForBindingContexts;

    const _setKoReferenceForBindingContexts = (ko) => _koReferenceForBindingContexts = ko;

    /**
     * The ko.bindingContext/KoBindingContext constructor is only called directly to create the root context. 
     * For child contexts, use bindingContextInstance.createChildContext or bindingContextInstance.extend.
     */
    class KoBindingContext {

        constructor(dataItemOrAccessor, parentContext, dataItemAlias, extendCallback, options) {
            this[IS_BINDING_CONTEXT_INSTANCE] = true;
            
            const shouldInheritData = dataItemOrAccessor === INHERIT_PARENT_VM_DATA;
            const realDataItemOrAccessor = shouldInheritData ? undefined : dataItemOrAccessor;
            const isFunc = (typeof realDataItemOrAccessor === 'function') && !isObservable(realDataItemOrAccessor);
            const dataDependency = options && options.dataDependency;

            let _subscribable = null;
            
            // The binding context object includes static properties for the current, parent, and root view models.
            // If a view model is actually stored in an observable, the corresponding binding context object, and
            // any child contexts, must be updated when the view model is changed.
            const _updateContext = () => {
                    // Most of the time, the context will directly get a view model object, but if a function is given,
                    // we call the function to retrieve the view model. If the function accesses any observables or returns
                    // an observable, the dependency is tracked, and those observables can later cause the binding
                    // context to be updated.
                    let dataItemOrObservable = isFunc ? realDataItemOrAccessor() : realDataItemOrAccessor,
                        dataItem = unwrapObservable(dataItemOrObservable);

                    if (parentContext) {
                        // Copy $root and any custom properties from the parent context
                        Object.assign(this, parentContext);

                        // Copy Symbol properties
                        if (CONTEXT_ANCESTOR_BINDING_INFO in parentContext) {
                            this[CONTEXT_ANCESTOR_BINDING_INFO] = parentContext[CONTEXT_ANCESTOR_BINDING_INFO];
                        }
                    } else {
                        this['$parents'] = [];
                        this['$root'] = dataItem;

                        // Export 'ko' in the binding context so it will be available in bindings and templates
                        // even if 'ko' isn't exported as a global, such as when using an AMD loader.
                        // See https://github.com/SteveSanderson/knockout/issues/490
                        this.ko = _koReferenceForBindingContexts;
                    }

                    this[CONTEXT_SUBSCRIBABLE] = _subscribable;

                    if (shouldInheritData) {
                        dataItem = this['$data'];
                    } else {
                        this['$rawData'] = dataItemOrObservable;
                        this['$data'] = dataItem;
                    }

                    if (dataItemAlias) {
                        this[dataItemAlias] = dataItem;
                    }

                    // The extendCallback function is provided when creating a child context or extending a context.
                    // It handles the specific actions needed to finish setting up the binding context. Actions in this
                    // function could also add dependencies to this binding context.
                    if (extendCallback) {
                        extendCallback(this, parentContext, dataItem);
                    }

                    // When a "parent" context is given and we don't already have a dependency on its context, register a dependency on it.
                    // Thus whenever the parent context is updated, this context will also be updated.
                    let parentCtxSubscribable = parentContext && parentContext[CONTEXT_SUBSCRIBABLE];
                    if (parentCtxSubscribable && !getCurrentComputed().hasAncestorDependency(parentCtxSubscribable)) {
                        parentCtxSubscribable();
                    }

                    if (dataDependency) {
                        this[CONTEXT_DATA_DEPENDENCY] = dataDependency;
                    }

                    return this['$data'];
                };

            if (options && options['exportDependencies']) {
                // The "exportDependencies" option means that the calling code will track any dependencies and re-create
                // the binding context when they change.
                _updateContext();
            } else {
                _subscribable = pureComputed(_updateContext);
                _subscribable.peek();

                // At this point, the binding context has been initialized, and the "subscribable" computed observable is
                // subscribed to any observables that were accessed in the process. If there is nothing to track, the
                // computed will be inactive, and we can safely throw it away. If it's active, the computed is stored in
                // the context object.
                if (_subscribable.isActive()) {
                    // Always notify because even if the model ($data) hasn't changed, other context properties might have changed
                    _subscribable.equalityComparer = null;
                } else {
                    this[CONTEXT_SUBSCRIBABLE] = undefined;
                }
            }
        }

        // Extend the binding context hierarchy with a new view model object. If the parent context is watching
        // any observables, the new child context will automatically get a dependency on the parent context.
        // But this does not mean that the $data value of the child context will also get updated. If the child
        // view model also depends on the parent view model, you must provide a function that returns the correct
        // view model on each update.
        createChildContext(dataItemOrAccessor, dataItemAlias, extendCallback, options) {
            if (!options && dataItemAlias && typeof dataItemAlias === 'object') {
                options = dataItemAlias;
                dataItemAlias = options['as'];
                extendCallback = options['extend'];
            }

            if (dataItemAlias && options && options['noChildContext']) {
                let isFunc = typeof dataItemOrAccessor === 'function' && !isObservable(dataItemOrAccessor);
                return new KoBindingContext(INHERIT_PARENT_VM_DATA, this, null, (newContext) => {
                        if (extendCallback) {
                            extendCallback(newContext);
                        }
                        newContext[dataItemAlias] = isFunc ? dataItemOrAccessor() : dataItemOrAccessor;
                    }, options);
            }

            return new KoBindingContext(dataItemOrAccessor, this, dataItemAlias, (newContext, parentContext) => {
                // Extend the context hierarchy by setting the appropriate pointers
                newContext['$parentContext'] = parentContext;
                newContext['$parent'] = parentContext['$data'];
                newContext['$parents'] = (parentContext['$parents'] || []).slice();
                newContext['$parents'].unshift(newContext['$parent']);
                if (extendCallback) {
                    extendCallback(newContext);
                }
            }, options);
        }

        // Extend the binding context with new custom properties. This doesn't change the context hierarchy.
        // Similarly to "child" contexts, provide a function here to make sure that the correct values are set
        // when an observable view model is updated.
        extend(properties, options) {
            return new KoBindingContext(INHERIT_PARENT_VM_DATA, this, null, (newContext, parentContext) => {
                Object.assign(newContext, (typeof properties === 'function') ? properties(newContext) : properties);
            }, options);
        }
    }

    // allows for replacing 'obj instanceof KoBindingContext' with faster obj[IS_BINDING_CONTEXT_INSTANCE]
    KoBindingContext.prototype[IS_BINDING_CONTEXT_INSTANCE] = true;

    const BOUND_ELEMENT_DOM_DATA_KEY = nextDomDataKey();

    const _asyncContextDispose = (node) => {
        let bindingInfo = getDomData(node, BOUND_ELEMENT_DOM_DATA_KEY),
            asyncContext = bindingInfo && bindingInfo.asyncContext;
        if (asyncContext) {
            bindingInfo.asyncContext = null;
            asyncContext.notifyAncestor();
        }
    };


    class AsyncCompleteContext {
        constructor(node, bindingInfo, ancestorBindingInfo) {
            this.node = node;
            this.bindingInfo = bindingInfo;
            this.asyncDescendants = [];
            this.childrenComplete = false;

            if (!bindingInfo.asyncContext) {
                addDisposeCallback(node, _asyncContextDispose);
            }

            if (ancestorBindingInfo && ancestorBindingInfo.asyncContext) {
                ancestorBindingInfo.asyncContext.asyncDescendants.push(node);
                this.ancestorBindingInfo = ancestorBindingInfo;
            }
        }

        notifyAncestor() {
            let asyncContext = this.ancestorBindingInfo && this.ancestorBindingInfo.asyncContext;
            if (asyncContext) {
                asyncContext.descendantComplete(this.node);
            }
        }

        descendantComplete(node) {
            let descendants = this.asyncDescendants,
                index = (descendants && descendants.length) ? descendants.indexOf(node) : -1;
            if (index === 0) {
                descendants.shift();
            } else if (index > 0) {
                descendants.splice(index, 1);
            }
            if (!descendants.length && this.childrenComplete) {
                this.completeChildren();
            }
        }

        completeChildren() {
            this.childrenComplete = true;
            if (this.bindingInfo.asyncContext && !this.asyncDescendants.length) {
                this.bindingInfo.asyncContext = null;
                removeDisposeCallback(this.node, _asyncContextDispose);
                bindingEvent.notify(this.node, EVENT_DESCENDENTS_COMPLETE);
                this.notifyAncestor();
            }
        }
    }

    const EVENT_CHILDREN_COMPLETE = 'childrenComplete';
    const EVENT_DESCENDENTS_COMPLETE = 'descendantsComplete';

    const bindingEvent = {
        childrenComplete: EVENT_CHILDREN_COMPLETE,
        descendantsComplete: EVENT_DESCENDENTS_COMPLETE,
        subscribe(node, event, callback, context, options) {
            let bindingInfo = getOrSetDomData(node, BOUND_ELEMENT_DOM_DATA_KEY, {}),
                eventSubscribable = bindingInfo.eventSubscribable || (bindingInfo.eventSubscribable = new Subscribable());
            
            if (options && options.notifyImmediately && bindingInfo.notifiedEvents[event]) {
                ignoreDependencyDetection(callback, context, [node]);
            }
            return eventSubscribable.subscribe(callback, context, event);
        },

        notify(node, event) {
            let bindingInfo = getDomData(node, BOUND_ELEMENT_DOM_DATA_KEY);
            if (!bindingInfo) {
                return;
            }
            bindingInfo.notifiedEvents[event] = true;
            let _eventSubscribable = bindingInfo.eventSubscribable;
            if (_eventSubscribable) {
                _eventSubscribable.notifySubscribers(node, event);
            }
            if (event === EVENT_CHILDREN_COMPLETE) {
                let _asyncContext = bindingInfo.asyncContext; 
                if (_asyncContext) {
                    _asyncContext.completeChildren();
                } else if (_asyncContext === undefined && bindingInfo.eventSubscribable && bindingInfo.eventSubscribable.hasSubscriptionsForEvent(EVENT_DESCENDENTS_COMPLETE)) {
                    // It's currently an error to register a descendantsComplete handler for a node that was never registered as completing asynchronously.
                    // That's because without the asyncContext, we don't have a way to know that all descendants have completed.
                    throw new Error("descendantsComplete event not supported for bindings on this node");
                }
            }
        },

        startPossiblyAsyncContentBinding: function (node, bindingContext) {
            let bindingInfo = getOrSetDomData(node, BOUND_ELEMENT_DOM_DATA_KEY, {});

            if (!bindingInfo.asyncContext) {
                bindingInfo.asyncContext = new AsyncCompleteContext(node, bindingInfo, bindingContext[CONTEXT_ANCESTOR_BINDING_INFO]);
            }

            // If the provided context was already extended with this node's binding info, just return the extended context
            if (bindingContext[CONTEXT_ANCESTOR_BINDING_INFO] === bindingInfo) {
                return bindingContext;
            }
            
            return bindingContext.extend(ctx => ctx[CONTEXT_ANCESTOR_BINDING_INFO] = bindingInfo);
        }
    };

    // Given a function that returns bindings, create and return a new object that contains
    // binding value-accessors functions. Each accessor function calls the original function
    // so that it always gets the latest value and all dependencies are captured. This is used
    // by ko.applyBindingsToNode and _getBindingsAndMakeAccessors.
    const _makeAccessorsFromFunction = (callback) => {
        let source = ignoreDependencyDetection(callback),
            target = source && Object.create(null);
        if (target) {
            for (let key of Object.keys(source)) {
                target[key] = () => callback()[key];
            }
        }
        return target;
    };

    // Given a bindings function or object, create and return a new object that contains
    // binding value-accessors functions. This is used by ko.applyBindingsToNode.
    function _makeBindingAccessors(bindings, context, node) {
        if (typeof bindings === 'function') {
            return _makeAccessorsFromFunction(() => bindings(context, node));
        }
        let target = Object.create(null);
        for (let key of Object.keys(bindings)) {
            let val = bindings[key];
            target[key] = () => val;
        }
        return target;
    }


    function _applyBindingsToDescendantsInternal(bindingContext, elementOrVirtualElement) {
        let nextInQueue = firstChild(elementOrVirtualElement);

        if (nextInQueue) {
            let currentChild;

            // Preprocessing allows a binding provider to mutate a node before bindings are applied to it. For example it's
            // possible to insert new siblings after it, and/or replace the node with a different one. This can be used to
            // implement custom binding syntaxes, such as {{ value }} for string interpolation, or custom element types that
            // trigger insertion of <template> contents at that point in the document.
            if (bindingProviderInstance.preprocessNode) {
                while (currentChild = nextInQueue) {
                    nextInQueue = nextSibling(currentChild);
                    bindingProviderInstance.preprocessNode(currentChild);
                }
                // Reset nextInQueue for the next loop
                nextInQueue = firstChild(elementOrVirtualElement);
            }

            while (currentChild = nextInQueue) {
                // Keep a record of the next child *before* applying bindings, in case the binding removes the current child from its position
                nextInQueue = nextSibling(currentChild);
                _applyBindingsToNodeAndDescendantsInternal(bindingContext, currentChild);
            }
        }
        bindingEvent.notify(elementOrVirtualElement, EVENT_CHILDREN_COMPLETE);
    }

    function _applyBindingsToNodeAndDescendantsInternal(bindingContext, nodeVerified) {
        let bindingContextForDescendants = bindingContext;

        let isElement = (nodeVerified.nodeType === 1);
        if (isElement) {// Workaround IE <= 8 HTML parsing weirdness
            normaliseVirtualElementDomStructure(nodeVerified);
        }

        // Perf optimisation: Apply bindings only if...
        // (1) We need to store the binding info for the node (all element nodes)
        // (2) It might have bindings (e.g., it has a data-bind attribute, or it's a marker for a containerless template)
        let shouldApplyBindings = isElement || bindingProviderInstance.nodeHasBindings(nodeVerified);
        if (shouldApplyBindings) {
            bindingContextForDescendants = _applyBindingsToNodeInternal(nodeVerified, null, bindingContext)['bindingContextForDescendants'];
        }
        if (bindingContextForDescendants && !BINDING_DOES_NOT_RECURSE_INTO_ELEMENT_TYPES[nodeVerified.tagName]) {
            _applyBindingsToDescendantsInternal(bindingContextForDescendants, nodeVerified);
        }
    }

    function _topologicalSortBindings(bindings) {
        // Depth-first sort
        let result = [],                // The list of key/handler pairs that we will return
            bindingsConsidered = {},    // A temporary record of which bindings are already in 'result'
            cyclicDependencyStack = [], // Keeps track of a depth-search so that, if there's a cycle, we know which bindings caused it
            _pushBinding = bindingKey => {
                if (bindingsConsidered[bindingKey]) {
                    return;
                }
                bindingsConsidered[bindingKey] = true;
                let binding = getBindingHandler(bindingKey);
                if (!binding) {
                    return;
                }
                let bindingAfter = binding.after;
                // First add dependencies (if any) of the current binding
                if (bindingAfter) {
                    cyclicDependencyStack.push(bindingKey);
                    for (let bindingDependencyKey of bindingAfter) {
                        if (bindings[bindingDependencyKey]) {
                            if (cyclicDependencyStack.includes(bindingDependencyKey)) {
                                throw Error("Cannot combine the following bindings, because they have a cyclic dependency: " + cyclicDependencyStack.join(", "));
                            }
                            _pushBinding(bindingDependencyKey);
                        }
                    }
                    cyclicDependencyStack.length--;
                }
                // Next add the current binding
                result.push({key: bindingKey, handler: binding});
            };

        for (let bindingKey of Object.keys(bindings)) {
            _pushBinding(bindingKey);
        }
        return result;
    }

    const _applyBindingsToNodeInternal = (node, sourceBindings, bindingContext) => {
        let bindingInfo = getOrSetDomData(node, BOUND_ELEMENT_DOM_DATA_KEY, {});

        // Prevent multiple applyBindings calls for the same node, except when a binding value is specified
        let alreadyBound = bindingInfo.alreadyBound;
        if (!sourceBindings) {
            if (alreadyBound) {
                throw Error("You cannot apply bindings multiple times to the same element.");
            }
            bindingInfo.alreadyBound = true;
        }
        if (!alreadyBound) {
            bindingInfo.context = bindingContext;
        }
        if (!bindingInfo.notifiedEvents) {
            bindingInfo.notifiedEvents = {};
        }

        // Use bindings if given, otherwise fall back on asking the bindings provider to give us some bindings
        let bindings,
            bindingsUpdater;

        if (sourceBindings && typeof sourceBindings !== 'function') {
            bindings = sourceBindings;
        } else {
            // Get the binding from the provider within a computed observable so that we can update the bindings whenever
            // the binding context is updated or if the binding provider accesses observables.
            bindingsUpdater = dependentObservable(() => {
                if (sourceBindings) {
                    bindings = sourceBindings(bindingContext, node);
                } else if (bindingProviderInstance.getBindingAccessors) {
                    bindings = bindingProviderInstance.getBindingAccessors(node, bindingContext);
                } else {
                    // If binding provider doesn't include a getBindingAccessors function, we add it now.
                    bindings = _makeAccessorsFromFunction(bindingProviderInstance.getBindings.bind(bindingProviderInstance, node, bindingContext));
                }
                // Register a dependency on the binding context to support observable view models.
                if (bindings) {
                    let ctxSubscribable = bindingContext[CONTEXT_SUBSCRIBABLE],
                        ctxDataDependency = bindingContext[CONTEXT_DATA_DEPENDENCY];
                    if (ctxSubscribable){
                        ctxSubscribable();
                    } 
                    if (ctxDataDependency) {
                        ctxDataDependency();
                    }
                }
                return bindings;
            }, null, {disposeWhenNodeIsRemoved: node});

            if (!bindings || !bindingsUpdater.isActive()) {
                bindingsUpdater = null;
            }
        }

        let contextToExtend = bindingContext,
            bindingHandlerThatControlsDescendantBindings;

        if (bindings) {
            // Return the value accessor for a given binding. When bindings are static (won't be updated because of a binding
            // context update), just return the value accessor from the binding. Otherwise, return a function that always gets
            // the latest binding value and registers a dependency on the binding updater.
            let getValueAccessor = bindingsUpdater ? 
                                        (bindingKey) => () => bindingsUpdater()[bindingKey]() : 
                                        (bindingKey) => bindings[bindingKey];

            let allBindings = () => {
                throw new Error('Use of allBindings as a function is no longer supported');
            };

            // The following is the 3.x allBindings API
            allBindings.get = (key) => bindings[key] && getValueAccessor(key)();
            allBindings.has = (key) => key in bindings;

            if (EVENT_CHILDREN_COMPLETE in bindings) {
                bindingEvent.subscribe(node, EVENT_CHILDREN_COMPLETE, () => {
                    let callback = bindings[EVENT_CHILDREN_COMPLETE]();
                    if (callback) {
                        let nodes = childNodes(node);
                        if (nodes.length) {
                            callback(nodes, dataFor(nodes[0]));
                        }
                    }
                });
            }

            if (EVENT_DESCENDENTS_COMPLETE in bindings) {
                contextToExtend = bindingEvent.startPossiblyAsyncContentBinding(node, bindingContext);
                bindingEvent.subscribe(node, EVENT_DESCENDENTS_COMPLETE, () => {
                    let callback = bindings[EVENT_DESCENDENTS_COMPLETE]();
                    if (callback && firstChild(node)) {
                        callback(node);
                    }
                });
            }

            // First put the bindings into the right order
            let orderedBindings = _topologicalSortBindings(bindings);

            // Go through the sorted bindings, calling init and update for each
            orderedBindings.forEach(bindingKeyAndHandler => {
                // Note that topologicalSortBindings has already filtered out any nonexistent binding handlers,
                // so bindingKeyAndHandler.handler will always be nonnull.
                let handlerInitFn = bindingKeyAndHandler.handler.init,
                    handlerUpdateFn = bindingKeyAndHandler.handler.update,
                    bindingKey = bindingKeyAndHandler.key;

                if (node.nodeType === 8 && !allowedVirtualElementBindings[bindingKey]) {
                    throw new Error("The binding '" + bindingKey + "' cannot be used with virtual elements");
                }

                try {
                    // Run init, ignoring any dependencies
                    if (typeof handlerInitFn === 'function') {
                        ignoreDependencyDetection(() => {
                            let initResult = handlerInitFn(node, getValueAccessor(bindingKey), allBindings, contextToExtend['$data'], contextToExtend);

                            // If this binding handler claims to control descendant bindings, make a note of this
                            if (initResult && initResult['controlsDescendantBindings']) {
                                if (bindingHandlerThatControlsDescendantBindings !== undefined) {
                                    throw new Error("Multiple bindings (" + bindingHandlerThatControlsDescendantBindings + " and " + bindingKey + ") are trying to control descendant bindings of the same element. You cannot use these bindings together on the same element.");
                                }
                                bindingHandlerThatControlsDescendantBindings = bindingKey;
                            }
                        });
                    }

                    // Run update in its own computed wrapper
                    if (typeof handlerUpdateFn === 'function') {
                        dependentObservable(
                            () => handlerUpdateFn(node, getValueAccessor(bindingKey), allBindings, contextToExtend['$data'], contextToExtend),
                            null,
                            {disposeWhenNodeIsRemoved: node}
                        );
                    }
                } catch (ex) {
                    ex.message = `Unable to process binding "${bindingKey}: ${bindings[bindingKey]}"\nMessage:  + ${ex.message}`;
                    throw ex;
                }
            });
        }

        let shouldBindDescendants = bindingHandlerThatControlsDescendantBindings === undefined;
        return {
            shouldBindDescendants,
            bindingContextForDescendants: shouldBindDescendants && contextToExtend
        };
    };

    const _getBindingContext = (viewModelOrBindingContext, extendContextCallback) => {
        if (viewModelOrBindingContext && viewModelOrBindingContext[IS_BINDING_CONTEXT_INSTANCE]) {
            return viewModelOrBindingContext;
        }
        return new KoBindingContext(viewModelOrBindingContext, undefined, undefined, extendContextCallback);
    };

    const applyBindingAccessorsToNode = (node, bindings, viewModelOrBindingContext) => {
        if (node.nodeType === 1) {
            // If it's an element, workaround IE <= 8 HTML parsing weirdness
            normaliseVirtualElementDomStructure(node);
        }
        return _applyBindingsToNodeInternal(node, bindings, _getBindingContext(viewModelOrBindingContext));
    };

    const applyBindingsToNode = (node, bindings, viewModelOrBindingContext) => {
        let context = _getBindingContext(viewModelOrBindingContext);
        return applyBindingAccessorsToNode(node, _makeBindingAccessors(bindings, context, node), context);
    };

    const applyBindingsToDescendants = (viewModelOrBindingContext, rootNode) => {
        if (rootNode.nodeType === 1 || rootNode.nodeType === 8) {
            _applyBindingsToDescendantsInternal(_getBindingContext(viewModelOrBindingContext), rootNode);
        }
    };

    const applyBindings = function(viewModelOrBindingContext, rootNode, extendContextCallback) {
        if (arguments.length < 2) {
            rootNode = document.body;
            if (!rootNode) {
                throw Error("ko.applyBindings: could not find document.body; has the document been loaded?");
            }
        } else if (!rootNode || (rootNode.nodeType !== 1 && rootNode.nodeType !== 8)) {
            throw Error("ko.applyBindings: first parameter should be your view model; second parameter should be a DOM node");
        }
        _applyBindingsToNodeAndDescendantsInternal(_getBindingContext(viewModelOrBindingContext, extendContextCallback), rootNode);
    };

    // Retrieving binding context from arbitrary nodes
    // We can only do something meaningful for elements and comment nodes (in particular, not text nodes, as IE can't store domdata for them)
    const contextFor = (node) => {
        let bindingInfo = node && (node.nodeType === 1 || node.nodeType === 8) && getDomData(node, BOUND_ELEMENT_DOM_DATA_KEY);
        return bindingInfo ? bindingInfo.context : undefined;
    };

    const dataFor = (node) => {
        // violating DRY here to save extra calls, and copy bindingInfo-retrieval code from ko.contextFor 
        let bindingInfo = node && (node.nodeType === 1 || node.nodeType === 8) && getDomData(node, BOUND_ELEMENT_DOM_DATA_KEY),
            context = bindingInfo && bindingInfo.context;
        return context ? context.$data : undefined;
    };

    const LATEST_VALUE_KEY = Symbol('_latestValue');

    const observable = function (initialValue) {

        let _observable = function () {
            let _self = _observable,
                _lastValue = _self[LATEST_VALUE_KEY];

            // Lets assume, read happens more often than write
            if (!arguments.length) {
                // Read
                registerDependency(_self); // The caller only needs to be notified of changes if they did a "read" operation
                return _lastValue;
            }
            // Write
            // Ignore writes if the value hasn't changed
            let newValue = arguments[0],
                equalityComparer = _self.equalityComparer;
            
            if (!equalityComparer || !equalityComparer(_lastValue, newValue)) {
                _self.valueWillMutate();
                _self[LATEST_VALUE_KEY] = newValue;
                _self.valueHasMutated();
            }
            return this; // Permits chained assignments (on the parent view model, not the observable)
        };

        _observable[LATEST_VALUE_KEY] = initialValue;

        // Inherit from './subscribable.js'
        if (!canSetPrototype) {
            // 'subscribable' won't be on the prototype chain unless we put it there directly
            Object.assign(_observable, SUBSCRIBABLE_PROTOTYPE);
        }
        
        SUBSCRIBABLE_PROTOTYPE.init(_observable);

        // Inherit from './observable.js'
        setPrototypeOfOrExtend(_observable, OBSERVABLE_PROTOTYPE);

        if (options.deferUpdates) {
            deferredExtender(_observable, true);
        }

        return _observable;
    };

    // Define prototype for observables
    const OBSERVABLE_PROTOTYPE = {
        [IS_OBSERVABLE]: true,
        equalityComparer: valuesArePrimitiveAndEqual,
        peek() {
            return this[LATEST_VALUE_KEY];
        },
        valueHasMutated() {
            this.notifySubscribers(this[LATEST_VALUE_KEY], 'spectate');
            this.notifySubscribers(this[LATEST_VALUE_KEY]);
        },
        valueWillMutate() {
            this.notifySubscribers(this[LATEST_VALUE_KEY], 'beforeChange');
        }
    };

    observable.fn = OBSERVABLE_PROTOTYPE;

    // Note that for browsers that don't support proto assignment, the
    // inheritance chain is created manually in the ko.observable constructor
    trySetPrototypeOf(OBSERVABLE_PROTOTYPE, SUBSCRIBABLE_PROTOTYPE);

    // Go through the items that have been added and deleted and try to find matches between them.
    const findMovesInArrayComparison = (left, right, limitFailedCompares) => {
        if (!left.length || !right.length) {
            return;
        }
        let failedCompares = 0, leftItem, rightItem;
        
        for (let l = 0, r;(!limitFailedCompares || failedCompares < limitFailedCompares) && (leftItem = left[l]); ++l) {
            for (r = 0; (rightItem = right[r]); ++r) {
                if (leftItem['value'] === rightItem['value']) {
                    leftItem['moved'] = rightItem['index'];
                    rightItem['moved'] = leftItem['index'];
                    right.splice(r, 1);         // This item is marked as moved; so remove it from right list
                    failedCompares = r = 0;     // Reset failed compares count because we're checking for consecutive failures
                    break;
                }
            }
            failedCompares += r;
        }
    };

    // Simple calculation based on Levenshtein distance.
    let compareArrays = (oldArray, newArray, options) => {
        // For backward compatibility, if the third arg is actually a bool, interpret
        // it as the old parameter 'dontLimitMoves'. Newer code should use { dontLimitMoves: true }.
        options = (typeof options === 'boolean') ? {'dontLimitMoves': options} : (options || {});
        oldArray = oldArray || [];
        newArray = newArray || [];

        return (oldArray.length < newArray.length) ?
             compareSmallArrayToBigArray(oldArray, newArray, STATUS_NOT_IN_OLD, STATUS_NOT_IN_NEW, options) :
             compareSmallArrayToBigArray(newArray, oldArray, STATUS_NOT_IN_NEW, STATUS_NOT_IN_OLD, options);
    };

    // allow overriding compareArrays for tests
    const _overrideCompareArrays = fn => compareArrays = fn;

    const STATUS_NOT_IN_OLD = 'added'; 
    const STATUS_NOT_IN_NEW = 'deleted';

    function compareSmallArrayToBigArray(smlArray, bigArray, statusNotInSml, statusNotInBig, options) {
        let myMin = Math.min,
            myMax = Math.max,
            editDistanceMatrix = [],
            smlIndex, smlIndexMax = smlArray.length,
            bigIndex, bigIndexMax = bigArray.length,
            compareRange = (bigIndexMax - smlIndexMax) || 1,
            maxDistance = smlIndexMax + bigIndexMax + 1,
            thisRow, lastRow,
            bigIndexMaxForRow, bigIndexMinForRow;

        for (smlIndex = 0; smlIndex <= smlIndexMax; smlIndex++) {
            lastRow = thisRow;
            editDistanceMatrix.push(thisRow = []);
            bigIndexMaxForRow = myMin(bigIndexMax, smlIndex + compareRange);
            bigIndexMinForRow = myMax(0, smlIndex - 1);
            for (bigIndex = bigIndexMinForRow; bigIndex <= bigIndexMaxForRow; bigIndex++) {
                if (!bigIndex) {
                    thisRow[bigIndex] = smlIndex + 1;
                } else if (!smlIndex) { // Top row - transform empty array into new array via additions
                    thisRow[bigIndex] = bigIndex + 1;
                } else if (smlArray[smlIndex - 1] === bigArray[bigIndex - 1]) {
                    thisRow[bigIndex] = lastRow[bigIndex - 1];                  // copy value (no edit)
                } else {
                    let northDistance = lastRow[bigIndex] || maxDistance;       // not in big (deletion)
                    let westDistance = thisRow[bigIndex - 1] || maxDistance;    // not in small (addition)
                    thisRow[bigIndex] = myMin(northDistance, westDistance) + 1;
                }
            }
        }

        let editScript = [], meMinusOne, notInSml = [], notInBig = [], nextEditScriptIndex = 0;
        for (smlIndex = smlIndexMax, bigIndex = bigIndexMax; smlIndex || bigIndex;) {
            meMinusOne = editDistanceMatrix[smlIndex][bigIndex] - 1;
            if (bigIndex && meMinusOne === editDistanceMatrix[smlIndex][bigIndex - 1]) {
                notInSml.push(editScript[nextEditScriptIndex++] = {     // added
                    'status': statusNotInSml,
                    'value': bigArray[--bigIndex],
                    'index': bigIndex
                });
            } else if (smlIndex && meMinusOne === editDistanceMatrix[smlIndex - 1][bigIndex]) {
                notInBig.push(editScript[nextEditScriptIndex++] = {     // deleted
                    'status': statusNotInBig,
                    'value': smlArray[--smlIndex],
                    'index': smlIndex
                });
            } else {
                --bigIndex;
                --smlIndex;
                if (!options['sparse']) {
                    editScript[nextEditScriptIndex++] = {
                        'status': "retained",
                        'value': bigArray[bigIndex]
                    };
                }
            }
        }

        // Set a limit on the number of consecutive non-matching comparisons; having it a multiple of
        // smlIndexMax keeps the time complexity of this algorithm linear.
        findMovesInArrayComparison(notInBig, notInSml, !options['dontLimitMoves'] && smlIndexMax * 10);

        return editScript.reverse();
    }

    const ARRAY_CHANGE_EVENT_NAME = 'arrayChange';

    const trackArrayChanges = extenders.trackArrayChanges = (target, options) => {
        // Use the provided options--each call to trackArrayChanges overwrites the previously set options
        target.compareArrayOptions = {};
        if (options && typeof options === "object") {
            Object.assign(target.compareArrayOptions, options);
        }
        target.compareArrayOptions.sparse = true;

        // Only modify the target observable once
        if (target.cacheDiffForKnownOperation) {
            return;
        }
        let trackingChanges = false,
            cachedDiff = null,
            changeSubscription,
            spectateSubscription,
            pendingChanges = 0,
            previousContents,
            underlyingBeforeSubscriptionAddFunction = target.beforeSubscriptionAdd,
            underlyingAfterSubscriptionRemoveFunction = target.afterSubscriptionRemove;

        // Watch "subscribe" calls, and for array change events, ensure change tracking is enabled
        target.beforeSubscriptionAdd = (event) => {
            if (underlyingBeforeSubscriptionAddFunction) {
                underlyingBeforeSubscriptionAddFunction.call(target, event);
            }
            if (event === ARRAY_CHANGE_EVENT_NAME) {
                _trackChanges();
            }
        };
        // Watch "dispose" calls, and for array change events, ensure change tracking is disabled when all are disposed
        target.afterSubscriptionRemove = (event) => {
            if (underlyingAfterSubscriptionRemoveFunction) {
                underlyingAfterSubscriptionRemoveFunction.call(target, event);
            }
            if (event === ARRAY_CHANGE_EVENT_NAME && !target.hasSubscriptionsForEvent(ARRAY_CHANGE_EVENT_NAME)) {
                if (changeSubscription) {
                    changeSubscription.dispose();
                }
                if (spectateSubscription) {
                    spectateSubscription.dispose();
                }
                spectateSubscription = changeSubscription = null;
                trackingChanges = false;
                previousContents = undefined;
            }
        };

        const _trackChanges = () => {
            if (trackingChanges) {
                // Whenever there's a new subscription and there are pending notifications, make sure all previous
                // subscriptions are notified of the change so that all subscriptions are in sync.
                notifyChanges();
                return;
            }

            trackingChanges = true;

            // Track how many times the array actually changed value
            spectateSubscription = target.subscribe(() => ++pendingChanges, null, "spectate");

            // Each time the array changes value, capture a clone so that on the next
            // change it's possible to produce a diff
            previousContents = [].concat(target.peek() || []);
            cachedDiff = null;
            changeSubscription = target.subscribe(notifyChanges);

            function notifyChanges() {
                if (!pendingChanges) {
                    return;
                }
                // Make a copy of the current contents and ensure it's an array
                let currentContents = [].concat(target.peek() || []), changes;

                    // Compute the diff and issue notifications, but only if someone is listening
                if (target.hasSubscriptionsForEvent(ARRAY_CHANGE_EVENT_NAME)) {
                    changes = _getChanges(previousContents, currentContents);
                }

                // Eliminate references to the old, removed items, so they can be GCed
                previousContents = currentContents;
                cachedDiff = null;
                pendingChanges = 0;

                if (changes && changes.length) {
                    target.notifySubscribers(changes, ARRAY_CHANGE_EVENT_NAME);
                }
            }
        };

        const _getChanges = (previousContents, currentContents) => {
            // We try to re-use cached diffs.
            // The scenarios where pendingChanges > 1 are when using rate limiting or deferred updates,
            // which without this check would not be compatible with arrayChange notifications. Normally,
            // notifications are issued immediately so we wouldn't be queueing up more than one.
            if (!cachedDiff || pendingChanges > 1) {
                cachedDiff = compareArrays(previousContents, currentContents, target.compareArrayOptions);
            }

            return cachedDiff;
        };

        target.cacheDiffForKnownOperation = function(rawArray, operationName, args) {
            // Only run if we're currently tracking changes for this observable array
            // and there aren't any pending deferred notifications.
            if (!trackingChanges || pendingChanges) {
                return;
            }
            let diff = [],
                arrayLength = rawArray.length,
                argsLength = args.length,
                offset = 0,
                _nextPushDiffIndex = 0,
                _pushDiff = (status, value, index) => diff[_nextPushDiffIndex++] = {status, value, index};

            switch (operationName) {
                case 'push':
                    offset = arrayLength; 
                    // eslint-disable-line no-fallthrough
                case 'unshift':
                    for (let index = 0; index < argsLength; index++) {
                        _pushDiff('added', args[index], offset + index);
                    }
                    break;

                case 'pop':
                    offset = arrayLength - 1; 
                    // eslint-disable-line no-fallthrough
                case 'shift':
                    if (arrayLength) {
                        _pushDiff('deleted', rawArray[offset], offset);
                    }
                    break;

                case 'splice': {
                    // Negative start index means 'from end of array'. After that we clamp to [0...arrayLength].
                    // See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/splice
                    let startIndex = Math.min(Math.max(0, args[0] < 0 ? arrayLength + args[0] : args[0]), arrayLength),
                        endDeleteIndex = argsLength === 1 ? arrayLength : Math.min(startIndex + (args[1] || 0), arrayLength),
                        endAddIndex = startIndex + argsLength - 2,
                        endIndex = Math.max(endDeleteIndex, endAddIndex),
                        additions = [],
                        nextAdditionIndex = 0,
                        deletions = [],
                        nextDeletionIndex = 0;

                    for (let index = startIndex, argsIndex = 2; index < endIndex; ++index, ++argsIndex) {
                        if (index < endDeleteIndex) {
                            deletions[nextDeletionIndex++] = _pushDiff('deleted', rawArray[index], index);
                        }
                        if (index < endAddIndex) {
                            additions[nextAdditionIndex++] = _pushDiff('added', args[argsIndex], index);
                        }
                    }
                    findMovesInArrayComparison(deletions, additions);
                    break;
                }
                default:
                    return;
            }
            cachedDiff = diff;
        };
    };

    const observableArray = function (initialValues) {
        initialValues = initialValues || [];

        if (!Array.isArray(initialValues)) {
            throw new Error('The argument passed when initializing an observable array must be an array, or null, or undefined.');
        }
        let result = observable(initialValues);
        setPrototypeOfOrExtend(result, OBSERVABLE_ARRAY_PROTOTYPE);
        trackArrayChanges(result);
        return result;
    };

    const OBSERVABLE_ARRAY_PROTOTYPE = {
        [IS_OBSERVABLE_ARRAY]: true,
        remove(valueOrPredicate) {
            let underlyingArray = this.peek(),
                removedValues = [],
                totalRemovedValues = 0,
                predicate = typeof valueOrPredicate === 'function' && !isObservable(valueOrPredicate) ? valueOrPredicate : (value) => value === valueOrPredicate;
            
             for (let i = 0; i < underlyingArray.length; i++) {
                let value = underlyingArray[i];
                if (predicate(value)) {
                    if (!totalRemovedValues) {
                        this.valueWillMutate();
                    }
                    if (underlyingArray[i] !== value) {
                        throw Error('Array modified during remove; cannot remove item');
                    }
                    totalRemovedValues = removedValues.push(value);
                    underlyingArray.splice(i, 1);
                    i--;
                }
            }
            if (totalRemovedValues) {
                this.valueHasMutated();
            }
            return removedValues;
        },

        removeAll(arrayOfValues) {
            // If you passed zero args, we remove everything
            if (arrayOfValues === undefined) {
                let underlyingArray = this.peek(),
                    allValues = underlyingArray.slice();
                
                this.valueWillMutate();
                underlyingArray.splice(0, underlyingArray.length);
                this.valueHasMutated();
                return allValues;
            }
            // If you passed an arg, we interpret it as an array of entries to remove
            return arrayOfValues ? this.remove(value => arrayOfValues.includes(value)) : [];
        },

        destroy(valueOrPredicate) {
            let underlyingArray = this.peek(),
                predicate = typeof valueOrPredicate === 'function' && !isObservable(valueOrPredicate) ? valueOrPredicate : (value) => value === valueOrPredicate;
            this.valueWillMutate();
            for (let i = underlyingArray.length - 1; i >= 0; i--) {
                let value = underlyingArray[i];
                if (predicate(value)) {
                    value['_destroy'] = true;
                }
            }
            this.valueHasMutated();
        },

        destroyAll(arrayOfValues) {
            // If you passed zero args, we destroy everything

            // If you passed an arg, we interpret it as an array of entries to destroy
            return (arrayOfValues === undefined) ? this.destroy(() => true) : 
                    arrayOfValues ? this.destroy(value => arrayOfValues.includes(value)) : [];
        },

        indexOf(item) {
            return this().indexOf(item);
        },

        replace(oldItem, newItem) {
            let underlyingArray = this(),
                index = underlyingArray.indexOf(oldItem);
            if (index >= 0) {
                this.valueWillMutate();
                underlyingArray[index] = newItem;
                this.valueHasMutated();
            }
        },

        sorted(compareFunction) {
            let arrayCopy = this().slice();
            return compareFunction ? arrayCopy.sort(compareFunction) : arrayCopy.sort();
        },

        reversed() {
            return this().slice().reverse();
        },

        // Populate ko.observableArray.fn with read-only functions from native arrays
        slice() {
            return this().slice(...arguments);
        }
    };

    observableArray.fn = OBSERVABLE_ARRAY_PROTOTYPE;

    // Note that for browsers that don't support proto assignment, the
    // inheritance chain is created manually in the ko.observableArray constructor
    trySetPrototypeOf(OBSERVABLE_ARRAY_PROTOTYPE, OBSERVABLE_PROTOTYPE);

    // Populate ko.observableArray.fn with read/write functions from native arrays
    // Important: Do not add any additional functions here that may reasonably be used to *read* data from the array
    // because we'll eval them without causing subscriptions, so ko.computed output could end up getting stale
    for (let methodName of ['pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift']) {
        OBSERVABLE_ARRAY_PROTOTYPE[methodName] = function () {
            // Use 'peek' to avoid creating a subscription in any computed that we're executing in the context of
            // (for consistency with mutating regular observables)
            let underlyingArray = this.peek();
            this.valueWillMutate();
            this.cacheDiffForKnownOperation(underlyingArray, methodName, arguments);
            let methodCallResult = underlyingArray[methodName].apply(underlyingArray, arguments);
            this.valueHasMutated();
            // The native sort and reverse methods return a reference to the array, but it makes more sense to return the observable array instead.
            return methodCallResult === underlyingArray ? this : methodCallResult;
        };
    }

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


    const memoize = (callback) => {
        if (typeof callback !== "function") {
            throw new Error("You can only pass a function to ko.memoization.memoize()");
        }
        let memoId = _generateRandomId();
        _memosMap.set(memoId, callback);
        return "<!--[ko_memo:" + memoId + "]-->";
    };

    const unmemoize = (memoId, callbackParams) => {
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

    const unmemoizeDomNodeAndDescendants = (domNode, extraCallbackParamsArray) => {
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

    const parseMemoText = (memoText) => {
        let match = memoText.match(/^\[ko_memo:(.*?)]$/);
        return match ? match[1] : null;
    };

    const MEMOIZE_DATA_BINDING_ATTR_SYNTAX_REGEX = /(<([a-z]+\d*)(?:\s+(?!data-bind\s*=\s*)[a-z0-9-]+(?:=(?:"[^"]*"|'[^']*'|[^>]*))?)*\s+)data-bind\s*=\s*(["'])([\s\S]*?)\3/gi;
    const MEMOIZE_VIRTUAL_CONTAINER_BINDING_SYNTAX_REGEX = /<!--\s*ko\b\s*([\s\S]*?)\s*-->/g;

    const _validateDataBindValuesForRewriting = (keyValueArray) => {
        let allValidators = bindingRewriteValidators;
        for (let {key, value} of keyValueArray) {
            // we can assume allValidators is an augmented Array and has the `hasOwnProperty` method
            if (allValidators.hasOwnProperty(key)) {
                let validator = allValidators[key];

                if (typeof validator === 'function') {
                    let possibleErrorMessage = validator(value);
                    if (possibleErrorMessage) {
                        throw new Error(possibleErrorMessage);
                    }
                } else if (!validator) {
                    throw new Error('This template engine does not support the \'' + key + '\' binding within its templates');
                }
            }
        }
    };

    const _constructMemoizedTagReplacement = (dataBindAttributeValue, tagToRetain, nodeName, templateEngine) => {
        let dataBindKeyValueArray = parseObjectLiteral(dataBindAttributeValue);
        _validateDataBindValuesForRewriting(dataBindKeyValueArray);
        let rewrittenDataBindAttributeValue = preProcessBindings(dataBindKeyValueArray, {valueAccessors: true});

        // For no obvious reason, Opera fails to evaluate rewrittenDataBindAttributeValue unless it's wrapped in an additional
        // anonymous function, even though Opera's built-in debugger can evaluate it anyway. No other browser requires this
        // extra indirection.
        let applyBindingsToNextSiblingScript =
            'ko.__tr_ambtns(function($context,$element){return(function(){return{ ' + rewrittenDataBindAttributeValue + ' } })()},\'' + nodeName.toLowerCase() + '\')';
        return templateEngine.createJavaScriptEvaluatorBlock(applyBindingsToNextSiblingScript) + tagToRetain;
    };

    const applyMemoizedBindingsToNextSibling = (bindings, nodeName) => memoize((domNode, bindingContext) => {
        let nodeToBind = domNode.nextSibling;
        if (nodeToBind && nodeToBind.nodeName.toLowerCase() === nodeName) {
            applyBindingAccessorsToNode(nodeToBind, bindings, bindingContext);
        }
    });


    const ensureTemplateIsRewritten = (template, templateEngine, templateDocument) => {
        if (templateEngine.isTemplateRewritten(template, templateDocument)) {
            return;
        }
        templateEngine.rewriteTemplate(template, htmlString => memoizeBindingAttributeSyntax(htmlString, templateEngine), templateDocument);
    };

    const memoizeBindingAttributeSyntax = (htmlString, templateEngine) => {
        return htmlString
            .replace(MEMOIZE_DATA_BINDING_ATTR_SYNTAX_REGEX,
                (_0, tagToRetain, nodeName, _3, dataBindAttributeValue) => _constructMemoizedTagReplacement(dataBindAttributeValue, tagToRetain, nodeName, templateEngine))
            .replace(MEMOIZE_VIRTUAL_CONTAINER_BINDING_SYNTAX_REGEX,
                (_0, dataBindAttributeValue) => _constructMemoizedTagReplacement(dataBindAttributeValue, /* tagToRetain: */ '<!-- ko -->', /* nodeName: */ '#comment', templateEngine));
    };

    const MAX_NESTED_OBSERVABLE_DEPTH = 10; // Escape the (unlikely) pathological case where an observable's current value is itself (or similar reference cycle)

    const toJS = function (rootObject) {
        if (!arguments.length) {
            throw new Error("When calling ko.toJS, pass the object you want to convert.");
        }

        // We just unwrap everything at every level in the object graph
        return _mapJsObjectGraph(rootObject, valueToMap => {
            // Loop because an observable's value might in turn be another observable wrapper
            for (let i = 0; isObservable(valueToMap) && (i < MAX_NESTED_OBSERVABLE_DEPTH); i++) {
                valueToMap = valueToMap();
            }
            return valueToMap;
        });
    };

    // replacer and space are optional
    const toJSON = (rootObject, replacer, space) => {
        let plainJavaScriptObject = toJS(rootObject);
        return JSON.stringify(unwrapObservable(plainJavaScriptObject), replacer, space);
    };

    const _mapJsObjectGraph = (rootObject, mapInputCallback, visitedObjects) => {
        visitedObjects = visitedObjects || new Map();

        rootObject = mapInputCallback(rootObject);
        let canHaveProperties = (typeof rootObject === "object") && (rootObject !== null) && (rootObject !== undefined) &&
            (!(rootObject instanceof RegExp)) && (!(rootObject instanceof Date)) && (!(rootObject instanceof String)) &&
            (!(rootObject instanceof Number)) && (!(rootObject instanceof Boolean));
        if (!canHaveProperties) {
            return rootObject;
        }

        let outputProperties = Array.isArray(rootObject) ? [] : {};
        visitedObjects.set(rootObject, outputProperties);

        _visitPropertiesOrArrayEntries(rootObject, indexer => {
            let propertyValue = mapInputCallback(rootObject[indexer]);

            switch (typeof propertyValue) {
                case 'boolean':
                case 'number':
                case 'string':
                case 'function':
                    outputProperties[indexer] = propertyValue;
                    break;
                case 'object':
                case 'undefined': {
                    let previouslyMappedValue = visitedObjects.get(propertyValue);
                    outputProperties[indexer] = (previouslyMappedValue !== undefined)
                        ? previouslyMappedValue
                        : _mapJsObjectGraph(propertyValue, mapInputCallback, visitedObjects);
                    break;
                }
            }
        });

        return outputProperties;
    };

    const _visitPropertiesOrArrayEntries = (rootObject, visitorCallback) => {
        if (rootObject instanceof Array) {
            for (let i = 0; i < rootObject.length; i++) {
                visitorCallback(i);
            }

            // For arrays, also respect toJSON property for custom mappings (fixes #278)
            if (typeof rootObject['toJSON'] === 'function') {
                visitorCallback('toJSON');
            }
        } else {
            for (let propertyName in rootObject) {
                visitorCallback(propertyName);
            }
        }
    };

    const LAST_MAPPING_RESULT_DOM_DATA_KEY = nextDomDataKey();
    const DELETED_ITEM_DUMMY_VALUE = nextDomDataKey();

    // Objective:
    // * Given an input array, a container DOM node, and a function from array elements to arrays of DOM nodes,
    //   map the array elements to arrays of DOM nodes, concatenate together all these arrays, and use them to populate the container DOM node
    // * Next time we're given the same combination of things (with the array possibly having mutated), update the container DOM node
    //   so that its children is again the concatenation of the mappings of the array elements, but don't re-map any array elements that we
    //   previously mapped - retain those nodes, and just insert/delete other ones

    // "callbackAfterAddingNodes" will be invoked after any "mapping"-generated nodes are inserted into the container node
    // You can use this, for example, to activate bindings on those nodes.

    const _mapNodeAndRefreshWhenChanged = (containerNode, mapping, valueToMap, callbackAfterAddingNodes, index) => {
        // Map this array value inside a dependentObservable so we re-map when any dependency changes
        let mappedNodes = [];
        let _dependentObservable = dependentObservable(() => {
                let newMappedNodes = mapping(valueToMap, index, fixUpContinuousNodeArray(mappedNodes, containerNode)) || [];

                // On subsequent evaluations, just replace the previously-inserted DOM nodes
                if (mappedNodes.length) {
                    replaceDomNodes(mappedNodes, newMappedNodes);
                    if (callbackAfterAddingNodes) {
                        ignoreDependencyDetection(callbackAfterAddingNodes, null, [valueToMap, newMappedNodes, index]);
                    }
                }

                // Replace the contents of the mappedNodes array, thereby updating the record
                // of which nodes would be deleted if valueToMap was itself later removed
                mappedNodes.length = 0;
                
                for (let i = 0, len = newMappedNodes.length; i < len; i++) {
                    mappedNodes[i] = newMappedNodes[i];
                }
                
            }, null, {
                disposeWhenNodeIsRemoved: containerNode, 
                disposeWhen: () => !anyDomNodeIsAttachedToDocument(mappedNodes)
            });
        
        return {
            mappedNodes,
            dependentObservable: _dependentObservable.isActive() ? _dependentObservable : undefined
        };
    };

    const setDomNodeChildrenFromArrayMapping = (domNode, array, mapping, options, callbackAfterAddingNodes, editScript) => {
        array = array || [];
        if (typeof array.length === 'undefined') { 
            array = [array]; // Coerce single value into array
        }

        options = options || {};
        let lastMappingResult = getDomData(domNode, LAST_MAPPING_RESULT_DOM_DATA_KEY);
        let isFirstExecution = !lastMappingResult;

        // Build the new mapping result
        let newMappingResult = [];
        let lastMappingResultIndex = 0;
        let currentArrayIndex = 0;

        let nodesToDelete = [];
        let itemsToMoveFirstIndexes = [];
        let itemsForBeforeRemoveCallbacks = [];
        let itemsForMoveCallbacks = [];
        let itemsForAfterAddCallbacks = [];
        let mapData;
        let countWaitingForRemove = 0;

        const _itemAdded = (value) => {
            mapData = {arrayEntry: value, indexObservable: observable(currentArrayIndex++)};
            newMappingResult.push(mapData);
            if (!isFirstExecution) {
                itemsForAfterAddCallbacks.push(mapData);
            }
        };

        const _itemMovedOrRetained = (oldPosition) => {
            mapData = lastMappingResult[oldPosition];
            let _indexObservable = mapData.indexObservable;
            if (currentArrayIndex !== _indexObservable.peek()) {
                itemsForMoveCallbacks.push(mapData);
            }
            // Since updating the index might change the nodes, do so before calling fixUpContinuousNodeArray
            _indexObservable(currentArrayIndex++);
            fixUpContinuousNodeArray(mapData.mappedNodes, domNode);
            newMappingResult.push(mapData);
        };

        const _callCallback = (callback, items) => {
            for (let i = 0, len = items.length; i < len; i++) {
                let item = items[i];
                for (let node of item.mappedNodes) {
                    callback(node, i, item.arrayEntry);
                }
            }
        };

        if (isFirstExecution) {
            array.length && arrayForEach(array, _itemAdded);
        } else {
            if (!editScript || (lastMappingResult && lastMappingResult['_countWaitingForRemove'])) {
                // Compare the provided array against the previous one
                let lastArray = lastMappingResult.map(x => x.arrayEntry),
                    compareOptions = {
                        'dontLimitMoves': options['dontLimitMoves'],
                        'sparse': true
                    };
                editScript = compareArrays(lastArray, array, compareOptions);
            }

            for (let i = 0, editScriptItem, movedIndex, itemIndex; editScriptItem = editScript[i]; i++) {
                movedIndex = editScriptItem['moved'];
                itemIndex = editScriptItem['index'];
                switch (editScriptItem['status']) {
                    case "deleted":
                        while (lastMappingResultIndex < itemIndex) {
                            _itemMovedOrRetained(lastMappingResultIndex++);
                        }
                        if (movedIndex === undefined) {
                            mapData = lastMappingResult[lastMappingResultIndex];

                            // Stop tracking changes to the mapping for these nodes
                            if (mapData.dependentObservable) {
                                mapData.dependentObservable.dispose();
                                mapData.dependentObservable = undefined;
                            }

                            // Queue these nodes for later removal
                            if (fixUpContinuousNodeArray(mapData.mappedNodes, domNode).length) {
                                if (options['beforeRemove']) {
                                    newMappingResult.push(mapData);
                                    countWaitingForRemove++;
                                    if (mapData.arrayEntry === DELETED_ITEM_DUMMY_VALUE) {
                                        mapData = null;
                                    } else {
                                        itemsForBeforeRemoveCallbacks.push(mapData);
                                    }
                                }
                                if (mapData) {
                                    nodesToDelete.push.apply(nodesToDelete, mapData.mappedNodes);
                                }
                            }
                        }
                        lastMappingResultIndex++;
                        break;

                    case "added":
                        while (currentArrayIndex < itemIndex) {
                            _itemMovedOrRetained(lastMappingResultIndex++);
                        }
                        if (movedIndex !== undefined) {
                            itemsToMoveFirstIndexes.push(newMappingResult.length);
                            _itemMovedOrRetained(movedIndex);
                        } else {
                            _itemAdded(editScriptItem['value']);
                        }
                        break;
                }
            }

            while (currentArrayIndex < array.length) {
                _itemMovedOrRetained(lastMappingResultIndex++);
            }

            // Record that the current view may still contain deleted items
            // because it means we won't be able to use a provided editScript.
            newMappingResult['_countWaitingForRemove'] = countWaitingForRemove;
        }

        // Store a copy of the array items we just considered so we can difference it next time
        setDomData(domNode, LAST_MAPPING_RESULT_DOM_DATA_KEY, newMappingResult);

        // Call beforeMove first before any changes have been made to the DOM
        options.beforeMove && _callCallback(options.beforeMove, itemsForMoveCallbacks);

        // Next remove nodes for deleted items (or just clean if there's a beforeRemove callback)
        nodesToDelete.forEach(options.beforeRemove ? cleanNode : removeNode);

        let lastNode, 
            nodeToInsert, 
            mappedNodes;

        // Since most browsers remove the focus from an element when it's moved to another location,
        // save the focused element and try to restore it later.
        let activeElement = domNode.ownerDocument.activeElement;

        // Try to reduce overall moved nodes by first moving the ones that were marked as moved by the edit script
        if (itemsToMoveFirstIndexes.length) {
            let i;
            while ((i = itemsToMoveFirstIndexes.shift()) !== undefined) {
                mapData = newMappingResult[i];
                for (lastNode = undefined; i;) {
                    if ((mappedNodes = newMappingResult[--i].mappedNodes) && mappedNodes.length) {
                        lastNode = mappedNodes[mappedNodes.length - 1];
                        break;
                    }
                }
                for (let j = 0; nodeToInsert = mapData.mappedNodes[j]; lastNode = nodeToInsert, j++) {
                    insertAfter(domNode, nodeToInsert, lastNode);
                }
            }
        }

        // Next add/reorder the remaining items (will include deleted items if there's a beforeRemove callback)
        for (let i = 0; mapData = newMappingResult[i]; i++) {
            // Get nodes for newly added items
            if (!mapData.mappedNodes) {
                Object.assign(mapData, _mapNodeAndRefreshWhenChanged(domNode, mapping, mapData.arrayEntry, callbackAfterAddingNodes, mapData.indexObservable));
            }

            // Put nodes in the right place if they aren't there already
            for (let j = 0; nodeToInsert = mapData.mappedNodes[j]; lastNode = nodeToInsert, j++) {
                insertAfter(domNode, nodeToInsert, lastNode);
            }

            // Run the callbacks for newly added nodes (for example, to apply bindings, etc.)
            if (!mapData.initialized && callbackAfterAddingNodes) {
                callbackAfterAddingNodes(mapData.arrayEntry, mapData.mappedNodes, mapData.indexObservable);
                mapData.initialized = true;
                lastNode = mapData.mappedNodes[mapData.mappedNodes.length - 1];     // get the last node again since it may have been changed by a preprocessor
            }
        }

        // Restore the focused element if it had lost focus
        if (activeElement && domNode.ownerDocument.activeElement !== activeElement) {
            activeElement.focus();
        }

        // If there's a beforeRemove callback, call it after reordering.
        // Note that we assume that the beforeRemove callback will usually be used to remove the nodes using
        // some sort of animation, which is why we first reorder the nodes that will be removed. If the
        // callback instead removes the nodes right away, it would be more efficient to skip reordering them.
        // Perhaps we'll make that change in the future if this scenario becomes more common.
        options.beforeRemove && _callCallback(options.beforeRemove, itemsForBeforeRemoveCallbacks);

        // Replace the stored values of deleted items with a dummy value. This provides two benefits: it marks this item
        // as already "removed" so we won't call beforeRemove for it again, and it ensures that the item won't match up
        // with an actual item in the array and appear as "retained" or "moved".
        for (let i = 0, len = itemsForBeforeRemoveCallbacks.length; i < len; ++i) {
            itemsForBeforeRemoveCallbacks[i].arrayEntry = DELETED_ITEM_DUMMY_VALUE;
        }

        // Finally call afterMove and afterAdd callbacks
        options.afterMove && _callCallback(options.afterMove, itemsForMoveCallbacks);
        options.afterAdd &&  _callCallback(options.afterAdd, itemsForAfterAddCallbacks);
    };

    // A template source represents a read/write way of accessing a template. This is to eliminate the need for template loading/saving
    // logic to be duplicated in every template engine (and means they can all work with anonymous templates, etc.)
    //
    // Two are provided by default:
    //  1. ko.templateSources.domElement       - reads/writes the text content of an arbitrary DOM element
    //  2. ko.templateSources.anonymousElement - uses ko.utils.domData to read/write text *associated* with the DOM element, but
    //                                           without reading/writing the actual element text content, since it will be overwritten
    //                                           with the rendered template output.
    // You can implement your own template source if you want to fetch/store templates somewhere other than in DOM elements.
    // Template sources need to have the following functions:
    //   text()            - returns the template text from your storage location
    //   text(value)       - writes the supplied template text to your storage location
    //   data(key)         - reads values stored using data(key, value) - see below
    //   data(key, value)  - associates "value" with this template and the key "key". Is used to store information like "isRewritten".
    //
    // Optionally, template sources can also have the following functions:
    //   nodes()            - returns a DOM element containing the nodes of this template, where available
    //   nodes(value)       - writes the given DOM element to your storage location
    // If a DOM element is available for a given template source, template engines are encouraged to use it in preference over text()
    // for improved speed. However, all templateSources must supply text() even if they don't supply nodes().
    //
    // Once you've implemented a templateSource, make your template engine use it by subclassing whatever template engine you were
    // using and overriding "makeTemplateSource" to return an instance of your custom template source.

    // ---- ko.templateSources.domElement -----

    // template types
    const TEMPLATE_SCRIPT = 1;
    const TEMPLATE_TEXTAREA = 2;
    const TEMPLATE_TEMPLATE = 3;
    const TEMPLATE_ELEMENT = 4;

    const DOM_DATA_KEY_PREFIX = nextDomDataKey() + '_';
    const TEMPLATES_DOM_DATA_KEY = nextDomDataKey();

    const SKIP_TEMPLATE_TYPE = Symbol();

    class DomElementTemplate {
        constructor(element /*, skipTemplateType */) {
            this.domElement = element;

            if (element && arguments[1] !== SKIP_TEMPLATE_TYPE) {
                let tagNameLower = element.tagName && element.tagName.toLowerCase();
                this.templateType = tagNameLower === 'script' ? TEMPLATE_SCRIPT :
                                    tagNameLower === 'textarea' ? TEMPLATE_TEXTAREA :
                                    // For browsers with proper <template> element support, where the .content property gives a document fragment
                                    tagNameLower === 'template' && element.content && element.content.nodeType === 11 ? TEMPLATE_TEMPLATE : TEMPLATE_ELEMENT;
            }
        }

        text(/* valueToWrite */) {
            let elemContentsProperty = this.templateType === TEMPLATE_SCRIPT ? 'text' : 
                                       this.templateType === TEMPLATE_TEXTAREA ? 'value' : 'innerHTML';

            if (!arguments.length) {
                return this.domElement[elemContentsProperty];
            }
            let valueToWrite = arguments[0];
            if (elemContentsProperty === 'innerHTML') {
                setHtml(this.domElement, valueToWrite);
            } else {
                this.domElement[elemContentsProperty] = valueToWrite;
            }
        }

        data(key /*, valueToWrite */) {
            if (arguments.length === 1) {
                return getDomData(this.domElement, DOM_DATA_KEY_PREFIX + key);
            } 
            setDomData(this.domElement, DOM_DATA_KEY_PREFIX + key, arguments[1]);
        }

        nodes(/* valueToWrite */) {
            let element = this.domElement;
            if (!arguments.length) {
                let templateData = (getDomData(element, TEMPLATES_DOM_DATA_KEY) || {}),
                    nodes = templateData.containerData || (
                            this.templateType === TEMPLATE_TEMPLATE ? element.content :
                            this.templateType === TEMPLATE_ELEMENT ? element : undefined);
                
                if (!nodes || templateData.alwaysCheckText) {
                    // If the template is associated with an element that stores the template as text,
                    // parse and cache the nodes whenever there's new text content available. This allows
                    // the user to update the template content by updating the text of template node.
                    let text = this.text();
                    if (text && text !== templateData.textData) {
                        nodes = parseHtmlForTemplateNodes(text, element.ownerDocument);
                        setDomData(element, TEMPLATES_DOM_DATA_KEY, {containerData: nodes, textData: text, alwaysCheckText: true});
                    }
                }
                return nodes;
            } 
        
            let valueToWrite = arguments[0];
            if (this.templateType !== undefined) {
                this.text('');   // clear the text from the node
            }
            setDomData(element, TEMPLATES_DOM_DATA_KEY, {containerData: valueToWrite});
        }
    }

    // ---- ko.templateSources.anonymousTemplate -----
    // Anonymous templates are normally saved/retrieved as DOM nodes through "nodes".
    // For compatibility, you can also read "text"; it will be serialized from the nodes on demand.
    // Writing to "text" is still supported, but then the template data will not be available as DOM nodes.

    class AnonymousTemplate extends DomElementTemplate {
        constructor(element) {
            super(element, SKIP_TEMPLATE_TYPE);
        }

        /**
         * @override
         */
        text(/* valueToWrite */) {
            if (!arguments.length) {
                let templateData = (getDomData(this.domElement, TEMPLATES_DOM_DATA_KEY) || {});
                if (templateData.textData === undefined && templateData.containerData) {
                    templateData.textData = templateData.containerData.innerHTML;
                }
                return templateData.textData;
            }
            setDomData(this.domElement, TEMPLATES_DOM_DATA_KEY, {textData: arguments[0]});
        }
    }

    // If you want to make a custom template engine,

    class TemplateEngine {

        constructor() {
            this.allowTemplateRewriting = true;
        }
        
        renderTemplateSource(templateSource, bindingContext, options, templateDocument) {
            throw new Error("Override renderTemplateSource");
        }
        
        createJavaScriptEvaluatorBlock(script) {
            throw new Error("Override createJavaScriptEvaluatorBlock");
        }

        makeTemplateSource(template, templateDocument) {
            if (typeof template === "string") {
                // Named template
                let elem = (templateDocument || document).getElementById(template);
                if (elem) {
                    return new DomElementTemplate(elem);
                }
                throw new Error("Cannot find template with ID " + template);
            }
            let nodeType = template.nodeType;
            if (nodeType === 1 || nodeType === 8) {
                // Anonymous template (from element or comment node)
                return new AnonymousTemplate(template);
            } 
            throw new Error("Unknown template type: " + template);
        }

        renderTemplate(template, bindingContext, options, templateDocument) {
            let templateSource = this.makeTemplateSource(template, templateDocument);
            return this.renderTemplateSource(templateSource, bindingContext, options, templateDocument);
        }

        isTemplateRewritten(template, templateDocument) {
            // Skip rewriting if requested
            if (!this.allowTemplateRewriting) {
                return true;
            }
            let templateSource = this.makeTemplateSource(template, templateDocument);
            return templateSource.data('isRewritten');
        }

        rewriteTemplate(template, rewriterCallback, templateDocument) {
            let templateSource = this.makeTemplateSource(template, templateDocument),
                rewritten = rewriterCallback(templateSource.text());
            templateSource.text(rewritten);
            templateSource.data('isRewritten', true);
        }
    }

    let _templateEngine;

    const setTemplateEngine = (templateEngine) => {
        if (templateEngine && !(templateEngine instanceof TemplateEngine)) {
            throw new Error('templateEngine must inherit from ko.templateEngine');
        }
        _templateEngine = templateEngine;
    };

    const _invokeForEachNodeInContinuousRange = (firstNode, lastNode, action) => {
        let node, 
            nextInQueue = firstNode, 
            firstOutOfRangeNode = nextSibling(lastNode);
        
        while (nextInQueue && ((node = nextInQueue) !== firstOutOfRangeNode)) {
            nextInQueue = nextSibling(node);
            action(node, nextInQueue);
        }
    };

    const _activateBindingsOnContinuousNodeArray = (continuousNodeArray, bindingContext) => {
        // To be used on any nodes that have been rendered by a template and have been inserted into some parent element
        // Walks through continuousNodeArray (which *must* be continuous, i.e., an uninterrupted sequence of sibling nodes, because
        // the algorithm for walking them relies on this), and for each top-level item in the virtual-element sense,
        // (1) Does a regular "applyBindings" to associate bindingContext with this node and to activate any non-memoized bindings
        // (2) Unmemoizes any memos in the DOM subtree (e.g., to activate bindings that had been memoized during template rewriting)

        if (!continuousNodeArray.length) {
            return;
        }
        
        let firstNode = continuousNodeArray[0],
            lastNode = continuousNodeArray[continuousNodeArray.length - 1],
            parentNode = firstNode.parentNode;

        if (bindingProviderInstance.preprocessNode) {
            _invokeForEachNodeInContinuousRange(firstNode, lastNode, (node, nextNodeInRange) => {
                let nodePreviousSibling = node.previousSibling,
                    newNodes = bindingProviderInstance.preprocessNode(node);
                if (newNodes) {
                    if (node === firstNode) {
                        firstNode = newNodes[0] || nextNodeInRange;
                    }
                    if (node === lastNode) {
                        lastNode = newNodes[newNodes.length - 1] || nodePreviousSibling;
                    }
                }
            });

            // Because preprocessNode can change the nodes, including the first and last nodes, update continuousNodeArray to match.
            // We need the full set, including inner nodes, because the unmemoize step might remove the first node (and so the real
            // first node needs to be in the array).
            continuousNodeArray.length = 0;
            if (!firstNode) { // preprocessNode might have removed all the nodes, in which case there's nothing left to do
                return;
            }
            if (firstNode === lastNode) {
                continuousNodeArray[0] = firstNode;
            } else {
                continuousNodeArray.push(firstNode, lastNode);
                fixUpContinuousNodeArray(continuousNodeArray, parentNode);
            }
        }

        // Need to applyBindings *before* unmemoziation, because unmemoization might introduce extra nodes (that we don't want to re-bind)
        // whereas a regular applyBindings won't introduce new memoized nodes
        _invokeForEachNodeInContinuousRange(firstNode, lastNode, 
            (node) => (node.nodeType === 1 || node.nodeType === 8) && applyBindings(bindingContext, node)
        );
        
        _invokeForEachNodeInContinuousRange(firstNode, lastNode, 
            (node) => (node.nodeType === 1 || node.nodeType === 8) && unmemoizeDomNodeAndDescendants(node, [bindingContext])
        );

        // Make sure any changes done by applyBindings or unmemoize are reflected in the array
        fixUpContinuousNodeArray(continuousNodeArray, parentNode);
    };

    const _getFirstNodeFromPossibleArray = (nodeOrNodeArray) => nodeOrNodeArray.nodeType ? nodeOrNodeArray :
                                                                nodeOrNodeArray.length ? nodeOrNodeArray[0] : null;

    const _executeTemplate = (targetNodeOrNodeArray, renderMode, template, bindingContext, options) => {
        options = options || {};
        let firstTargetNode = targetNodeOrNodeArray && _getFirstNodeFromPossibleArray(targetNodeOrNodeArray),
            templateDocument = (firstTargetNode || template || {}).ownerDocument,
            templateEngineToUse = (options.templateEngine || _templateEngine);
        
        ensureTemplateIsRewritten(template, templateEngineToUse, templateDocument);
        
        let renderedNodesArray = templateEngineToUse.renderTemplate(template, bindingContext, options, templateDocument);

        // Loosely check result is an array of DOM nodes
        if (typeof renderedNodesArray.length !== 'number' || (renderedNodesArray.length > 0 && typeof renderedNodesArray[0].nodeType !== 'number')) {
            throw new Error('Template engine must return an array of DOM nodes');
        }

        let haveAddedNodesToParent = false;
        if (renderMode === 'replaceChildren') {
            setDomNodeChildren$1(targetNodeOrNodeArray, renderedNodesArray);
            haveAddedNodesToParent = true;
        } else if (renderMode === 'replaceNode') {
            replaceDomNodes(targetNodeOrNodeArray, renderedNodesArray);
            haveAddedNodesToParent = true;
        } else if (renderMode !== 'ignoreTargetNode') {
            throw new Error('Unknown renderMode: ' + renderMode);
        }

        if (haveAddedNodesToParent) {
            _activateBindingsOnContinuousNodeArray(renderedNodesArray, bindingContext);
            if (options.afterRender) {
                ignoreDependencyDetection(options.afterRender, null, [renderedNodesArray, bindingContext[options['as'] || '$data']]);
            }
            if (renderMode === 'replaceChildren') {
                bindingEvent.notify(targetNodeOrNodeArray, EVENT_CHILDREN_COMPLETE);
            }
        }

        return renderedNodesArray;
    };

    const _resolveTemplateName = (template, data, context) => {
        // The template can be specified as:
        if (isObservable(template)) {
            // 1. An observable, with string value
            return template();
        } else if (typeof template === 'function') {
            // 2. A function of (data, context) returning a string
            return template(data, context);
        } 
        // 3. A string
        return template;
    };

    const renderTemplate = (template, dataOrBindingContext, options, targetNodeOrNodeArray, renderMode) => {
        options = options || {};
        if (!options.templateEngine && !_templateEngine) {
            throw new Error('Set a template engine before calling renderTemplate');
        }
        renderMode = renderMode || 'replaceChildren';

        if (targetNodeOrNodeArray) {
            let firstTargetNode = _getFirstNodeFromPossibleArray(targetNodeOrNodeArray);

            let whenToDispose = function () {
                return (!firstTargetNode) || !domNodeIsAttachedToDocument(firstTargetNode);
            }; // Passive disposal (on next evaluation)
            let activelyDisposeWhenNodeIsRemoved = (firstTargetNode && renderMode === 'replaceNode') ? firstTargetNode.parentNode : firstTargetNode;

            return dependentObservable( // So the DOM is automatically updated when any dependency changes
                function () {
                    // Ensure we've got a proper binding context to work with
                    let bindingContext = (dataOrBindingContext && (dataOrBindingContext instanceof KoBindingContext))
                        ? dataOrBindingContext
                        : new KoBindingContext(dataOrBindingContext, null, null, null, {'exportDependencies': true});

                    let templateName = _resolveTemplateName(template, bindingContext['$data'], bindingContext),
                        renderedNodesArray = _executeTemplate(targetNodeOrNodeArray, renderMode, templateName, bindingContext, options);

                    if (renderMode === 'replaceNode') {
                        targetNodeOrNodeArray = renderedNodesArray;
                        firstTargetNode = _getFirstNodeFromPossibleArray(targetNodeOrNodeArray);
                    }
                },
                null,
                {disposeWhen: whenToDispose, disposeWhenNodeIsRemoved: activelyDisposeWhenNodeIsRemoved}
            );
        } 
        // We don't yet have a DOM node to evaluate, so use a memo and render the template later when there is a DOM node
        return memoize(function (domNode) {
            renderTemplate(template, dataOrBindingContext, options, domNode, 'replaceNode');
        });
    };

    const renderTemplateForEach = (template, arrayOrObservableArray, options$1, targetNode, parentBindingContext) => {
        // Since setDomNodeChildrenFromArrayMapping always calls executeTemplateForArrayItem and then
        // activateBindingsCallback for added items, we can store the binding context in the former to use in the latter.
        let arrayItemContext, 
            asName = options$1['as'];

        // This will be called by setDomNodeChildrenFromArrayMapping to get the nodes to add to targetNode
        let executeTemplateForArrayItem = (arrayValue, index) => {
            // Support selecting template as a function of the data being rendered
            arrayItemContext = parentBindingContext.createChildContext(arrayValue, {
                'as': asName,
                'noChildContext': options$1['noChildContext'],
                'extend': (context) => {
                    context['$index'] = index;
                    if (asName) {
                        context[asName + 'Index'] = index;
                    }
                }
            });

            let templateName = _resolveTemplateName(template, arrayValue, arrayItemContext);
            return _executeTemplate(targetNode, 'ignoreTargetNode', templateName, arrayItemContext, options$1);
        };

        // This will be called whenever setDomNodeChildrenFromArrayMapping has added nodes to targetNode
        let activateBindingsCallback = (arrayValue, addedNodesArray, index) => {
                _activateBindingsOnContinuousNodeArray(addedNodesArray, arrayItemContext);
                if (options$1.afterRender) {
                    options$1.afterRender(addedNodesArray, arrayValue);
                }

                // release the "cache" variable, so that it can be collected by
                // the GC when its value isn't used from within the bindings anymore.
                arrayItemContext = null;
            };
        
        let _setDomNodeChildrenFromArrayMappingIgnoringUnwrapped = (newArray, changeList) => {
                // Call setDomNodeChildrenFromArrayMapping, ignoring any observables unwrapped within (most likely from a callback function).
                // If the array items are observables, though, they will be unwrapped in executeTemplateForArrayItem and managed within setDomNodeChildrenFromArrayMapping.
                ignoreDependencyDetection(setDomNodeChildrenFromArrayMapping, null, [targetNode, newArray, executeTemplateForArrayItem, options$1, activateBindingsCallback, changeList]);
                bindingEvent.notify(targetNode, EVENT_CHILDREN_COMPLETE);
            };

        let shouldHideDestroyed = (options$1.includeDestroyed === false) || (options.foreachHidesDestroyed && !options$1.includeDestroyed);

        if (!shouldHideDestroyed && !options$1.beforeRemove && isObservableArray(arrayOrObservableArray)) {
            _setDomNodeChildrenFromArrayMappingIgnoringUnwrapped(arrayOrObservableArray.peek());

            let subscription = arrayOrObservableArray.subscribe(changeList => _setDomNodeChildrenFromArrayMappingIgnoringUnwrapped(arrayOrObservableArray(), changeList), null, 'arrayChange');
            subscription.disposeWhenNodeIsRemoved(targetNode);

            return subscription;
        } 
        
        return dependentObservable(() => {
            let unwrappedArray = unwrapObservable(arrayOrObservableArray) || [];
            if (typeof unwrappedArray.length === 'undefined') { // Coerce single value into array
                unwrappedArray = [unwrappedArray];
            }

            if (shouldHideDestroyed && unwrappedArray.length) {
                // Filter out any entries marked as destroyed
                unwrappedArray = unwrappedArray.filter(item => item === undefined || item === null || !unwrapObservable(item['_destroy'])); 
            }
            _setDomNodeChildrenFromArrayMappingIgnoringUnwrapped(unwrappedArray);

        }, null, {disposeWhenNodeIsRemoved: targetNode});
    };

    const TEMPLATE_COMPUTED_DOM_DATA_KEY = nextDomDataKey();

    const _disposeOldComputedAndStoreNewOne = (element, newComputed) => {
        let oldComputed = getDomData(element, TEMPLATE_COMPUTED_DOM_DATA_KEY);
        if (oldComputed && (typeof oldComputed.dispose === 'function')) {
            oldComputed.dispose();
        }
        setDomData(element, TEMPLATE_COMPUTED_DOM_DATA_KEY, (newComputed && (!newComputed.isActive || newComputed.isActive())) ? newComputed : undefined);
    };

    const CLEAN_CONTAINER_DOM_DATA_KEY = nextDomDataKey();

    bindingHandlers.template = {
        init(element, valueAccessor) {
            // Support anonymous templates
            let bindingValue = unwrapObservable(valueAccessor());
            if (typeof bindingValue === 'string' || 'name' in bindingValue) {
                // It's a named template - clear the element
                emptyNode(element);
            } else if ('nodes' in bindingValue) {
                // We've been given an array of DOM nodes. Save them as the template source.
                // There is no known use case for the node array being an observable array (if the output
                // varies, put that behavior *into* your template - that's what templates are for), and
                // the implementation would be a mess, so assert that it's not observable.
                let nodes = bindingValue['nodes'] || [];
                if (isObservable(nodes)) {
                    throw new Error('The "nodes" option must be a plain, non-observable array.');
                }

                // If the nodes are already attached to a KO-generated container, we reuse that container without moving the
                // elements to a new one (we check only the first node, as the nodes are always moved together)
                let container = nodes[0] && nodes[0].parentNode;
                if (!container || !getDomData(container, CLEAN_CONTAINER_DOM_DATA_KEY)) {
                    container = moveCleanedNodesToContainerElement(nodes);
                    setDomData(container, CLEAN_CONTAINER_DOM_DATA_KEY, true);
                }

                new AnonymousTemplate(element).nodes(container);
            } else {
                // It's an anonymous template - store the element contents, then clear the element
                let templateNodes = childNodes(element);
                if (templateNodes.length) {
                    let container = moveCleanedNodesToContainerElement(templateNodes); // This also removes the nodes from their current parent
                    new AnonymousTemplate(element).nodes(container);
                } else {
                    throw new Error('Anonymous template defined, but no template content was provided');
                }
            }
            return {controlsDescendantBindings: true};
        },
        update(element, valueAccessor, allBindings, viewModel, bindingContext) {
            let value = valueAccessor(),
                options = unwrapObservable(value),
                shouldDisplay = true,
                templateComputed = null,
                template;

            if (typeof options === 'string') {
                template = value;
                options = {};
            } else {
                template = ('name' in options) ? options['name'] : element;

                // Support "if"/"ifnot" conditions
                if ('if' in options) {
                    shouldDisplay = unwrapObservable(options['if']);
                }
                if (shouldDisplay && 'ifnot' in options) {
                    shouldDisplay = !unwrapObservable(options['ifnot']);
                }
                // Don't show anything if an empty name is given (see #2446)
                if (shouldDisplay && !template) {
                    shouldDisplay = false;
                }
            }

            if ('foreach' in options) {
                // Render once for each data point (treating data set as empty if shouldDisplay==false)
                let dataArray = (shouldDisplay && options['foreach']) || [];
                templateComputed = renderTemplateForEach(template, dataArray, options, element, bindingContext);
            } else if (!shouldDisplay) {
                emptyNode(element);
            } else {
                // Render once for this single data point (or use the viewModel if no data was provided)
                let innerBindingContext = bindingContext;
                if ('data' in options) {
                    innerBindingContext = bindingContext.createChildContext(options['data'], {
                        'as': options['as'],
                        'noChildContext': options['noChildContext'],
                        'exportDependencies': true
                    });
                }
                templateComputed = renderTemplate(template, innerBindingContext, options, element);
            }

            // It only makes sense to have a single template computed per element (otherwise which one should have its output displayed?)
            _disposeOldComputedAndStoreNewOne(element, templateComputed);
        }
    };

    // Anonymous templates can't be rewritten. Give a nice error message if you try to do it.
    bindingRewriteValidators.template = (bindingValue) => {
        let parsedBindingValue = parseObjectLiteral(bindingValue);

        if ((parsedBindingValue.length === 1) && parsedBindingValue[0].unknown) {
            return null; // It looks like a string literal, not an object literal, so treat it as a named template (which is allowed for rewriting)
        }
        if (keyValueArrayContainsKey(parsedBindingValue, 'name')) {
            return null; // Named templates can be rewritten, so return "no error"
        }
        return 'This template engine does not support anonymous templates nested within its templates';
    };

    allowedBindings.template = true;

    class NativeTemplateEngine extends TemplateEngine {
        
        constructor() {
            super();
            this.allowTemplateRewriting = false;
        }

        /**
         * @override
         */
        renderTemplateSource(templateSource, bindingContext, options, templateDocument) {
            let templateNode = templateSource.nodes();

            if (templateNode) {
                // Array.from is 35% slower than spread in Chrome 79
                return [...templateNode.cloneNode(true).childNodes];
            }
            let templateText = templateSource.text();
            return parseHtmlFragment(templateText, templateDocument);
        }
    }

    setTemplateEngine(NativeTemplateEngine.instance = new NativeTemplateEngine());

    const when = (predicate, callback, context) => {

        const _kowhen = (resolve) => {
            let _observable = pureComputed(predicate, context).extend({notify:'always'});
            let subscription = _observable.subscribe(value => {
                if (value) {
                    subscription.dispose();
                    resolve(value);
                }
            });
            // In case the initial value is true, process it right away
            _observable.notifySubscribers(_observable.peek());

            return subscription;
        };

        return callback ? _kowhen(context ? callback.bind(context) : callback) : new Promise(_kowhen);
    };

    bindingHandlers.attr = {
        update(element, valueAccessor, allBindings) {
            let value = unwrapObservable(valueAccessor()) || {};
            for (let attrName of Object.keys(value)) {
                let attrValue = unwrapObservable(value[attrName]);

                // Find the namespace of this attribute, if any.
                let prefixLen = attrName.indexOf(':');
                let namespace = prefixLen > 0 && element.lookupNamespaceURI && element.lookupNamespaceURI(attrName.substr(0, prefixLen));

                // To cover cases like "attr: { checked:someProp }", we want to remove the attribute entirely
                // when someProp is a "no value"-like value (strictly null, false, or undefined)
                // (because the absence of the "checked" attr is how to mark an element as not checked, etc.)
                let toRemove = (attrValue === false) || (attrValue === null) || (attrValue === undefined);
                if (toRemove) {
                    namespace ? element.removeAttributeNS(namespace, attrName) : element.removeAttribute(attrName);
                } else {
                    attrValue = attrValue.toString();
                    namespace ? element.setAttributeNS(namespace, attrName, attrValue) : element.setAttribute(attrName, attrValue);
                }
                
                // Treat "name" specially - although you can think of it as an attribute, it also needs
                // special handling on older versions of IE (https://github.com/SteveSanderson/knockout/pull/333)
                // Deliberately being case-sensitive here because XHTML would regard "Name" as a different thing
                // entirely, and there's no strong reason to allow for such casing in HTML.
                if (attrName === 'name') {
                    element.name = toRemove ? '' : attrValue;
                }
            }
        }
    };

    bindingHandlers.checked = {
        after: ['value', 'attr'],
        init(element, valueAccessor, allBindings) {
            let checkedValue = pureComputed(() => {
                // Treat "value" like "checkedValue" when it is included with "checked" binding
                if (allBindings.has('checkedValue')) {
                    return unwrapObservable(allBindings.get('checkedValue'));
                } 
                if (useElementValue) {
                    return allBindings.has('value') ? unwrapObservable(allBindings.get('value')) : element.value;
                }
            });

            const _updateModel = () => {
                // This updates the model value from the view value.
                // It runs in response to DOM events (click) and changes in checkedValue.
                let isChecked = element.checked,
                    elemValue = checkedValue();

                // When we're first setting up this computed, don't change any model state.
                if (isInitialDependency()) {
                    return;
                }

                // We can ignore unchecked radio buttons, because some other radio
                // button will be checked, and that one can take care of updating state.
                // Also ignore value changes to an already unchecked checkbox.
                if (!isChecked && (isRadio || getDependenciesCount())) {
                    return;
                }

                let modelValue = ignoreDependencyDetection(valueAccessor);
                if (valueIsArray) {
                    let writableValue = rawValueIsNonArrayObservable ? modelValue.peek() : modelValue,
                        saveOldValue = oldElemValue;
                    
                    oldElemValue = elemValue;

                    if (saveOldValue !== elemValue) {
                        // When we're responding to the checkedValue changing, and the element is
                        // currently checked, replace the old elem value with the new elem value
                        // in the model array.
                        if (isChecked) {
                            addOrRemoveItem(writableValue, elemValue, true);
                            addOrRemoveItem(writableValue, saveOldValue, false);
                        }
                    } else {
                        // When we're responding to the user having checked/unchecked a checkbox,
                        // add/remove the element value to the model array.
                        addOrRemoveItem(writableValue, elemValue, isChecked);
                    }

                    if (rawValueIsNonArrayObservable && isWritableObservable(modelValue)) {
                        modelValue(writableValue);
                    }
                } else {
                    if (isCheckbox) {
                        if (elemValue === undefined) {
                            elemValue = isChecked;
                        } else if (!isChecked) {
                            elemValue = undefined;
                        }
                    }
                    writeValueToProperty(modelValue, allBindings, 'checked', elemValue, true);
                }
            };

            const _updateView = () => {
                // This updates the view value from the model value.
                // It runs in response to changes in the bound (checked) value.
                let modelValue = unwrapObservable(valueAccessor()),
                    elemValue = checkedValue();

                if (valueIsArray) {
                    // When a checkbox is bound to an array, being checked represents its value being present in that array
                    element.checked = modelValue.includes(elemValue);
                    oldElemValue = elemValue;
                } else if (isCheckbox && elemValue === undefined) {
                    // When a checkbox is bound to any other value (not an array) and "checkedValue" is not defined,
                    // being checked represents the value being trueish
                    element.checked = !!modelValue;
                } else {
                    // Otherwise, being checked means that the checkbox or radio button's value corresponds to the model value
                    element.checked = (checkedValue() === modelValue);
                }
            };

            let isCheckbox = element.type === 'checkbox',
                isRadio = element.type === 'radio';

            // Only bind to check boxes and radio buttons
            if (!isCheckbox && !isRadio) {
                return;
            }

            let rawValue = valueAccessor(),
                valueIsArray = isCheckbox && Array.isArray(unwrapObservable(rawValue)),
                rawValueIsNonArrayObservable = !(valueIsArray && rawValue.push && rawValue.splice),
                useElementValue = isRadio || valueIsArray,
                oldElemValue = valueIsArray ? checkedValue() : undefined;

            // IE 6 won't allow radio buttons to be selected unless they have a name
            // TODO remove this if this is really IE6-related only
            if (isRadio && !element.name) {
                bindingHandlers.uniqueName.init(element, () => true);
            }

            // Set up two computeds to update the binding:

            // The first responds to changes in the checkedValue value and to element clicks
            computed(_updateModel, null, {disposeWhenNodeIsRemoved: element});
            registerEventHandler(element, "click", _updateModel);

            // The second responds to changes in the model value (the one associated with the checked binding)
            computed(_updateView, null, {disposeWhenNodeIsRemoved: element});

            rawValue = undefined;
        }
    };

    twoWayBindings['checked'] = true;

    bindingHandlers.checkedValue = {
        update(element, valueAccessor) {
            element.value = unwrapObservable(valueAccessor());
        }
    };

    const _makeEventHandlerShortcut = (eventName) => {
        bindingHandlers[eventName] = {
            init (element, valueAccessor, allBindings, viewModel, bindingContext) {
                let newValueAccessor = () => ({[eventName]: valueAccessor()});
                return _eventBindingInitFn(element, newValueAccessor, allBindings, viewModel, bindingContext);
            }
        };
    };

    const _eventBindingInitFn = (element, valueAccessor, allBindings, viewModel, bindingContext) => {
        let eventsToHandle = valueAccessor() || {};
        if (!eventsToHandle) {
            return;
        }
        for (let eventName of Object.keys(eventsToHandle)) {
            if (typeof eventName !== 'string') {
                continue;
            }
            registerEventHandler(element, eventName, (event, ...otherArgs) => {
                let handlerReturnValue,
                    handlerFunction = valueAccessor()[eventName];
                
                if (!handlerFunction) {
                    return;
                }

                try {
                    // Take all the event args, and prefix with the viewmodel
                    let viewModel = bindingContext['$data'];
                    // call the event handler with like handler(viewModel, event, ...otherArgs);
                    handlerReturnValue = handlerFunction.call(viewModel, viewModel, event, ...otherArgs);
                } finally {
                    if (handlerReturnValue !== true) { 
                        // Normally we want to prevent default action. Developer can override this be explicitly returning true.
                        event.preventDefault();
                        // removed historic 'event.returnValue = false'
                    }
                }

                let bubble = allBindings.get(eventName + 'Bubble') !== false;
                if (!bubble) {
                    event.stopPropagation();
                    // removed historic 'event.cancelBubble = true'
                }
            });
        }
    };

    bindingHandlers.event = {
        init: _eventBindingInitFn
    };

    // 'click' is just a shorthand for the usual full-length event:{click:handler}

    _makeEventHandlerShortcut('click');

    const CLASSES_WRITTEN_BY_BINDING_KEY = Symbol('__ko__cssValue');

    const _classBindingUpdateFn = (element, valueAccessor) => {
        let value = stringTrim(unwrapObservable(valueAccessor()));
        toggleDomNodeCssClass(element, element[CLASSES_WRITTEN_BY_BINDING_KEY], false);
        element[CLASSES_WRITTEN_BY_BINDING_KEY] = value;
        toggleDomNodeCssClass(element, value, true);
    };

    bindingHandlers.class = { 
        update: _classBindingUpdateFn
    };

    bindingHandlers.css = {
        update(element, valueAccessor) {
            let value = unwrapObservable(valueAccessor());
            if (!value || typeof value !== 'object') {
                _classBindingUpdateFn(element, valueAccessor);
                return;
            }
            for (let className of Object.keys(value)) {
                let shouldHaveClass = unwrapObservable( value[className] );
                toggleDomNodeCssClass(element, className, shouldHaveClass);
            }
        }
    };

    const _enableBindingUpdateFn = (element, valueAccessor) => {
        let value = unwrapObservable(valueAccessor());
        if (value && element.disabled) {
            element.removeAttribute("disabled");
        } else if ((!value) && (!element.disabled)) {
            element.disabled = true;
        }
    };

    bindingHandlers.enable = {
        update: _enableBindingUpdateFn
    };

    bindingHandlers.disable = {
        update(element, valueAccessor) {
            _enableBindingUpdateFn(element, () => !unwrapObservable(valueAccessor()));
        }
    };

    const _foreachBindingMakeTemplateValueAccessor = (valueAccessor) => () => {
        let modelValue = valueAccessor(),
            // Unwrap without setting a dependency here
            unwrappedValue = isObservable(modelValue) ? modelValue.peek() : modelValue;
        
        // If unwrappedValue is the array, pass in the wrapped value on its own
        // The value will be unwrapped and tracked within the template binding
        // (See https://github.com/SteveSanderson/knockout/issues/523)
        if (!unwrappedValue || typeof unwrappedValue.length === 'number') {
            return {
                foreach: modelValue, 
                templateEngine: NativeTemplateEngine.instance
            };
        }

        // If unwrappedValue.data is the array, preserve all relevant options and unwrap again value so we get updates
        unwrapObservable(modelValue);
        return {
            foreach: unwrappedValue.data,
            as: unwrappedValue.as,
            noChildContext: unwrappedValue.noChildContext,
            includeDestroyed: unwrappedValue.includeDestroyed,
            afterAdd: unwrappedValue.afterAdd,
            beforeRemove: unwrappedValue.beforeRemove,
            afterRender: unwrappedValue.afterRender,
            beforeMove: unwrappedValue.beforeMove,
            afterMove: unwrappedValue.afterMove,
            templateEngine: NativeTemplateEngine.instance
        };
    };


    // "foreach: someExpression" is equivalent to "template: { foreach: someExpression }"
    // "foreach: { data: someExpression, afterAdd: myfn }" is equivalent to "template: { foreach: someExpression, afterAdd: myfn }"

    bindingHandlers.foreach = {
        makeTemplateValueAccessor: _foreachBindingMakeTemplateValueAccessor,
        init(element, valueAccessor, allBindings, viewModel, bindingContext) {
            return bindingHandlers.template.init(element, _foreachBindingMakeTemplateValueAccessor(valueAccessor));
        },
        update(element, valueAccessor, allBindings, viewModel, bindingContext) {
            return bindingHandlers.template.update(element, _foreachBindingMakeTemplateValueAccessor(valueAccessor), allBindings, viewModel, bindingContext);
        }
    };

    bindingRewriteValidators.foreach = false; // Can't rewrite control flow bindings
    allowedVirtualElementBindings.foreach = true;

    const HAS_FOCUS_UPDATING_PROPERTY = Symbol('ko_hasfocusUpdating');
    const HAS_FOCUS_LAST_VALUE = Symbol('ko_hasfocusLastValue');

    bindingHandlers.hasfocus = bindingHandlers.hasFocus = {
        init(element, valueAccessor, allBindings) {
            let _handleElementFocusChange = (isFocused) => {
                // Where possible, ignore which event was raised and determine focus state using activeElement,
                // as this avoids phantom focus/blur events raised when changing tabs in modern browsers.
                // However, not all KO-targeted browsers (Firefox 2) support activeElement. For those browsers,
                // prevent a loss of focus when changing tabs/windows by setting a flag that prevents hasfocus
                // from calling 'blur()' on the element when it loses focus.
                // Discussion at https://github.com/SteveSanderson/knockout/pull/352
                element[HAS_FOCUS_UPDATING_PROPERTY] = true;
                let ownerDoc = element.ownerDocument;
                if (ownerDoc.activeElement) {
                    isFocused = (ownerDoc.activeElement === element);
                }
                let modelValue = valueAccessor();
                writeValueToProperty(modelValue, allBindings, 'hasfocus', isFocused, true);

                //cache the latest value, so we can avoid unnecessarily calling focus/blur in the update function
                element[HAS_FOCUS_LAST_VALUE] = isFocused;
                element[HAS_FOCUS_UPDATING_PROPERTY] = false;
            };
            let handleElementFocusIn = _handleElementFocusChange.bind(null, true);
            let handleElementFocusOut = _handleElementFocusChange.bind(null, false);

            registerEventHandler(element, "focus", handleElementFocusIn);
            registerEventHandler(element, "focusin", handleElementFocusIn); // For IE
            registerEventHandler(element, "blur",  handleElementFocusOut);
            registerEventHandler(element, "focusout",  handleElementFocusOut); // For IE

            // Assume element is not focused (prevents "blur" being called initially)
            element[HAS_FOCUS_LAST_VALUE] = false;
        },
        update(element, valueAccessor) {
            let value = !!unwrapObservable(valueAccessor());

            if (!element[HAS_FOCUS_UPDATING_PROPERTY] && element[HAS_FOCUS_LAST_VALUE] !== value) {
                value ? element.focus() : element.blur();

                // In IE, the blur method doesn't always cause the element to lose focus (for example, if the window is not in focus).
                // Setting focus to the body element does seem to be reliable in IE, but should only be used if we know that the current
                // element was focused already.
                if (!value && element[HAS_FOCUS_LAST_VALUE]) {
                    element.ownerDocument.body.focus();
                }

                // For IE, which doesn't reliably fire "focus" or "blur" events synchronously
                // TODO check if this is still required for Edge+ 
                ignoreDependencyDetection(triggerEvent, null, [element, value ? "focusin" : "focusout"]);
            }
        }
    };

    twoWayBindings.hasfocus = true;
    twoWayBindings.hasFocus = 'hasfocus';

    bindingHandlers.html = {
        // Prevent binding on the dynamically-injected HTML (as developers are unlikely to expect that, and it has security implications)
        init: () => ({controlsDescendantBindings: true}),
        update(element, valueAccessor) {
            // setHtml will unwrap the value if needed
            setHtml(element, valueAccessor());
        }
    };

    const {startPossiblyAsyncContentBinding, notify} = bindingEvent;

    // Makes a binding like with or if
    const _makeWithIfBinding = (bindingKey, isWith, isNot) => {
        
        bindingHandlers[bindingKey] = {
            init(element, valueAccessor, allBindings, viewModel, bindingContext) {
                let didDisplayOnLastUpdate, 
                    savedNodes, 
                    contextOptions = {}, 
                    completeOnRender, 
                    needAsyncContext,
                    renderOnEveryChange;

                if (isWith) {
                    let as = allBindings.get('as'), 
                        noChildContext = allBindings.get('noChildContext');
                    
                    renderOnEveryChange = !(as && noChildContext);
                    contextOptions = {
                        as,
                        noChildContext,
                        exportDependencies: renderOnEveryChange
                    };
                }

                completeOnRender = allBindings.get('completeOn') === 'render';
                needAsyncContext = completeOnRender || allBindings.has(EVENT_DESCENDENTS_COMPLETE);

                computed(() => {
                    let value = unwrapObservable(valueAccessor()),
                        shouldDisplay = isNot ? !value : !!value,
                        isInitial = !savedNodes,
                        childContext;

                    if (!renderOnEveryChange && shouldDisplay === didDisplayOnLastUpdate) {
                        return;
                    }

                    if (needAsyncContext) {
                        bindingContext = startPossiblyAsyncContentBinding(element, bindingContext);
                    }

                    if (shouldDisplay) {
                        if (!isWith || renderOnEveryChange) {
                            contextOptions['dataDependency'] = getCurrentComputed();
                        }

                        if (isWith) {
                            childContext = bindingContext.createChildContext(typeof value === 'function' ? value : valueAccessor, contextOptions);
                        } else if (getDependenciesCount()) {
                            childContext = bindingContext.extend(null, contextOptions);
                        } else {
                            childContext = bindingContext;
                        }
                    }

                    // Save a copy of the inner nodes on the initial update, but only if we have dependencies.
                    if (isInitial && getDependenciesCount()) {
                        savedNodes = cloneNodes(childNodes(element), true /* shouldCleanNodes */);
                    }

                    if (shouldDisplay) {
                        if (!isInitial) {
                            setDomNodeChildren$1(element, cloneNodes(savedNodes));
                        }

                        applyBindingsToDescendants(childContext, element);
                    } else {
                        emptyNode(element);

                        if (!completeOnRender) {
                            notify(element, EVENT_CHILDREN_COMPLETE);
                        }
                    }

                    didDisplayOnLastUpdate = shouldDisplay;

                }, null, {disposeWhenNodeIsRemoved: element});

                return {controlsDescendantBindings: true};
            }
        };
        bindingRewriteValidators[bindingKey] = false; // Can't rewrite control flow bindings
        allowedVirtualElementBindings[bindingKey] = true;
    };

    // Construct the actual binding handlers
    _makeWithIfBinding('if');
    _makeWithIfBinding('ifnot', false /* isWith */, true /* isNot */);
    _makeWithIfBinding('with', true /* isWith */);

    bindingHandlers.let = {
        init(element, valueAccessor, allBindings, viewModel, bindingContext) {
            // Make a modified binding context, with extra properties, and apply it to descendant elements
            let innerContext = bindingContext.extend(valueAccessor);
            applyBindingsToDescendants(innerContext, element);

            return {controlsDescendantBindings: true};
        }
    };

    allowedVirtualElementBindings.let = true;

    const HAS_DOM_DATA_EXPANDO_PROPERTY = Symbol('ko_hasDomDataOptionValue');

    const OPTION_VALUE_DOM_DATA_KEY = nextDomDataKey();


    const readSelectOrOptionValue = (element) => {
        switch (element.tagName.toLowerCase()) {
            case 'option':
                return (element[HAS_DOM_DATA_EXPANDO_PROPERTY]) ?
                    getDomData(element, OPTION_VALUE_DOM_DATA_KEY) : element.value;
            case 'select': {
                let selectedIndex = element.selectedIndex;
                return selectedIndex >= 0 ? readSelectOrOptionValue(element.options[selectedIndex]) : undefined;
            }
        }
        return element.value;
    };

    // Normally, SELECT elements and their OPTIONs can only take value of type 'string' (because the values
    // are stored on DOM attributes). ko.selectExtensions provides a way for SELECTs/OPTIONs to have values
    // that are arbitrary objects. This is very convenient when implementing things like cascading dropdowns.
    const writeSelectOrOptionValue = (element, value, allowUnset) => {
        let tagNameLower = element.tagName.toLowerCase();
        if (tagNameLower === 'option') {
            let valueType = typeof value;
            if (valueType === 'string') {
                setDomData(element, OPTION_VALUE_DOM_DATA_KEY, undefined);
                // just set undefined instead of 'delete' since delete is 50x slower in Chrome 80
                element[HAS_DOM_DATA_EXPANDO_PROPERTY] = undefined;
                element.value = value;
            } else {
                // Store arbitrary object using DomData
                setDomData(element, OPTION_VALUE_DOM_DATA_KEY, value);
                element[HAS_DOM_DATA_EXPANDO_PROPERTY] = true;

                // Special treatment of numbers is just for backward compatibility. KO 1.2.1 wrote numerical values to element.value.
                element.value = (valueType === 'number') ? value : '';
            }
            return;
        }
        if (tagNameLower === 'select') {
            if (value === '' || value === null) {       // A blank string or null value will select the caption
                value = undefined;
            }
            let selection = -1;
            for (let i = 0, n = element.options.length, optionValue; i < n; ++i) {
                optionValue = readSelectOrOptionValue(element.options[i]);
                // Include special check to handle selecting a caption with a blank string value
                if (optionValue === value || (optionValue === '' && value === undefined)) {
                    selection = i;
                    break;
                }
            }
            if (allowUnset || selection >= 0 || (value === undefined && element.size > 1)) {
                element.selectedIndex = selection;
            }
            return;
        }
        element.value = (value === null || value === undefined) ? '' : value;
    };

    const CAPTION_PLACEHOLDER = Symbol();

    const _unwrapBindingForOption = (binding, propertyHolder, defaultValue) => {
        let bindingType = typeof binding,
            value = (bindingType === 'function') ? binding(propertyHolder) :
                (bindingType === 'string') ? propertyHolder[binding] : defaultValue,
            needsUnwrap = typeof value === 'function';

        // values are mostly NOT observable themselves, so let's save some useless unwrap calls
        return needsUnwrap ? unwrapObservable(value) : value;
    };

    bindingHandlers.options = {
        /**
         * @param {HTMLSelectElement} element
         */
        init(element) {
            if (element.tagName.toLowerCase() !== 'select') {
                throw new Error("options binding applies only to SELECT elements");
            }

            // Remove all existing <option>s.
            while (element.length > 0) {
                element.remove(0);
            }

            // Ensures that the binding processor doesn't try to bind the options
            return {controlsDescendantBindings: true};
        },
        /**
         * @param {HTMLSelectElement} element
         * @param {function} valueAccessor
         */
        update(element, valueAccessor, allBindings) {
            const _getSelectedOptions = (optionalMappingFn) => {
                let result = [],
                    nextResultIndex = 0;
                for (let option of element.options) {
                    if (option.selected) {
                        result[nextResultIndex++] = optionalMappingFn ? optionalMappingFn(option) : option;
                    }
                }
                return result;
            };
            
            let selectWasPreviouslyEmpty = element.length === 0,
                multiple = element.multiple,
                previousScrollTop = (!selectWasPreviouslyEmpty && multiple) ? element.scrollTop : null,
                unwrappedArray = unwrapObservable(valueAccessor()),
                valueAllowUnset = allBindings.get('valueAllowUnset') && allBindings.has('value'),
                includeDestroyed = allBindings.get('optionsIncludeDestroyed'),
                arrayToDomNodeChildrenOptions = {},
                captionValue,
                filteredArray,
                previousSelectedValues = [];

            if (!valueAllowUnset) {
                if (multiple) {
                    previousSelectedValues = _getSelectedOptions(readSelectOrOptionValue);
                } else if (element.selectedIndex >= 0) {
                    previousSelectedValues.push(readSelectOrOptionValue(element.options[element.selectedIndex]));
                }
            } 
            
            if (unwrappedArray) {
                if (typeof unwrappedArray.length === 'undefined') {// Coerce single value into array
                    unwrappedArray = [unwrappedArray];
                }

                // Filter out any entries marked as destroyed
                filteredArray = unwrappedArray.filter(item => includeDestroyed || item === undefined || item === null || !unwrapObservable(item['_destroy']));

                // If caption is included, add it to the array
                if (allBindings.has('optionsCaption')) {
                    captionValue = unwrapObservable(allBindings.get('optionsCaption'));
                    // If caption value is null or undefined, don't show a caption
                    if (captionValue !== null && captionValue !== undefined) {
                        filteredArray.unshift(CAPTION_PLACEHOLDER);
                    }
                }
            }

            // The following functions can run at two different times:
            // The first is when the whole array is being updated directly from this binding handler.
            // The second is when an observable value for a specific array entry is updated.
            // oldOptions will be empty in the first case, but will be filled with the previously generated option in the second.
            let itemUpdate = false;
            function optionForArrayItem(arrayEntry, index, oldOptions) {
                if (oldOptions.length) {
                    previousSelectedValues = !valueAllowUnset && oldOptions[0].selected ? [readSelectOrOptionValue(oldOptions[0])] : [];
                    itemUpdate = true;
                }
                let option = element.ownerDocument.createElement("option");
                if (arrayEntry === CAPTION_PLACEHOLDER) {
                    let captionText = unwrapObservable(allBindings.get('optionsCaption'));
                    // we have a fresh option element, so let's not use ko.utils.setTextContent
                    option.textContent = (captionText === null || captionText === undefined) ? '' : captionText;
                    writeSelectOrOptionValue(option, undefined);
                } else {
                    // Apply a value to the option element
                    let optionValue = _unwrapBindingForOption(allBindings.get('optionsValue'), arrayEntry, arrayEntry);
                    writeSelectOrOptionValue(option, optionValue);

                    // Apply some text to the option element
                    let optionText = _unwrapBindingForOption(allBindings.get('optionsText'), arrayEntry, optionValue);
                    // we have a fresh option element, so let's not use ko.utils.setTextContent
                    option.textContent = (optionText === null || optionText === undefined) ? '' : optionText;
                }
                return [option];
            }

            // By using a beforeRemove callback, we delay the removal until after new items are added. This fixes a selection
            // problem in IE<=8 and Firefox. See https://github.com/knockout/knockout/issues/1208
            arrayToDomNodeChildrenOptions.beforeRemove = option => element.removeChild(option);

            const _setSelectionCallback = (arrayEntry, newOptions) => {
                if (itemUpdate && valueAllowUnset) {
                    // The model value is authoritative, so make sure its value is the one selected
                    bindingEvent.notify(element, EVENT_CHILDREN_COMPLETE);
                } else if (previousSelectedValues.length) {
                    // IE6 doesn't like us to assign selection to OPTION nodes before they're added to the document.
                    // That's why we first added them without selection. Now it's time to set the selection.
                    let isSelected = previousSelectedValues.includes(readSelectOrOptionValue(newOptions[0]));
                    setOptionNodeSelectionState(newOptions[0], isSelected);

                    // If this option was changed from being selected during a single-item update, notify the change
                    if (itemUpdate && !isSelected) {
                        ignoreDependencyDetection(triggerEvent, null, [element, "change"]);
                    }
                }
            };

            let _optionsAfterRender = allBindings.get('optionsAfterRender'),
                callback = (typeof _optionsAfterRender !== 'function') ? _setSelectionCallback : (arrayEntry, newOptions) => {
                    _setSelectionCallback(arrayEntry, newOptions);
                    ignoreDependencyDetection(_optionsAfterRender, null, [newOptions[0], arrayEntry !== CAPTION_PLACEHOLDER ? arrayEntry : undefined]);
                };

            setDomNodeChildrenFromArrayMapping(element, filteredArray, optionForArrayItem, arrayToDomNodeChildrenOptions, callback);

            if (!valueAllowUnset) {
                // Determine if the selection has changed as a result of updating the options list
                let selectionChanged;
                if (multiple) {
                    // For a multiple-select box, compare the new selection count to the previous one
                    // But if nothing was selected before, the selection can't have changed
                    selectionChanged = previousSelectedValues.length && _getSelectedOptions().length < previousSelectedValues.length;
                } else {
                    // For a single-select box, compare the current value to the previous value
                    // But if nothing was selected before or nothing is selected now, just look for a change in selection
                    selectionChanged = (previousSelectedValues.length && element.selectedIndex >= 0)
                        ? (readSelectOrOptionValue(element.options[element.selectedIndex]) !== previousSelectedValues[0])
                        : (previousSelectedValues.length || element.selectedIndex >= 0);
                }

                // Ensure consistency between model value and selected option.
                // If the dropdown was changed so that selection is no longer the same,
                // notify the value or selectedOptions binding.
                if (selectionChanged) {
                    ignoreDependencyDetection(triggerEvent, null, [element, "change"]);
                }
            }

            if (valueAllowUnset || isInitialDependency()) {
                bindingEvent.notify(element, EVENT_CHILDREN_COMPLETE);
            }

            if (previousScrollTop && Math.abs(previousScrollTop - element.scrollTop) > 20) {
                element.scrollTop = previousScrollTop;
            }
        }
    };

    bindingHandlers.selectedOptions = {
        /**
         * @param {HTMLSelectElement} element
         */
        init(element, valueAccessor, allBindings) {
            if (element.tagName.toLowerCase() !== 'select') {
                throw new Error("selectedOptions binding applies only to SELECT elements");
            }
            
            const _updateFromView = () => {
                let value = valueAccessor(), 
                    valueToWrite = [];
                
                for (let option of element.options) {
                    option.selected && valueToWrite.push(readSelectOrOptionValue(option)); 
                }
                writeValueToProperty(value, allBindings, 'selectedOptions', valueToWrite);
            };

            function updateFromModel() {
                let newValue = unwrapObservable(valueAccessor()),
                    previousScrollTop = element.scrollTop;

                if (newValue && typeof newValue.length === 'number') {
                    for (let node of element.options) {
                        let isSelected = newValue.includes(readSelectOrOptionValue(node));
                        if (node.selected !== isSelected /* This check prevents flashing of the select element in IE */ ) {      
                            setOptionNodeSelectionState(node, isSelected);
                        }
                    }
                }

                element.scrollTop = previousScrollTop;
            }

            let isChangeHandlerBound = false;
            bindingEvent.subscribe(element, EVENT_CHILDREN_COMPLETE, () => {
                if (isChangeHandlerBound) {
                    _updateFromView();
                } else {
                    registerEventHandler(element, "change", _updateFromView);
                    computed(updateFromModel, null, {disposeWhenNodeIsRemoved: element});
                    isChangeHandlerBound = true;
                }
            }, null, {notifyImmediately: true});
        },
        update() {
            // Keep for backwards compatibility with code that may have wrapped binding
        } 
    };

    twoWayBindings.selectedOptions = true;

    const CUSTOM_CSS_PROPERTY_REGEX = /^--/;

    bindingHandlers.style = {
        update(element, valueAccessor) {
            let value = unwrapObservable(valueAccessor() || {});
            if (!value) {
                return;
            }
            
            const _elementStyle = element.style;
            
            for (let styleName of Object.keys(value)) {
                let newStyleValue = unwrapObservable(value[styleName]);

                if (newStyleValue === null || newStyleValue === undefined || newStyleValue === false) {
                    // Empty string removes the value, whereas null/undefined have no effect
                    newStyleValue = '';
                }

                if (CUSTOM_CSS_PROPERTY_REGEX.test(styleName)) {
                    // Is styleName a custom CSS property?
                    _elementStyle.setProperty(styleName, newStyleValue);
                } else {
                    styleName = styleName.replace(/-(\w)/g, (all, letter) => letter.toUpperCase());

                    let previousStyleValue = _elementStyle[styleName];
                    _elementStyle[styleName] = newStyleValue;

                    if (newStyleValue !== previousStyleValue && _elementStyle[styleName] === previousStyleValue && !isNaN(newStyleValue)) {
                        _elementStyle[styleName] = newStyleValue + 'px';
                    }
                }
            }
        }
    };

    bindingHandlers.submit = {
        init(element, valueAccessor, allBindings, viewModel, bindingContext) {
            if (typeof valueAccessor() !== 'function') {
                throw new Error('The value for a submit binding must be a function');
            }
            registerEventHandler(element, 'submit', event => {
                let handlerReturnValue,
                    value = valueAccessor();
                try {
                    handlerReturnValue = value.call(bindingContext['$data'], element);
                } finally {
                    if (handlerReturnValue !== true) { // Normally we want to prevent default action. Developer can override this be explicitly returning true.
                        event.preventDefault();
                    }
                }
            });
        }
    };

    bindingHandlers.text = {
        init() {
            // Prevent binding on the dynamically-injected text node (as developers are unlikely to expect that, and it has security implications).
            // It should also make things faster, as we no longer have to consider whether the text node might be bindable.
            return {controlsDescendantBindings: true};
        },
        update(element, valueAccessor) {
            
            if (element.nodeType === 1) {
                let text = unwrapObservable(valueAccessor());
                // We have an element node and 'controlsDescendantBindings' is true, so there is no point in 
                // wasting cycles trying to cleanup any child nodes, because whatever there is, it wasn't generated by knockout.  
                // (see thrown error "trying to control descendant bindings of the same element" in 'bindingAttributeSyntax.js')
                element.textContent = (text === undefined || text === null) ? '' : text;
                return;
            }
            
            setTextContent(element, valueAccessor());
        }
    };

    allowedVirtualElementBindings.text = true;

    bindingHandlers.textInput = {
        /** 
         * @param {HTMLInputElement|HTMLSelectElement|HTMLButtonElement} element 
         **/
        init(element, valueAccessor, allBindings) {

            let previousElementValue = element.value,
                timeoutHandle,
                elementValueBeforeEvent;

            const _updateModel = (event) => {
                timeoutHandle = timeoutHandle && void clearTimeout(timeoutHandle);
                elementValueBeforeEvent = undefined;

                let elementValue = element.value;
                if (previousElementValue !== elementValue) {
                    if (DEBUG && event) {
                        // Provide a way for tests to know exactly which event was processed
                        element['_ko_textInputProcessedEvent'] = event.type;
                    }
                    previousElementValue = elementValue;
                    writeValueToProperty(valueAccessor(), allBindings, 'textInput', elementValue);
                }
            };

            const _deferUpdateModel = (event) => {
                if (timeoutHandle) {
                    return;
                }
                // The elementValueBeforeEvent variable is set *only* during the brief gap between an
                // event firing and the updateModel function running. This allows us to ignore model
                // updates that are from the previous state of the element, usually due to techniques
                // such as rateLimit. Such updates, if not ignored, can cause keystrokes to be lost.
                elementValueBeforeEvent = element.value;
                let handler = DEBUG ? () => _updateModel({type: event.type}) : _updateModel;
                timeoutHandle = setTimeoutWithCatchError(handler, 4);
            };
            
            const _updateView = function () {
                let modelValue = unwrapObservable(valueAccessor());

                if (modelValue === null || modelValue === undefined) {
                    modelValue = '';
                }

                if (elementValueBeforeEvent !== undefined && modelValue === elementValueBeforeEvent) {
                    setTimeoutWithCatchError(_updateView, 4);
                    return;
                }
                
                // Update the element only if the element and model are different. On some browsers, updating the value
                // will move the cursor to the end of the input, which would be bad while the user is typing.
                if (element.value !== modelValue) {
                    element.value = modelValue;
                    previousElementValue = element.value; // In case the browser changes the value (see #2281)
                }
            };

            /** @type {string[]} */
            const _forceUpdateOn = DEBUG && bindingHandlers.textInput._forceUpdateOn; 
            if (_forceUpdateOn) {
                // Provide a way for tests to specify exactly which events are bound
                for (let eventName of _forceUpdateOn) {
                    if (eventName.startsWith('after')) {
                        registerEventHandler(element, eventName.slice(5), _deferUpdateModel);
                    } else {
                        registerEventHandler(element, eventName, _updateModel);
                    }
                }
            } else {
                registerEventHandler(element, 'input', _updateModel);
            }

            // Bind to the change event so that we can catch programmatic updates of the value that fire this event.
            registerEventHandler(element, 'change', _updateModel);

            // To deal with browsers that don't notify any kind of event for some changes (IE, Safari, etc.)
            registerEventHandler(element, 'blur', _updateModel);

            computed(_updateView, null, {disposeWhenNodeIsRemoved: element});
        }
    };

    twoWayBindings['textInput'] = true;

    // TODO this textinput alias should rather throw an error than foster sloppy programming
    // textinput is an alias for textInput
    bindingHandlers.textinput = {
        // preprocess is the only way to set up a full alias
        preprocess(value, name, addBinding) {
            addBinding('textInput', value);
        }
    };

    let __uniqueNameCurrentIndex = 0;

    bindingHandlers.uniqueName = {
        init: (element, valueAccessor) => valueAccessor() && (element.name = 'ko_unique_' + (++__uniqueNameCurrentIndex))
    };

    bindingHandlers.using = {
        init(element, valueAccessor, allBindings, viewModel, bindingContext) {
            let options;

            if (allBindings.has('as')) {
                options = {as: allBindings.get('as'), noChildContext: allBindings.get('noChildContext')};
            }

            let innerContext = bindingContext.createChildContext(valueAccessor, options);
            applyBindingsToDescendants(innerContext, element);

            return {controlsDescendantBindings: true};
        }
    };

    allowedBindings.using = true;

    bindingHandlers.value = {
        /** 
         * @param {HTMLInputElement|HTMLButtonElement|HTMLSelectElement} element 
         **/
        init(element, valueAccessor, allBindings) {
            let tagName = element.nodeName.toLowerCase(),
                isInputElement = tagName === 'input',
                inputType = isInputElement && element.type;

            // If the value binding is placed on a radio/checkbox, then just pass through to checkedValue and quit
            if (inputType === 'checkbox' || inputType === 'radio') {
                applyBindingAccessorsToNode(element, {checkedValue: valueAccessor});
                return;
            }
            
            let requestedEventsToCatch = allBindings.get('valueUpdate'),
                elementValueBeforeEvent = null,
                eventsToCatch = [];
            
            if (requestedEventsToCatch) {
                // Allow both individual event names, and arrays of event names
                if (typeof requestedEventsToCatch === 'string') {
                    eventsToCatch.push(requestedEventsToCatch);
                } else {
                    eventsToCatch = arrayGetDistinctValues(requestedEventsToCatch);
                }
                arrayRemoveItem(eventsToCatch, 'change');  // We'll subscribe to 'change' events later
            }

            const _valueUpdateHandler = () => {
                elementValueBeforeEvent = null;
                let modelValue = valueAccessor(),
                    elementValue = readSelectOrOptionValue(element);
                writeValueToProperty(modelValue, allBindings, 'value', elementValue);
            };

            for (let eventName of eventsToCatch) {
                // The syntax 'after<eventname>' means 'run the handler asynchronously after the event'
                // This is useful, for example, to catch 'keydown' events after the browser has updated the control
                // (otherwise, readSelectOrOptionValue(this) will receive the control's value *before* the key event)
                if (eventName.startsWith('after')) {
                    registerEventHandler(element, eventName.substring(5), () => {
                        // The elementValueBeforeEvent variable is non-null *only* during the brief gap between
                        // a keyX event firing and the valueUpdateHandler running, which is scheduled to happen
                        // at the earliest asynchronous opportunity. We store this temporary information so that
                        // if, between keyX and valueUpdateHandler, the underlying model value changes separately,
                        // we can overwrite that model value change with the value the user just typed. Otherwise,
                        // techniques like rateLimit can trigger model changes at critical moments that will
                        // override the user's inputs, causing keystrokes to be lost.
                        elementValueBeforeEvent = readSelectOrOptionValue(element);
                        setTimeoutWithCatchError(_valueUpdateHandler, 0);
                    });
                } else {
                    registerEventHandler(element, eventName, _valueUpdateHandler);
                }
            }

            let _updateFromModel;

            if (inputType === 'file') {
                // For file input elements, can only write the empty string
                _updateFromModel = () => {
                    let newValue = unwrapObservable(valueAccessor());
                    if (newValue === null || newValue === undefined || newValue === '') {
                        element.value = '';
                    } else {
                        ignoreDependencyDetection(_valueUpdateHandler);  // reset the model to match the element
                    }
                };
            } else {
                _updateFromModel = () => {
                    let newValue = unwrapObservable(valueAccessor()),
                        elementValue = readSelectOrOptionValue(element);

                    if (elementValueBeforeEvent !== null && newValue === elementValueBeforeEvent) {
                        setTimeoutWithCatchError(_updateFromModel, 0);
                        return;
                    }
                    if (newValue === elementValue && elementValue !== undefined) {
                        return; // no changes
                    }
                    if (tagName === 'select') {
                        let allowUnset = allBindings.get('valueAllowUnset');
                        writeSelectOrOptionValue(element, newValue, allowUnset);
                        if (!allowUnset && newValue !== readSelectOrOptionValue(element)) {
                            // If you try to set a model value that can't be represented in an already-populated dropdown, reject that change,
                            // because you're not allowed to have a model value that disagrees with a visible UI selection.
                            ignoreDependencyDetection(_valueUpdateHandler);
                        }
                        return;
                    }
                    writeSelectOrOptionValue(element, newValue);
                };
            }

            if (tagName === 'select') {
                let isChangeHandlerBound = false;
                bindingEvent.subscribe(element, EVENT_CHILDREN_COMPLETE, () => {
                    if (!isChangeHandlerBound) {
                        registerEventHandler(element, 'change', _valueUpdateHandler);
                        isChangeHandlerBound = !!computed(_updateFromModel, null, {disposeWhenNodeIsRemoved: element});
                    } else if (allBindings.get('valueAllowUnset')) {
                        _updateFromModel();
                    } else {
                        _valueUpdateHandler();
                    }
                }, null, {notifyImmediately: true});
            } else {
                registerEventHandler(element, 'change', _valueUpdateHandler);
                computed(_updateFromModel, null, {disposeWhenNodeIsRemoved: element});
            }
        },
        update() {} // Keep for backwards compatibility with code that may have wrapped value binding
    };

    twoWayBindings.value = true;

    const __visibleBindingUpdateFn = (element, valueAccessor) => {
        let value = unwrapObservable(valueAccessor()),
            isCurrentlyVisible = element.style.display !== 'none';
        
        if (value && !isCurrentlyVisible) {
            element.style.display = '';
        } else if ((!value) && isCurrentlyVisible) {
            element.style.display = 'none';
        }
    }; 

    bindingHandlers.visible = {
        update: __visibleBindingUpdateFn 
    };

    bindingHandlers.hidden = {
        update: (element, valueAccessor) => __visibleBindingUpdateFn(element, () => !unwrapObservable(valueAccessor()))
    };

    let componentLoadingOperationUniqueId = 0;

    allowedBindings.component = true;

    bindingHandlers.component = {
        init: (element, valueAccessor, ignored1, ignored2, bindingContext) => {
            let currentViewModel,
                currentLoadingOperationId,
                afterRenderSub,
                disposeAssociatedComponentViewModel = () => {
                    let currentViewModelDispose = currentViewModel && currentViewModel['dispose'];
                    if (typeof currentViewModelDispose === 'function') {
                        currentViewModelDispose.call(currentViewModel);
                    }
                    if (afterRenderSub) {
                        afterRenderSub.dispose();
                    }
                    afterRenderSub = null;
                    currentViewModel = null;
                    // Any in-flight loading operation is no longer relevant, so make sure we ignore its completion
                    currentLoadingOperationId = null;
                },
                originalChildNodes = Array.from(childNodes(element));

            emptyNode(element);
            addDisposeCallback(element, disposeAssociatedComponentViewModel);

            computed(function () {
                let value = unwrapObservable(valueAccessor()),
                    componentName, componentParams;

                if (typeof value === 'string') {
                    componentName = value;
                } else {
                    componentName = unwrapObservable(value['name']);
                    componentParams = unwrapObservable(value['params']);
                }

                if (!componentName) {
                    throw new Error('No component name specified');
                }

                let asyncContext = bindingEvent.startPossiblyAsyncContentBinding(element, bindingContext);

                let loadingOperationId = currentLoadingOperationId = ++componentLoadingOperationUniqueId;
                getComponent(componentName, componentDefinition => {
                    if (currentLoadingOperationId !== loadingOperationId) {
                        // If this is not the current load operation for this element, ignore it.
                        return;
                    }

                    // Clean up previous state
                    disposeAssociatedComponentViewModel();

                    // Instantiate and bind new component. Implicitly this cleans any old DOM nodes.
                    if (!componentDefinition) {
                        throw new Error('Unknown component \'' + componentName + '\'');
                    }
                    _cloneTemplateIntoElement(componentName, componentDefinition, element);

                    let componentInfo = {
                        element,
                        templateNodes: originalChildNodes
                    };

                    let componentViewModel = _createViewModel(componentDefinition, componentParams, componentInfo),
                        childBindingContext = asyncContext['createChildContext'](componentViewModel, {
                            extend(ctx) {
                                ctx['$component'] = componentViewModel;
                                ctx['$componentTemplateNodes'] = originalChildNodes;
                            }
                        });

                    let _viewModelDescendantsComplete = componentViewModel && componentViewModel.koDescendantsComplete;
                    if (_viewModelDescendantsComplete) {
                        afterRenderSub = bindingEvent.subscribe(element, EVENT_DESCENDENTS_COMPLETE, _viewModelDescendantsComplete, componentViewModel);
                    }

                    currentViewModel = componentViewModel;
                    applyBindingsToDescendants(childBindingContext, element);
                });
            }, null, {disposeWhenNodeIsRemoved: element});

            return {controlsDescendantBindings: true};
        }
    };

    const _cloneTemplateIntoElement = (componentName, componentDefinition, element) => {
        let template = componentDefinition['template'];
        if (!template) {
            throw new Error('Component \'' + componentName + '\' has no template');
        }
        let clonedNodesArray = cloneNodes(template);
        setDomNodeChildren$1(element, clonedNodesArray);
    };

    const _createViewModel = (componentDefinition, componentParams, componentInfo) => {
        let componentViewModelFactory = componentDefinition['createViewModel'];
        return componentViewModelFactory
            ? componentViewModelFactory.call(componentDefinition, componentParams, componentInfo)
            : componentParams; // Template-only component
    };

    // This is the final knockout library to be built. 

    const expressionRewriting = {
        bindingRewriteValidators,
        parseObjectLiteral,
        preProcessBindings,
        _twoWayBindings,
        insertPropertyAccessorsIntoJson: preProcessBindings // alias for backwards compat
    };


    // ********************** export all props/methods/namespaces to be exposed publicly *********************************

    const ko$1 = {
        version, // eslint-disable-line no-undef
        options,
        utils: Object.assign({
            setTimeout: setTimeoutWithCatchError,  // alias for backwards compat.

            parseHtmlFragment,
            parseHtmlForTemplateNodes,
            setHtml,
            parseJson: JSON.parse,
            setDomNodeChildrenFromArrayMapping,
            get compareArrays() { return compareArrays; },
            set compareArrays(fn) { _overrideCompareArrays(fn); },
            findMovesInArrayComparison,

            domData: {
                get: getDomData,
                set: setDomData,
                clear: clearDomData
            },
            domNodeDisposal: {
                removeNode,
                get cleanExternalData() { return _cleanExternalData; },
                set cleanExternalData(fn) { _overrideCleanExternalData(fn); },
                addDisposeCallback,
                removeDisposeCallback
            }
        }, utils),
        unwrap: unwrapObservable,
        removeNode,
        cleanNode,
        memoization: {
            memoize,
            unmemoize,
            parseMemoText,
            unmemoizeDomNodeAndDescendants
        },
        tasks: {
            cancel: cancelTask,
            runEarly,
            resetForTesting,
            schedule: scheduleTask,
            get scheduler() { return _scheduler; },
            set scheduler(s) { _overrideScheduler(s); }
        },
        extenders,
        subscribable: Subscribable,
        isSubscribable,
        computedContext: {
            getDependenciesCount,
            getDependencies,
            isInitial: isInitialDependency,
            registerDependency
        },
        ignoreDependencies: ignoreDependencyDetection,
        observable,
        isObservable,
        isWritableObservable,
        isWriteableObservable: isWritableObservable,
        observableArray,
        isObservableArray,
        computed,
        dependentObservable,
        isComputed,
        isPureComputed,
        pureComputed,
        toJSON,
        toJS,
        when,
        selectExtensions: {
            readValue: readSelectOrOptionValue,
            writeValue: writeSelectOrOptionValue
        },
        expressionRewriting,
        jsonExpressionRewriting: expressionRewriting,
        virtualElements: {
            childNodes,
            firstChild,
            nextSibling,
            allowedBindings,
            emptyNode,
            insertAfter,
            prepend,
            setDomNodeChildren: setDomNodeChildren$1
        },
        bindingProvider: KoBindingProvider,
        get getBindingHandler() { return getBindingHandler; },
        set getBindingHandler(fn) { _overrideGetBindingHandler(fn); },
        bindingHandlers,
        bindingEvent,
        applyBindings,
        applyBindingsToDescendants,
        applyBindingAccessorsToNode,
        applyBindingsToNode,
        contextFor,
        dataFor,
        components: {
            get loaders() { return loaders; },
            set loaders(newLoaders) { _setComponentLoaders(newLoaders); },
            // Expose the default loader so that developers can directly ask it for configuration or to resolve configuration
            defaultLoader,
            get: getComponent,
            clearCachedDefinition,
            isRegistered: isComponentRegistered,
            register: registerComponent,
            unregister: unregisterComponent,
            addBindingsForCustomElement,
            get getComponentNameForNode() { return getComponentNameForNode; },
            set getComponentNameForNode(fn) { _overrideGetComponentNameForNode(fn); }
        },
        templateEngine: TemplateEngine,
        __tr_ambtns: applyMemoizedBindingsToNextSibling, // eslint-disable-line camelcase
        templateSources: {
            domElement: DomElementTemplate,
            anonymousTemplate: AnonymousTemplate
        },
        setTemplateEngine,
        renderTemplate,
        nativeTemplateEngine: NativeTemplateEngine,
        get onError() { return onError; },
        set onError(fnOrNull) { _overrideOnError(fnOrNull); }
    };

    _setKoReferenceForBindingContexts(ko$1);

    return ko$1;

})));
//# sourceMappingURL=knockout-latest.debug.js.map
