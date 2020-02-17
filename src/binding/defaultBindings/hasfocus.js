import {writeValueToProperty, twoWayBindings} from '../expressionRewriting';
import {unwrapObservable, registerEventHandler, triggerEvent} from '../../utils';
import {ignoreDependencyDetection} from '../../subscribables/dependencyDetection';
import {bindingHandlers} from '../bindingHandlers';

const HAS_FOCUS_UPDATING_PROPERTY = Symbol('ko_hasfocusUpdating');
const HAS_FOCUS_LAST_VALUE = Symbol('ko_hasfocusLastValue');

bindingHandlers.hasfocus = bindingHandlers.hasFocus = {
    init(element, valueAccessor, allBindings) {
        let _handleElementFocusChange = (isFocused) => {
            // Where possible, ignore which event was raised and determine focus state using activeElement,
            // as this avoids phantom focus/blur events raised when changing tabs in modern browsers.
            // However, not all KO-targeted browsers (Firefox 2) support activeElement. For those browsers,
            // prevent a loss of focus when changing tabs/windows by setting a flag that prevents hasfocus
            // from calling 'blur()' on the element when it loses focus.
            // Discussion at https://github.com/SteveSanderson/knockout/pull/352
            element[HAS_FOCUS_UPDATING_PROPERTY] = true;
            let ownerDoc = element.ownerDocument;
            if (ownerDoc.activeElement) {
                isFocused = (ownerDoc.activeElement === element);
            }
            let modelValue = valueAccessor();
            writeValueToProperty(modelValue, allBindings, 'hasfocus', isFocused, true);

            //cache the latest value, so we can avoid unnecessarily calling focus/blur in the update function
            element[HAS_FOCUS_LAST_VALUE] = isFocused;
            element[HAS_FOCUS_UPDATING_PROPERTY] = false;
        };
        let handleElementFocusIn = _handleElementFocusChange.bind(null, true);
        let handleElementFocusOut = _handleElementFocusChange.bind(null, false);

        registerEventHandler(element, "focus", handleElementFocusIn);
        registerEventHandler(element, "focusin", handleElementFocusIn); // For IE
        registerEventHandler(element, "blur",  handleElementFocusOut);
        registerEventHandler(element, "focusout",  handleElementFocusOut); // For IE

        // Assume element is not focused (prevents "blur" being called initially)
        element[HAS_FOCUS_LAST_VALUE] = false;
    },
    update(element, valueAccessor) {
        let value = !!unwrapObservable(valueAccessor());

        if (!element[HAS_FOCUS_UPDATING_PROPERTY] && element[HAS_FOCUS_LAST_VALUE] !== value) {
            value ? element.focus() : element.blur();

            // In IE, the blur method doesn't always cause the element to lose focus (for example, if the window is not in focus).
            // Setting focus to the body element does seem to be reliable in IE, but should only be used if we know that the current
            // element was focused already.
            if (!value && element[HAS_FOCUS_LAST_VALUE]) {
                element.ownerDocument.body.focus();
            }

            // For IE, which doesn't reliably fire "focus" or "blur" events synchronously
            // TODO check if this is still required for Edge+ 
            ignoreDependencyDetection(triggerEvent, null, [element, value ? "focusin" : "focusout"]);
        }
    }
};

twoWayBindings.hasfocus = true;
twoWayBindings.hasFocus = 'hasfocus';
