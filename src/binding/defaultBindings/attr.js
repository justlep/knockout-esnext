import {unwrapObservable} from '../../utils';
import {bindingHandlers} from '../bindingHandlers';

bindingHandlers.attr = {
    update(element, valueAccessor, allBindings) {
        let value = unwrapObservable(valueAccessor()) || {};
        for (let attrName of Object.keys(value)) {
            let attrValue = unwrapObservable(value[attrName]);

            // Find the namespace of this attribute, if any.
            let prefixLen = attrName.indexOf(':');
            let namespace = prefixLen > 0 && element.lookupNamespaceURI && element.lookupNamespaceURI(attrName.substr(0, prefixLen));

            // To cover cases like "attr: { checked:someProp }", we want to remove the attribute entirely
            // when someProp is a "no value"-like value (strictly null, false, or undefined)
            // (because the absence of the "checked" attr is how to mark an element as not checked, etc.)
            let toRemove = (attrValue === false) || (attrValue === null) || (attrValue === undefined);
            if (toRemove) {
                namespace ? element.removeAttributeNS(namespace, attrName) : element.removeAttribute(attrName);
            } else {
                attrValue = attrValue.toString();
                namespace ? element.setAttributeNS(namespace, attrName, attrValue) : element.setAttribute(attrName, attrValue);
            }
            
            // Treat "name" specially - although you can think of it as an attribute, it also needs
            // special handling on older versions of IE (https://github.com/SteveSanderson/knockout/pull/333)
            // Deliberately being case-sensitive here because XHTML would regard "Name" as a different thing
            // entirely, and there's no strong reason to allow for such casing in HTML.
            if (attrName === 'name') {
                element.name = toRemove ? '' : attrValue;
            }
        }
    }
};
