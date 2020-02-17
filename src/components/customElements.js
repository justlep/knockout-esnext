import {isComponentRegistered} from './defaultLoader';
import {unwrapObservable} from '../utils';
import {isWritableObservable} from '../subscribables/observableUtils';
import {computed} from '../subscribables/dependentObservable';


// Overridable API for determining which component name applies to a given node. By overriding this,
// you can for example map specific tagNames to components that are not preregistered.
export const _overrideGetComponentNameForNode = fn => getComponentNameForNode = fn;

export let getComponentNameForNode = (node) => {
    let tagNameLower = (node && node.tagName || '').toLowerCase();
    if (tagNameLower && isComponentRegistered(tagNameLower)) {
        // Try to determine that this node can be considered a *custom* element; see https://github.com/knockout/knockout/issues/1603
        if (tagNameLower.includes('-') || ('' + node) === "[object HTMLUnknownElement]") {
            return tagNameLower;
        }
    }
};

export const addBindingsForCustomElement = (allBindings, node, bindingContext, valueAccessors) => {
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

export const _setNativeBindingProviderInstance = bindingProvider => _nativeBindingProviderInstance = bindingProvider;

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
