import {applyBindingsToDescendants} from '../bindingAttributeSyntax';
import {bindingHandlers} from '../bindingHandlers';
import {allowedVirtualElementBindings} from '../../virtualElements';

bindingHandlers.let = {
    init(element, valueAccessor, allBindings, viewModel, bindingContext) {
        // Make a modified binding context, with extra properties, and apply it to descendant elements
        let innerContext = bindingContext.extend(valueAccessor);
        applyBindingsToDescendants(innerContext, element);

        return {controlsDescendantBindings: true};
    }
};

allowedVirtualElementBindings.let = true;
