import {hasBindingValue, virtualNodeBindingValue} from '../virtualElements';
import {preProcessBindings} from './expressionRewriting';
import {addBindingsForCustomElement, getComponentNameForNode, _setNativeBindingProviderInstance} from '../components/customElements';

const DEFAULT_BINDING_ATTRIBUTE_NAME = "data-bind";

export class KoBindingProvider {

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
        let bindingsString = this._getBindingsString(node, bindingContext),
            parsedBindings = bindingsString ? this.parseBindingsString(bindingsString, bindingContext, node) : null;
        return addBindingsForCustomElement(parsedBindings, node, bindingContext, /* valueAccessors */ false);
    }

    getBindingAccessors(node, bindingContext) {
        let bindingsString = this._getBindingsString(node, bindingContext),
            parsedBindings = bindingsString ? this.parseBindingsString(bindingsString, bindingContext, node, {'valueAccessors': true}) : null;
        return addBindingsForCustomElement(parsedBindings, node, bindingContext, /* valueAccessors */ true);
    }

    // The following function is only used internally by this default provider.
    // It's not part of the interface definition for a general binding provider.
    _getBindingsString(node, bindingContext) {
        switch (node.nodeType) {
            case 1:
                return node.getAttribute(DEFAULT_BINDING_ATTRIBUTE_NAME); // Element
            case 8:
                return virtualNodeBindingValue(node);  // Comment
            default: 
                return null;
        }
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

export let bindingProviderInstance = new KoBindingProvider();

_setNativeBindingProviderInstance(new KoBindingProvider());
