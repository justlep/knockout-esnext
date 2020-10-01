import {setTimeoutWithCatchError, registerEventHandler} from '../../utils';
import {writeValueToProperty, twoWayBindings} from '../expressionRewriting';
import {bindingHandlers} from '../bindingHandlers';
import {computed} from '../../subscribables/dependentObservable';
import {unwrapObservable} from '../../subscribables/observableUtils';

bindingHandlers.textInput = {
    /** 
     * @param {HTMLInputElement|HTMLSelectElement|HTMLButtonElement} element 
     **/
    init(element, valueAccessor, allBindings) {

        let previousElementValue = element.value,
            timeoutHandle,
            elementValueBeforeEvent;

        const _updateModel = (event) => {
            timeoutHandle = timeoutHandle && void clearTimeout(timeoutHandle);
            elementValueBeforeEvent = undefined;

            let elementValue = element.value;
            if (previousElementValue !== elementValue) {
                if (DEBUG && event) {
                    // Provide a way for tests to know exactly which event was processed
                    element['_ko_textInputProcessedEvent'] = event.type;
                }
                previousElementValue = elementValue;
                writeValueToProperty(valueAccessor(), allBindings, 'textInput', elementValue);
            }
        };

        const _deferUpdateModel = (event) => {
            if (timeoutHandle) {
                return;
            }
            // The elementValueBeforeEvent variable is set *only* during the brief gap between an
            // event firing and the updateModel function running. This allows us to ignore model
            // updates that are from the previous state of the element, usually due to techniques
            // such as rateLimit. Such updates, if not ignored, can cause keystrokes to be lost.
            elementValueBeforeEvent = element.value;
            let handler = DEBUG ? () => _updateModel({type: event.type}) : _updateModel;
            timeoutHandle = setTimeoutWithCatchError(handler, 4);
        };
        
        const _updateView = function () {
            let modelValue = unwrapObservable(valueAccessor());

            if (modelValue === null || modelValue === undefined) {
                modelValue = '';
            }

            if (elementValueBeforeEvent !== undefined && modelValue === elementValueBeforeEvent) {
                setTimeoutWithCatchError(_updateView, 4);
                return;
            }
            
            // Update the element only if the element and model are different. On some browsers, updating the value
            // will move the cursor to the end of the input, which would be bad while the user is typing.
            if (element.value !== modelValue) {
                element.value = modelValue;
                previousElementValue = element.value; // In case the browser changes the value (see #2281)
            }
        };

        /** @type {string[]} */
        const _forceUpdateOn = DEBUG && bindingHandlers.textInput._forceUpdateOn; 
        if (_forceUpdateOn) {
            // Provide a way for tests to specify exactly which events are bound
            for (let eventName of _forceUpdateOn) {
                if (eventName.startsWith('after')) {
                    registerEventHandler(element, eventName.slice(5), _deferUpdateModel);
                } else {
                    registerEventHandler(element, eventName, _updateModel);
                }
            }
        } else {
            registerEventHandler(element, 'input', _updateModel);
        }

        // Bind to the change event so that we can catch programmatic updates of the value that fire this event.
        registerEventHandler(element, 'change', _updateModel);

        // To deal with browsers that don't notify any kind of event for some changes (IE, Safari, etc.)
        registerEventHandler(element, 'blur', _updateModel);

        computed(_updateView, null, {disposeWhenNodeIsRemoved: element});
    }
};

twoWayBindings['textInput'] = true;

// TODO this textinput alias should rather throw an error than foster sloppy programming
// textinput is an alias for textInput
bindingHandlers.textinput = {
    // preprocess is the only way to set up a full alias
    preprocess(value, name, addBinding) {
        addBinding('textInput', value);
    }
};
