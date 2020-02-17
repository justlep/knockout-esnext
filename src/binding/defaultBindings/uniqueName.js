import {bindingHandlers} from '../bindingHandlers';

let __uniqueNameCurrentIndex = 0;

bindingHandlers.uniqueName = {
    init: (element, valueAccessor) => valueAccessor() && (element.name = 'ko_unique_' + (++__uniqueNameCurrentIndex))
};
