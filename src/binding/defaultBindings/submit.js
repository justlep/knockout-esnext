import {registerEventHandler} from '../../utils';
import {bindingHandlers} from '../bindingHandlers';

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
