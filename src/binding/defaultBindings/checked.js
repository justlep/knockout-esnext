import {isInitialDependency, getDependenciesCount, ignoreDependencyDetection} from '../../subscribables/dependencyDetection';
import {writeValueToProperty, twoWayBindings} from '../expressionRewriting';
import {registerEventHandler, addOrRemoveItem} from '../../utils';
import {unwrapObservable} from '../../utils';
import {bindingHandlers} from '../bindingHandlers';
import {computed, pureComputed} from '../../subscribables/dependentObservable';
import {isWritableObservable} from '../../subscribables/observableUtils';

bindingHandlers.checked = {
    after: ['value', 'attr'],
    init(element, valueAccessor, allBindings) {
        let checkedValue = pureComputed(() => {
            // Treat "value" like "checkedValue" when it is included with "checked" binding
            if (allBindings.has('checkedValue')) {
                return unwrapObservable(allBindings.get('checkedValue'));
            } 
            if (useElementValue) {
                return allBindings.has('value') ? unwrapObservable(allBindings.get('value')) : element.value;
            }
        });

        const _updateModel = () => {
            // This updates the model value from the view value.
            // It runs in response to DOM events (click) and changes in checkedValue.
            let isChecked = element.checked,
                elemValue = checkedValue();

            // When we're first setting up this computed, don't change any model state.
            if (isInitialDependency()) {
                return;
            }

            // We can ignore unchecked radio buttons, because some other radio
            // button will be checked, and that one can take care of updating state.
            // Also ignore value changes to an already unchecked checkbox.
            if (!isChecked && (isRadio || getDependenciesCount())) {
                return;
            }

            let modelValue = ignoreDependencyDetection(valueAccessor);
            if (valueIsArray) {
                let writableValue = rawValueIsNonArrayObservable ? modelValue.peek() : modelValue,
                    saveOldValue = oldElemValue;
                
                oldElemValue = elemValue;

                if (saveOldValue !== elemValue) {
                    // When we're responding to the checkedValue changing, and the element is
                    // currently checked, replace the old elem value with the new elem value
                    // in the model array.
                    if (isChecked) {
                        addOrRemoveItem(writableValue, elemValue, true);
                        addOrRemoveItem(writableValue, saveOldValue, false);
                    }
                } else {
                    // When we're responding to the user having checked/unchecked a checkbox,
                    // add/remove the element value to the model array.
                    addOrRemoveItem(writableValue, elemValue, isChecked);
                }

                if (rawValueIsNonArrayObservable && isWritableObservable(modelValue)) {
                    modelValue(writableValue);
                }
            } else {
                if (isCheckbox) {
                    if (elemValue === undefined) {
                        elemValue = isChecked;
                    } else if (!isChecked) {
                        elemValue = undefined;
                    }
                }
                writeValueToProperty(modelValue, allBindings, 'checked', elemValue, true);
            }
        };

        const _updateView = () => {
            // This updates the view value from the model value.
            // It runs in response to changes in the bound (checked) value.
            let modelValue = unwrapObservable(valueAccessor()),
                elemValue = checkedValue();

            if (valueIsArray) {
                // When a checkbox is bound to an array, being checked represents its value being present in that array
                element.checked = modelValue.includes(elemValue);
                oldElemValue = elemValue;
            } else if (isCheckbox && elemValue === undefined) {
                // When a checkbox is bound to any other value (not an array) and "checkedValue" is not defined,
                // being checked represents the value being trueish
                element.checked = !!modelValue;
            } else {
                // Otherwise, being checked means that the checkbox or radio button's value corresponds to the model value
                element.checked = (checkedValue() === modelValue);
            }
        };

        let isCheckbox = element.type === 'checkbox',
            isRadio = element.type === 'radio';

        // Only bind to check boxes and radio buttons
        if (!isCheckbox && !isRadio) {
            return;
        }

        let rawValue = valueAccessor(),
            valueIsArray = isCheckbox && Array.isArray(unwrapObservable(rawValue)),
            rawValueIsNonArrayObservable = !(valueIsArray && rawValue.push && rawValue.splice),
            useElementValue = isRadio || valueIsArray,
            oldElemValue = valueIsArray ? checkedValue() : undefined;

        // IE 6 won't allow radio buttons to be selected unless they have a name
        // TODO remove this if this is really IE6-related only
        if (isRadio && !element.name) {
            bindingHandlers.uniqueName.init(element, () => true);
        }

        // Set up two computeds to update the binding:

        // The first responds to changes in the checkedValue value and to element clicks
        computed(_updateModel, null, {disposeWhenNodeIsRemoved: element});
        registerEventHandler(element, "click", _updateModel);

        // The second responds to changes in the model value (the one associated with the checked binding)
        computed(_updateView, null, {disposeWhenNodeIsRemoved: element});

        rawValue = undefined;
    }
};

twoWayBindings['checked'] = true;

bindingHandlers.checkedValue = {
    update(element, valueAccessor) {
        element.value = unwrapObservable(valueAccessor());
    }
};
