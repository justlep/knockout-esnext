import {isInitialDependency, ignoreDependencyDetection} from '../../subscribables/dependencyDetection';
import {EVENT_CHILDREN_COMPLETE, bindingEvent} from '../bindingAttributeSyntax';
import {setDomNodeChildrenFromArrayMapping} from '../editDetection/arrayToDomNodeChildren';
import {readSelectOrOptionValue, writeSelectOrOptionValue} from '../selectExtensions';
import {unwrapObservable, setOptionNodeSelectionState, triggerEvent} from '../../utils';
import {bindingHandlers} from '../bindingHandlers';

const CAPTION_PLACEHOLDER = Symbol();

const _unwrapBindingForOption = (binding, propertyHolder, defaultValue) => {
    let bindingType = typeof binding,
        value = (bindingType === 'function') ? binding(propertyHolder) :
            (bindingType === 'string') ? propertyHolder[binding] : defaultValue,
        needsUnwrap = typeof value === 'function';

    // values are mostly NOT observable themselves, so let's save some useless unwrap calls
    return needsUnwrap ? unwrapObservable(value) : value;
};

bindingHandlers.options = {
    /**
     * @param {HTMLSelectElement} element
     */
    init(element) {
        if (element.tagName.toLowerCase() !== 'select') {
            throw new Error("options binding applies only to SELECT elements");
        }

        // Remove all existing <option>s.
        while (element.length > 0) {
            element.remove(0);
        }

        // Ensures that the binding processor doesn't try to bind the options
        return {controlsDescendantBindings: true};
    },
    /**
     * @param {HTMLSelectElement} element
     * @param {function} valueAccessor
     */
    update(element, valueAccessor, allBindings) {
        const _getSelectedOptions = (optionalMappingFn) => {
            let result = [],
                nextResultIndex = 0;
            for (let option of element.options) {
                if (option.selected) {
                    result[nextResultIndex++] = optionalMappingFn ? optionalMappingFn(option) : option;
                }
            }
            return result;
        };
        
        let selectWasPreviouslyEmpty = element.length === 0,
            multiple = element.multiple,
            previousScrollTop = (!selectWasPreviouslyEmpty && multiple) ? element.scrollTop : null,
            unwrappedArray = unwrapObservable(valueAccessor()),
            valueAllowUnset = allBindings.get('valueAllowUnset') && allBindings.has('value'),
            includeDestroyed = allBindings.get('optionsIncludeDestroyed'),
            arrayToDomNodeChildrenOptions = {},
            captionValue,
            filteredArray,
            previousSelectedValues = [];

        if (!valueAllowUnset) {
            if (multiple) {
                previousSelectedValues = _getSelectedOptions(readSelectOrOptionValue);
            } else if (element.selectedIndex >= 0) {
                previousSelectedValues.push(readSelectOrOptionValue(element.options[element.selectedIndex]));
            }
        } 
        
        if (unwrappedArray) {
            if (typeof unwrappedArray.length === 'undefined') {// Coerce single value into array
                unwrappedArray = [unwrappedArray];
            }

            // Filter out any entries marked as destroyed
            filteredArray = unwrappedArray.filter(item => includeDestroyed || item === undefined || item === null || !unwrapObservable(item['_destroy']));

            // If caption is included, add it to the array
            if (allBindings.has('optionsCaption')) {
                captionValue = unwrapObservable(allBindings.get('optionsCaption'));
                // If caption value is null or undefined, don't show a caption
                if (captionValue !== null && captionValue !== undefined) {
                    filteredArray.unshift(CAPTION_PLACEHOLDER);
                }
            }
        } else {
            // If a falsy value is provided (e.g. null), we'll simply empty the select element
        }

        // The following functions can run at two different times:
        // The first is when the whole array is being updated directly from this binding handler.
        // The second is when an observable value for a specific array entry is updated.
        // oldOptions will be empty in the first case, but will be filled with the previously generated option in the second.
        let itemUpdate = false;
        function optionForArrayItem(arrayEntry, index, oldOptions) {
            if (oldOptions.length) {
                previousSelectedValues = !valueAllowUnset && oldOptions[0].selected ? [readSelectOrOptionValue(oldOptions[0])] : [];
                itemUpdate = true;
            }
            let option = element.ownerDocument.createElement("option");
            if (arrayEntry === CAPTION_PLACEHOLDER) {
                let captionText = unwrapObservable(allBindings.get('optionsCaption'));
                // we have a fresh option element, so let's not use ko.utils.setTextContent
                option.textContent = (captionText === null || captionText === undefined) ? '' : captionText;
                writeSelectOrOptionValue(option, undefined);
            } else {
                // Apply a value to the option element
                let optionValue = _unwrapBindingForOption(allBindings.get('optionsValue'), arrayEntry, arrayEntry);
                writeSelectOrOptionValue(option, optionValue);

                // Apply some text to the option element
                let optionText = _unwrapBindingForOption(allBindings.get('optionsText'), arrayEntry, optionValue);
                // we have a fresh option element, so let's not use ko.utils.setTextContent
                option.textContent = (optionText === null || optionText === undefined) ? '' : optionText;
            }
            return [option];
        }

        // By using a beforeRemove callback, we delay the removal until after new items are added. This fixes a selection
        // problem in IE<=8 and Firefox. See https://github.com/knockout/knockout/issues/1208
        arrayToDomNodeChildrenOptions.beforeRemove = option => element.removeChild(option);

        const _setSelectionCallback = (arrayEntry, newOptions) => {
            if (itemUpdate && valueAllowUnset) {
                // The model value is authoritative, so make sure its value is the one selected
                bindingEvent.notify(element, EVENT_CHILDREN_COMPLETE);
            } else if (previousSelectedValues.length) {
                // IE6 doesn't like us to assign selection to OPTION nodes before they're added to the document.
                // That's why we first added them without selection. Now it's time to set the selection.
                let isSelected = previousSelectedValues.includes(readSelectOrOptionValue(newOptions[0]));
                setOptionNodeSelectionState(newOptions[0], isSelected);

                // If this option was changed from being selected during a single-item update, notify the change
                if (itemUpdate && !isSelected) {
                    ignoreDependencyDetection(triggerEvent, null, [element, "change"]);
                }
            }
        };

        let _optionsAfterRender = allBindings.has('optionsAfterRender') && allBindings.get('optionsAfterRender'),
            callback = (typeof _optionsAfterRender === 'function') ? 
                (arrayEntry, newOptions) => {
                    _setSelectionCallback(arrayEntry, newOptions);
                    ignoreDependencyDetection(allBindings.get('optionsAfterRender'), null, [newOptions[0], arrayEntry !== CAPTION_PLACEHOLDER ? arrayEntry : undefined]);
                } : 
                _setSelectionCallback;

        setDomNodeChildrenFromArrayMapping(element, filteredArray, optionForArrayItem, arrayToDomNodeChildrenOptions, callback);

        if (!valueAllowUnset) {
            // Determine if the selection has changed as a result of updating the options list
            let selectionChanged;
            if (multiple) {
                // For a multiple-select box, compare the new selection count to the previous one
                // But if nothing was selected before, the selection can't have changed
                selectionChanged = previousSelectedValues.length && _getSelectedOptions().length < previousSelectedValues.length;
            } else {
                // For a single-select box, compare the current value to the previous value
                // But if nothing was selected before or nothing is selected now, just look for a change in selection
                selectionChanged = (previousSelectedValues.length && element.selectedIndex >= 0)
                    ? (readSelectOrOptionValue(element.options[element.selectedIndex]) !== previousSelectedValues[0])
                    : (previousSelectedValues.length || element.selectedIndex >= 0);
            }

            // Ensure consistency between model value and selected option.
            // If the dropdown was changed so that selection is no longer the same,
            // notify the value or selectedOptions binding.
            if (selectionChanged) {
                ignoreDependencyDetection(triggerEvent, null, [element, "change"]);
            }
        }

        if (valueAllowUnset || isInitialDependency()) {
            bindingEvent.notify(element, EVENT_CHILDREN_COMPLETE);
        }

        if (previousScrollTop && Math.abs(previousScrollTop - element.scrollTop) > 20) {
            element.scrollTop = previousScrollTop;
        }
    }
};
