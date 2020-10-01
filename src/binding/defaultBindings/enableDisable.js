import {bindingHandlers} from '../bindingHandlers';
import {unwrapObservable} from '../../subscribables/observableUtils';

const _enableBindingUpdateFn = (element, valueAccessor) => {
    let value = unwrapObservable(valueAccessor());
    if (value && element.disabled) {
        element.removeAttribute("disabled");
    } else if ((!value) && (!element.disabled)) {
        element.disabled = true;
    }
};

bindingHandlers.enable = {
    update: _enableBindingUpdateFn
};

bindingHandlers.disable = {
    update(element, valueAccessor) {
        _enableBindingUpdateFn(element, () => !unwrapObservable(valueAccessor()));
    }
};
