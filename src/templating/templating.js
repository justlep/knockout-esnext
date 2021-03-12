import {nextSibling, setDomNodeChildren, emptyNode, childNodes, allowedBindings} from '../virtualElements';
import {unmemoizeDomNodeAndDescendants, _hasMemoizedCallbacks} from '../memoization';
import {fixUpContinuousNodeArray, replaceDomNodes, moveCleanedNodesToContainerElement, domNodeIsAttachedToDocument} from '../utils';
import {ensureTemplateIsRewritten} from './templateRewriting';
import {isObservableArray, isObservable, unwrapObservable} from '../subscribables/observableUtils';
import {bindingRewriteValidators, keyValueArrayContainsKey} from '../binding/expressionRewriting';
import {applyBindings, bindingEvent, EVENT_CHILDREN_COMPLETE, KoBindingContext} from '../binding/bindingAttributeSyntax';
import {ignoreDependencyDetection} from '../subscribables/dependencyDetection';
import {setDomNodeChildrenFromArrayMapping} from '../binding/editDetection/arrayToDomNodeChildren';
import {getDomData, setDomData, nextDomDataKey} from '../utils.domData';
import {AnonymousTemplate} from './templateSources';
import {parseObjectLiteral} from '../binding/expressionRewriting';
import {TemplateEngine} from './templateEngine';
import {bindingHandlers} from '../binding/bindingHandlers';
import {memoize} from '../memoization';
import {options as koOptions} from '../options';
import {dependentObservable} from '../subscribables/dependentObservable';
import {bindingProviderInstance} from '../binding/bindingProvider';


let _templateEngine;

export const setTemplateEngine = (templateEngine) => {
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
    
    if (_hasMemoizedCallbacks) {
        _invokeForEachNodeInContinuousRange(firstNode, lastNode,
            (node) => (node.nodeType === 1 || node.nodeType === 8) && unmemoizeDomNodeAndDescendants(node, [bindingContext])
        );
    }

    // Make sure any changes done by applyBindings or unmemoize are reflected in the array
    fixUpContinuousNodeArray(continuousNodeArray, parentNode);
};

/**
 * @param {Node|Node[]} nodeOrNodes
 * @return {Node|null}
 */
const _getFirstNodeFromPossibleArray = (nodeOrNodes) => nodeOrNodes.nodeType ? nodeOrNodes : nodeOrNodes.length ? nodeOrNodes[0] : null; //@inline

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
        setDomNodeChildren(targetNodeOrNodeArray, renderedNodesArray);
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

/**
 * @param {observable<string>|function|string} template
 * @param {*} data
 * @param {Object} context
 * @return {string}
 */
const _resolveTemplateName = (template, data, context) => //@inline
                                isObservable(template) ? template() : (typeof template === 'function') ? template(data, context) : template; 

export const renderTemplate = (template, dataOrBindingContext, options, targetNodeOrNodeArray, renderMode) => {
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

export const renderTemplateForEach = (template, arrayOrObservableArray, options, targetNode, parentBindingContext) => {
    // Since setDomNodeChildrenFromArrayMapping always calls executeTemplateForArrayItem and then
    // activateBindingsCallback for added items, we can store the binding context in the former to use in the latter.
    let arrayItemContext, 
        asName = options['as'];

    // This will be called by setDomNodeChildrenFromArrayMapping to get the nodes to add to targetNode
    let executeTemplateForArrayItem = (arrayValue, index) => {
        // Support selecting template as a function of the data being rendered
        arrayItemContext = parentBindingContext.createChildContext(arrayValue, {
            'as': asName,
            'noChildContext': options['noChildContext'],
            'extend': (context) => {
                context['$index'] = index;
                if (asName) {
                    context[asName + 'Index'] = index;
                }
            }
        });

        let templateName = _resolveTemplateName(template, arrayValue, arrayItemContext);
        return _executeTemplate(targetNode, 'ignoreTargetNode', templateName, arrayItemContext, options);
    };

    // This will be called whenever setDomNodeChildrenFromArrayMapping has added nodes to targetNode
    let activateBindingsCallback = (arrayValue, addedNodesArray, index) => {
            _activateBindingsOnContinuousNodeArray(addedNodesArray, arrayItemContext);
            if (options.afterRender) {
                options.afterRender(addedNodesArray, arrayValue);
            }

            // release the "cache" variable, so that it can be collected by
            // the GC when its value isn't used from within the bindings anymore.
            arrayItemContext = null;
        };
    
    let _setDomNodeChildrenFromArrayMappingIgnoringUnwrapped = (newArray, changeList) => {
            // Call setDomNodeChildrenFromArrayMapping, ignoring any observables unwrapped within (most likely from a callback function).
            // If the array items are observables, though, they will be unwrapped in executeTemplateForArrayItem and managed within setDomNodeChildrenFromArrayMapping.
            ignoreDependencyDetection(setDomNodeChildrenFromArrayMapping, null, [targetNode, newArray, executeTemplateForArrayItem, options, activateBindingsCallback, changeList]);
            bindingEvent.notify(targetNode, EVENT_CHILDREN_COMPLETE);
        };

    let shouldHideDestroyed = (options.includeDestroyed === false) || (koOptions.foreachHidesDestroyed && !options.includeDestroyed);

    if (!shouldHideDestroyed && !options.beforeRemove && isObservableArray(arrayOrObservableArray)) {
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
