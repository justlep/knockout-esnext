import {bindingRewriteValidators} from '../expressionRewriting';
import {isObservable, unwrapObservable} from '../../subscribables/observableUtils';
import {bindingHandlers} from '../bindingHandlers';
import {NativeTemplateEngine} from '../../templating/native/nativeTemplateEngine';
import {allowedVirtualElementBindings} from '../../virtualElements';

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
