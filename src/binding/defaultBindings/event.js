import {bindingHandlers} from '../bindingHandlers';

// For certain common events (currently just 'click'), allow a simplified data-binding syntax
// e.g. click:handler instead of the usual full-length event:{click:handler}
import {registerEventHandler} from '../../utils';

export const _makeEventHandlerShortcut = (eventName) => {
    bindingHandlers[eventName] = {
        init (element, valueAccessor, allBindings, viewModel, bindingContext) {
            let newValueAccessor = () => ({[eventName]: valueAccessor()});
            return _eventBindingInitFn(element, newValueAccessor, allBindings, viewModel, bindingContext);
        }
    };
};

const _eventBindingInitFn = (element, valueAccessor, allBindings, viewModel, bindingContext) => {
    let eventsToHandle = valueAccessor() || {};
    if (!eventsToHandle) {
        return;
    }
    for (let eventName of Object.keys(eventsToHandle)) {
        if (typeof eventName !== 'string') {
            continue;
        }
        registerEventHandler(element, eventName, (event, ...otherArgs) => {
            let handlerReturnValue,
                handlerFunction = valueAccessor()[eventName];
            
            if (!handlerFunction) {
                return;
            }

            try {
                // Take all the event args, and prefix with the viewmodel
                let viewModel = bindingContext['$data'];
                // call the event handler with like handler(viewModel, event, ...otherArgs);
                handlerReturnValue = handlerFunction.call(viewModel, viewModel, event, ...otherArgs);
            } finally {
                if (handlerReturnValue !== true) { 
                    // Normally we want to prevent default action. Developer can override this be explicitly returning true.
                    event.preventDefault();
                    // removed historic 'event.returnValue = false'
                }
            }

            let bubble = allBindings.get(eventName + 'Bubble') !== false;
            if (!bubble) {
                event.stopPropagation();
                // removed historic 'event.cancelBubble = true'
            }
        });
    }
};

bindingHandlers.event = {
    init: _eventBindingInitFn
};
