import {getCurrentComputed, getDependenciesCount} from '../../subscribables/dependencyDetection';
import {bindingRewriteValidators} from '../expressionRewriting';
import {cloneNodes, unwrapObservable} from '../../utils';
import {childNodes, setDomNodeChildren, allowedVirtualElementBindings, emptyNode} from '../../virtualElements';
import {bindingHandlers} from '../bindingHandlers';
import {
    EVENT_CHILDREN_COMPLETE,
    EVENT_DESCENDENTS_COMPLETE,
    bindingEvent,
    applyBindingsToDescendants
} from '../bindingAttributeSyntax';
import {computed} from '../../subscribables/dependentObservable';

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
                        setDomNodeChildren(element, cloneNodes(savedNodes));
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
