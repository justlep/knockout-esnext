import {getDomData, setDomData, nextDomDataKey} from '../utils.domData';

const HAS_DOM_DATA_EXPANDO_PROPERTY = Symbol('ko_hasDomDataOptionValue');

const OPTION_VALUE_DOM_DATA_KEY = nextDomDataKey();

/**
 * @param {HTMLSelectElement|HTMLOptionElement|HTMLElement} elem
 * @return {*|undefined}
 */
export const readSelectOrOptionValue = (elem) => 
    elem.tagName === 'OPTION' ? elem[HAS_DOM_DATA_EXPANDO_PROPERTY] ? getDomData(elem, OPTION_VALUE_DOM_DATA_KEY) : elem.value : 
    elem.tagName === 'SELECT' ? elem.selectedIndex >= 0 ? readSelectOrOptionValue(elem.options[elem.selectedIndex]) : undefined : elem.value;

// Normally, SELECT elements and their OPTIONs can only take value of type 'string' (because the values
// are stored on DOM attributes). ko.selectExtensions provides a way for SELECTs/OPTIONs to have values
// that are arbitrary objects. This is very convenient when implementing things like cascading dropdowns.
export const writeSelectOrOptionValue = (element, value, allowUnset) => {
    if (element.tagName === 'OPTION') {
        let valueType = typeof value;
        if (valueType === 'string') {
            setDomData(element, OPTION_VALUE_DOM_DATA_KEY, undefined);
            // just set undefined instead of 'delete' since delete is 50x slower in Chrome 80
            element[HAS_DOM_DATA_EXPANDO_PROPERTY] = undefined;
            element.value = value;
        } else {
            // Store arbitrary object using DomData
            setDomData(element, OPTION_VALUE_DOM_DATA_KEY, value);
            element[HAS_DOM_DATA_EXPANDO_PROPERTY] = true;

            // Special treatment of numbers is just for backward compatibility. KO 1.2.1 wrote numerical values to element.value.
            element.value = (valueType === 'number') ? value : '';
        }
        return;
    }
    if (element.tagName === 'SELECT') {
        if (value === '' || value === null) {       // A blank string or null value will select the caption
            value = undefined;
        }
        let selection = -1;
        for (let i = 0, n = element.options.length, optionValue; i < n; ++i) {
            optionValue = readSelectOrOptionValue(element.options[i]);
            // Include special check to handle selecting a caption with a blank string value
            if (optionValue === value || (optionValue === '' && value === undefined)) {
                selection = i;
                break;
            }
        }
        if (allowUnset || selection >= 0 || (value === undefined && element.size > 1)) {
            element.selectedIndex = selection;
        }
        return;
    }
    element.value = (value === null || value === undefined) ? '' : value;
};
