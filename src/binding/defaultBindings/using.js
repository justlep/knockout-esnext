import {applyBindingsToDescendants} from '../bindingAttributeSyntax';
import {bindingHandlers} from '../bindingHandlers';
import {allowedBindings} from '../../virtualElements';

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
