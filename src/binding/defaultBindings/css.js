import {bindingHandlers} from '../bindingHandlers';
import {stringTrim, toggleDomNodeCssClass} from '../../utils';
import {unwrapObservable} from '../../subscribables/observableUtils';

const CLASSES_WRITTEN_BY_BINDING_KEY = Symbol('__ko__cssValue');

const _classBindingUpdateFn = (element, valueAccessor) => {
    let value = stringTrim(unwrapObservable(valueAccessor()));
    toggleDomNodeCssClass(element, element[CLASSES_WRITTEN_BY_BINDING_KEY], false);
    element[CLASSES_WRITTEN_BY_BINDING_KEY] = value;
    toggleDomNodeCssClass(element, value, true);
};

bindingHandlers.class = { 
    update: _classBindingUpdateFn
};

bindingHandlers.css = {
    update(element, valueAccessor) {
        let value = unwrapObservable(valueAccessor());
        if (!value || typeof value !== 'object') {
            _classBindingUpdateFn(element, valueAccessor);
            return;
        }
        for (let className of Object.keys(value)) {
            let shouldHaveClass = unwrapObservable( value[className] );
            toggleDomNodeCssClass(element, className, shouldHaveClass);
        }
    }
};
