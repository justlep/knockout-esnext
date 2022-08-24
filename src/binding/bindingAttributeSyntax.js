import {childNodes, nextSibling, firstChild, allowedVirtualElementBindings} from '../virtualElements';
import {DOM_DATASTORE_PROP, nextDomDataKey} from '../utils.domData';
import {IS_OBSERVABLE} from '../subscribables/observableUtils';
import {getCurrentComputed, ignoreDependencyDetectionNoArgs} from '../subscribables/dependencyDetection';
import {addDisposeCallback, removeDisposeCallback} from '../utils.domNodeDisposal';
import {dependentObservable, pureComputed} from '../subscribables/dependentObservable';
import {ignoreDependencyDetection} from '../subscribables/dependencyDetection';
import {getBindingHandler} from './bindingHandlers';
import {hasSubscriptionsForEvent, Subscribable} from '../subscribables/subscribable';
import {bindingProviderInstance, bindingProviderMaySupportTextNodes} from './bindingProvider';

const CONTEXT_SUBSCRIBABLE = Symbol('subscribable');
const CONTEXT_ANCESTOR_BINDING_INFO = Symbol('ancestorBindingInfo');
const CONTEXT_DATA_DEPENDENCY = Symbol('dataDependency');
const INHERIT_PARENT_VM_DATA = Symbol('inheritParentVm');
const IS_BINDING_CONTEXT_INSTANCE = Symbol('isBindingCtx');
const BINDING_INFO_DOM_DATA_KEY = nextDomDataKey();

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

let _koReferenceForBindingContexts;
export const _setKoReferenceForBindingContexts = (ko) => _koReferenceForBindingContexts = ko;

const _getBindingInfoForNode = (node) => node[DOM_DATASTORE_PROP] && node[DOM_DATASTORE_PROP][BINDING_INFO_DOM_DATA_KEY]; //@inline
const _ensureNodeHasDomData = (node) => node[DOM_DATASTORE_PROP] || (node[DOM_DATASTORE_PROP] = {}); //@inline
const _getOrAddBindingInfoInDomData = (domData) => domData[BINDING_INFO_DOM_DATA_KEY] || (domData[BINDING_INFO_DOM_DATA_KEY] = {}); //@inline

/**
 * The ko.bindingContext/KoBindingContext constructor is only called directly to create the root context. 
 * For child contexts, use bindingContextInstance.createChildContext or bindingContextInstance.extend.
 */
export class KoBindingContext {

    constructor(dataItemOrAccessor, parentContext, dataItemAlias, extendCallback, options) {
        const shouldInheritData = (dataItemOrAccessor === INHERIT_PARENT_VM_DATA);
        const realDataItemOrAccessor = shouldInheritData ? undefined : dataItemOrAccessor;
        const isFunc = (typeof realDataItemOrAccessor === 'function') && !realDataItemOrAccessor[IS_OBSERVABLE];
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
                    // unwrapObservable
                    dataItem = dataItemOrObservable && (dataItemOrObservable[IS_OBSERVABLE] ? dataItemOrObservable() : dataItemOrObservable);

                if (parentContext) {
                    // Copy $root and any custom properties from the parent context
                    Object.assign(this, parentContext);

                    // Copy Symbol properties
                    if (CONTEXT_ANCESTOR_BINDING_INFO in parentContext) {
                        this[CONTEXT_ANCESTOR_BINDING_INFO] = parentContext[CONTEXT_ANCESTOR_BINDING_INFO];
                    }
                } else {
                    this.$parents = [];
                    this.$root = dataItem;

                    // Export 'ko' in the binding context so it will be available in bindings and templates
                    // even if 'ko' isn't exported as a global, such as when using an AMD loader.
                    // See https://github.com/SteveSanderson/knockout/issues/490
                    this.ko = _koReferenceForBindingContexts;
                }

                this[CONTEXT_SUBSCRIBABLE] = _subscribable;

                if (shouldInheritData) {
                    dataItem = this.$data;
                } else {
                    this.$rawData = dataItemOrObservable;
                    this.$data = dataItem;
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

                return this.$data;
            };

        if (options && options.exportDependencies) {
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
            dataItemAlias = options.as;
            extendCallback = options.extend;
        }

        if (dataItemAlias && options && options.noChildContext) {
            let isFunc = typeof dataItemOrAccessor === 'function' && !dataItemOrAccessor[IS_OBSERVABLE];
            return new KoBindingContext(INHERIT_PARENT_VM_DATA, this, null, (newContext) => {
                    if (extendCallback) {
                        extendCallback(newContext);
                    }
                    newContext[dataItemAlias] = isFunc ? dataItemOrAccessor() : dataItemOrAccessor;
                }, options);
        }

        return new KoBindingContext(dataItemOrAccessor, this, dataItemAlias, (newContext, parentContext) => {
            // Extend the context hierarchy by setting the appropriate pointers
            newContext.$parentContext = parentContext;
            newContext.$parent = parentContext.$data;
            newContext.$parents = (parentContext.$parents || []).slice();
            newContext.$parents.unshift(newContext.$parent);
            if (extendCallback) {
                extendCallback(newContext);
            }
        }, options);
    }

