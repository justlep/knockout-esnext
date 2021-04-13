import {readSelectOrOptionValue, writeSelectOrOptionValue} from '../selectExtensions';
import {registerEventHandler, setTimeoutWithCatchError, arrayGetDistinctValues, arrayRemoveItem} from '../../utils';
import {writeValueToProperty, twoWayBindings} from '../expressionRewriting';
import {EVENT_CHILDREN_COMPLETE, applyBindingAccessorsToNode, bindingEvent} from '../bindingAttributeSyntax';
import {ignoreDependencyDetectionNoArgs} from '../../subscribables/dependencyDetection';
import {bindingHandlers} from '../bindingHandlers';
import {computed} from '../../subscribables/dependentObservable';
import {unwrapObservable} from '../../subscribables/observableUtils';

bindingHandlers.value = {
    /** 
     * @param {HTMLInputElement|HTMLButtonElement|HTMLSelectElement} element 
     **/
    init(element, valueAccessor, allBindings) {
        let tagName = element.nodeName.toLowerCase(),
            isInputElement = tagName === 'input',
            inputType = isInputElement && element.type;

        // If the value binding is placed on a radio/checkbox, then just pass through to checkedValue and quit
        if (inputType === 'checkbox' || inputType === 'radio') {
            applyBindingAccessorsToNode(element, {checkedValue: valueAccessor});
            return;
        }
        
        let requestedEventsToCatch = allBindings.get('valueUpdate'),
            elementValueBeforeEvent = null,
            eventsToCatch = [];
        
        if (requestedEventsToCatch) {
            // Allow both individual event names, and arrays of event names
            if (typeof requestedEventsToCatch === 'string') {
                eventsToCatch.push(requestedEventsToCatch);
            } else {
                eventsToCatch = arrayGetDistinctValues(requestedEventsToCatch);
            }
            arrayRemoveItem(eventsToCatch, 'change');  // We'll subscribe to 'change' events later
        }

        const _valueUpdateHandler = () => {
            elementValueBeforeEvent = null;
            let modelValue = valueAccessor(),
                elementValue = readSelectOrOptionValue(element);
            writeValueToProperty(modelValue, allBindings, 'value', elementValue);
        };

        for (let eventName of eventsToCatch) {
            // The syntax 'after<eventname>' means 'run the handler asynchronously after the event'
            // This is useful, for example, to catch 'keydown' events after the browser has updated the control
            // (otherwise, readSelectOrOptionValue(this) will receive the control's value *before* the key event)
            if (eventName.startsWith('after')) {
                registerEventHandler(element, eventName.substring(5), () => {
                    // The elementValueBeforeEvent variable is non-null *only* during the brief gap between
                    // a keyX event firing and the valueUpdateHandler running, which is scheduled to happen
                    // at the earliest asynchronous opportunity. We store this temporary information so that
                    // if, between keyX and valueUpdateHandler, the underlying model value changes separately,
                    // we can overwrite that model value change with the value the user just typed. Otherwise,
                    // techniques like rateLimit can trigger model changes at critical moments that will
                    // override the user's inputs, causing keystrokes to be lost.
                    elementValueBeforeEvent = readSelectOrOptionValue(element);
                    setTimeoutWithCatchError(_valueUpdateHandler, 0);
                });
            } else {
                registerEventHandler(element, eventName, _valueUpdateHandler);
            }
        }

        let _updateFromModel;

        if (inputType === 'file') {
            // For file input elements, can only write the empty string
            _updateFromModel = () => {
                let newValue = unwrapObservable(valueAccessor());
                if (newValue === null || newValue === undefined || newValue === '') {
                    element.value = '';
                } else {
                    ignoreDependencyDetectionNoArgs(_valueUpdateHandler);  // reset the model to match the element
                }
            };
        } else {
            _updateFromModel = () => {
                let newValue = unwrapObservable(valueAccessor()),
                    elementValue = readSelectOrOptionValue(element);

                if (elementValueBeforeEvent !== null && newValue === elementValueBeforeEvent) {
                    setTimeoutWithCatchError(_updateFromModel, 0);
                    return;
                }
                if (newValue === elementValue && elementValue !== undefined) {
                    return; // no changes
                }
                if (tagName === 'select') {
                    let allowUnset = allBindings.get('valueAllowUnset');
                    writeSelectOrOptionValue(element, newValue, allowUnset);
                    if (!allowUnset && newValue !== readSelectOrOptionValue(element)) {
                        // If you try to set a model value that can't be represented in an already-populated dropdown, reject that change,
                        // because you're not allowed to have a model value that disagrees with a visible UI selection.
                        ignoreDependencyDetectionNoArgs(_valueUpdateHandler);
                    }
                    return;
                }
                writeSelectOrOptionValue(element, newValue);
            };
        }

        if (tagName === 'select') {
            let isChangeHandlerBound = false;
            bindingEvent.subscribe(element, EVENT_CHILDREN_COMPLETE, () => {
                if (!isChangeHandlerBound) {
                    registerEventHandler(element, 'change', _valueUpdateHandler);
                    isChangeHandlerBound = !!computed(_updateFromModel, null, {disposeWhenNodeIsRemoved: element});
                } else if (allBindings.get('valueAllowUnset')) {
                    _updateFromModel();
                } else {
                    _valueUpdateHandler();
                }
            }, null, {notifyImmediately: true});
        } else {
            registerEventHandler(element, 'change', _valueUpdateHandler);
            computed(_updateFromModel, null, {disposeWhenNodeIsRemoved: element});
        }
    },
    update() {} // Keep for backwards compatibility with code that may have wrapped value binding
};

twoWayBindings.value = true;
