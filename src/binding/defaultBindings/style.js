import {bindingHandlers} from '../bindingHandlers';
import {unwrapObservable} from '../../subscribables/observableUtils';

const CUSTOM_CSS_PROPERTY_REGEX = /^--/;

bindingHandlers.style = {
    update(element, valueAccessor) {
        let value = unwrapObservable(valueAccessor() || {});
        if (!value) {
            return;
        }
        
        const _elementStyle = element.style;
        
        for (let styleName of Object.keys(value)) {
            let newStyleValue = unwrapObservable(value[styleName]);

            if (newStyleValue === null || newStyleValue === undefined || newStyleValue === false) {
                // Empty string removes the value, whereas null/undefined have no effect
                newStyleValue = '';
            }

            if (CUSTOM_CSS_PROPERTY_REGEX.test(styleName)) {
                // Is styleName a custom CSS property?
                _elementStyle.setProperty(styleName, newStyleValue);
            } else {
                styleName = styleName.replace(/-(\w)/g, (all, letter) => letter.toUpperCase());

                let previousStyleValue = _elementStyle[styleName];
                _elementStyle[styleName] = newStyleValue;

                if (newStyleValue !== previousStyleValue && _elementStyle[styleName] === previousStyleValue && !isNaN(newStyleValue)) {
                    _elementStyle[styleName] = newStyleValue + 'px';
                }
            }
        }
    }
};