    // Extend the binding context with new custom properties. This doesn't change the context hierarchy.
    // Similarly to "child" contexts, provide a function here to make sure that the correct values are set
    // when an observable view model is updated.
    extend(properties, options) {
        return new KoBindingContext(INHERIT_PARENT_VM_DATA, this, null, (newContext /*, parentContext*/) => {
            Object.assign(newContext, (typeof properties === 'function') ? properties(newContext) : properties);
        }, options);
    }
}

// allows for replacing 'obj instanceof KoBindingContext' with faster obj[IS_BINDING_CONTEXT_INSTANCE]
KoBindingContext.prototype[IS_BINDING_CONTEXT_INSTANCE] = true;

const _asyncContextDispose = (node) => {
    let bindingInfo = _getBindingInfoForNode(node),
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

export const EVENT_CHILDREN_COMPLETE = 'childrenComplete';
export const EVENT_DESCENDENTS_COMPLETE = 'descendantsComplete';

export const bindingEvent = {
    childrenComplete: EVENT_CHILDREN_COMPLETE,
    descendantsComplete: EVENT_DESCENDENTS_COMPLETE,
    subscribe(node, event, callback, context, options) {
        _ensureNodeHasDomData(node);
        let nodeDomData = _ensureNodeHasDomData(node),
            bindingInfo = _getOrAddBindingInfoInDomData(nodeDomData),
            eventSubscribable = bindingInfo.eventSubscribable || (bindingInfo.eventSubscribable = new Subscribable());
        
        if (options && options.notifyImmediately && bindingInfo.notifiedEvents[event]) {
            ignoreDependencyDetection(callback, context, [node]);
        }
        return eventSubscribable.subscribe(callback, context, event);
    },

    notify(node, event) {
        let bindingInfo = _getBindingInfoForNode(node);
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
            } else if (_asyncContext === undefined && _eventSubscribable && hasSubscriptionsForEvent(_eventSubscribable, EVENT_DESCENDENTS_COMPLETE)) {
                // It's currently an error to register a descendantsComplete handler for a node that was never registered as completing asynchronously.
                // That's because without the asyncContext, we don't have a way to know that all descendants have completed.
                throw new Error("descendantsComplete event not supported for bindings on this node");
            }
        }
    },

    startPossiblyAsyncContentBinding: function (node, bindingContext) {
        let nodeDomData = _ensureNodeHasDomData(node),
            bindingInfo = _getOrAddBindingInfoInDomData(nodeDomData);

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
    let source = ignoreDependencyDetectionNoArgs(callback);
    if (!source) {
        return null;
    }
    let target = {};
    for (let key of Object.keys(source)) {
        target[key] = () => callback()[key];
    }
    return target;
};

const _applyBindingsToDescendantsInternal = (bindingContext, elementOrVirtualElement) => {
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
};

const _applyBindingsToNodeAndDescendantsInternal = (bindingContext, nodeVerified) => {
    let nodeType = nodeVerified.nodeType;

    // Perf optimisation: Apply bindings only if...
    // (1) we need to store the binding info for the node (all element nodes)
    // (2) it might have bindings (e.g., it has a data-bind attribute, or it's a start-comment for a containerless template)
    // (3) it's a text node and a custom binding provider was registered which may support text nodes (unlike the default BP) 
    if (nodeType === 1 || ((nodeType === 8 || bindingProviderMaySupportTextNodes) && bindingProviderInstance.nodeHasBindings(nodeVerified))) {
        bindingContext = _applyBindingsToNodeInternal(nodeVerified, null, bindingContext).bindingContextForDescendants;
    }
    if (bindingContext && !BINDING_DOES_NOT_RECURSE_INTO_ELEMENT_TYPES[nodeVerified.tagName]) {
        _applyBindingsToDescendantsInternal(bindingContext, nodeVerified);
    }
};

