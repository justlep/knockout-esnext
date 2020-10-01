import {applyBindingsToDescendants, bindingEvent, EVENT_DESCENDENTS_COMPLETE} from '../binding/bindingAttributeSyntax';
import {allowedBindings, childNodes, emptyNode, setDomNodeChildren} from '../virtualElements';
import {addDisposeCallback} from '../utils.domNodeDisposal';
import {cloneNodes} from '../utils';
import {getComponent} from './loaderRegistry';
import {bindingHandlers} from '../binding/bindingHandlers';
import {computed} from '../subscribables/dependentObservable';
import {unwrapObservable} from '../subscribables/observableUtils';

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
    setDomNodeChildren(element, clonedNodesArray);
};

const _createViewModel = (componentDefinition, componentParams, componentInfo) => {
    let componentViewModelFactory = componentDefinition['createViewModel'];
    return componentViewModelFactory
        ? componentViewModelFactory.call(componentDefinition, componentParams, componentInfo)
        : componentParams; // Template-only component
};
