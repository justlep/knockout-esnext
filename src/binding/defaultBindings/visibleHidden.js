import {bindingHandlers} from '../bindingHandlers';
import {unwrapObservable} from '../../subscribables/observableUtils';

const __visibleBindingUpdateFn = (element, valueAccessor) => {
    let value = unwrapObservable(valueAccessor()),
        isCurrentlyVisible = element.style.display !== 'none';
    
    if (value && !isCurrentlyVisible) {
        element.style.display = '';
    } else if ((!value) && isCurrentlyVisible) {
        element.style.display = 'none';
    }
}; 

bindingHandlers.visible = {
    update: __visibleBindingUpdateFn 
};

bindingHandlers.hidden = {
    update: (element, valueAccessor) => __visibleBindingUpdateFn(element, () => !unwrapObservable(valueAccessor()))
};