const _topologicalSortBindings = (bindings) => {
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
            // First add dependencies (if any) of the current binding
            if (binding.after) {
                cyclicDependencyStack.push(bindingKey);
                for (let bindingDependencyKey of binding.after) {
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
};

const _applyBindingsToNodeInternal = (node, sourceBindings, bindingContext) => {
    let nodeDomData = _ensureNodeHasDomData(node),
        bindingInfo = _getOrAddBindingInfoInDomData(nodeDomData);

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

        // let allBindings = () => {
        //     throw new Error('Use of allBindings as a function is no longer supported');
        // };
        // ^^^ using a function and add custom methods to it is 98% slower than direct object literals in Firefox 81, 
        //     plus the 'no longer supported' message has existed since 2013.. time to drop it  

        // The following is the 3.x allBindings API
        let allBindings = {
            get: (key) => bindings[key] && getValueAccessor(key)(),
            has: (key) => key in bindings
        };

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
                    ignoreDependencyDetectionNoArgs(() => {
                        let initResult = handlerInitFn(node, getValueAccessor(bindingKey), allBindings, contextToExtend.$data, contextToExtend);

                        // If this binding handler claims to control descendant bindings, make a note of this
                        if (initResult && initResult.controlsDescendantBindings) {
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
                        () => handlerUpdateFn(node, getValueAccessor(bindingKey), allBindings, contextToExtend.$data, contextToExtend),
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

const _getBindingContext = (viewModelOrBindingContext, extendContextCallback) => //@inline
            (viewModelOrBindingContext && viewModelOrBindingContext[IS_BINDING_CONTEXT_INSTANCE]) ? viewModelOrBindingContext : 
                                new KoBindingContext(viewModelOrBindingContext, undefined, undefined, extendContextCallback);

export const applyBindingAccessorsToNode = (node, bindings, viewModelOrBindingContext) => {
    return _applyBindingsToNodeInternal(node, bindings, _getBindingContext(viewModelOrBindingContext, undefined));
};

export const applyBindingsToNode = (node, bindings, viewModelOrBindingContext) => {
    let context = _getBindingContext(viewModelOrBindingContext, undefined),
        /** @type {Object} - a new bindings object that contains binding value-accessors functions */
        bindingsWithAccessors;

    if (typeof bindings === 'function') {
        bindingsWithAccessors = _makeAccessorsFromFunction(() => bindings(context, node));
    } else {
        bindingsWithAccessors = {};
        for (let key of Object.keys(bindings)) {
            let val = bindings[key];
            bindingsWithAccessors[key] = () => val;
        }
    }
    return applyBindingAccessorsToNode(node, bindingsWithAccessors, context);
};

export const applyBindingsToDescendants = (viewModelOrBindingContext, rootNode) => {
    if (rootNode.nodeType === 1 || rootNode.nodeType === 8) {
        _applyBindingsToDescendantsInternal(_getBindingContext(viewModelOrBindingContext, undefined), rootNode);
    }
};

export function applyBindings(viewModelOrBindingContext, rootNode, extendContextCallback) {
    if (arguments.length < 2) {
        rootNode = document.body;
        if (!rootNode) {
            throw Error("ko.applyBindings: could not find document.body; has the document been loaded?");
        }
    } else if (!rootNode || (rootNode.nodeType !== 1 && rootNode.nodeType !== 8)) {
        throw Error("ko.applyBindings: first parameter should be your view model; second parameter should be a DOM node");
    }
    _applyBindingsToNodeAndDescendantsInternal(_getBindingContext(viewModelOrBindingContext, extendContextCallback), rootNode);
}

// Retrieving binding context from arbitrary nodes
// We can only do something meaningful for elements and comment nodes (in particular, not text nodes, as IE can't store domdata for them)
export const contextFor = (node) => {
    let bindingInfo =  node && _getBindingInfoForNode(node);
    return bindingInfo ? bindingInfo.context : undefined;
};

export const dataFor = (node) => {
    // TODO check how often this gets called with falsy node; consider early-exit
    // TODO check how often this gets called with nodeTypes other than 1|8, remove nodeType-check if neglectable  
    let bindingInfo = node && (node.nodeType === 1 || node.nodeType === 8) && _getBindingInfoForNode(node),
        context = bindingInfo && bindingInfo.context;
    return context ? context.$data : undefined;
};
    
