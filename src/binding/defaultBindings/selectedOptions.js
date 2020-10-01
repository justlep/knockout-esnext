import {writeValueToProperty, twoWayBindings} from '../expressionRewriting';
import {bindingEvent, EVENT_CHILDREN_COMPLETE} from '../bindingAttributeSyntax';
import {registerEventHandler, setOptionNodeSelectionState} from '../../utils';
import {computed} from '../../subscribables/dependentObservable';
import {readSelectOrOptionValue} from '../selectExtensions';
import {bindingHandlers} from '../bindingHandlers';
import {unwrapObservable} from '../../subscribables/observableUtils';

bindingHandlers.selectedOptions = {
    /**
     * @param {HTMLSelectElement} element
     */
    init(element, valueAccessor, allBindings) {
        if (element.tagName.toLowerCase() !== 'select') {
            throw new Error("selectedOptions binding applies only to SELECT elements");
        }
        
        const _updateFromView = () => {
            let value = valueAccessor(), 
                valueToWrite = [];
            
            for (let option of element.options) {
                option.selected && valueToWrite.push(readSelectOrOptionValue(option)); 
            }
            writeValueToProperty(value, allBindings, 'selectedOptions', valueToWrite);
        };

        function updateFromModel() {
            let newValue = unwrapObservable(valueAccessor()),
                previousScrollTop = element.scrollTop;

            if (newValue && typeof newValue.length === 'number') {
                for (let node of element.options) {
                    let isSelected = newValue.includes(readSelectOrOptionValue(node));
                    if (node.selected !== isSelected /* This check prevents flashing of the select element in IE */ ) {      
                        setOptionNodeSelectionState(node, isSelected);
                    }
                }
            }

            element.scrollTop = previousScrollTop;
        }

        let isChangeHandlerBound = false;
        bindingEvent.subscribe(element, EVENT_CHILDREN_COMPLETE, () => {
            if (isChangeHandlerBound) {
                _updateFromView();
            } else {
                registerEventHandler(element, "change", _updateFromView);
                computed(updateFromModel, null, {disposeWhenNodeIsRemoved: element});
                isChangeHandlerBound = true;
            }
        }, null, {notifyImmediately: true});
    },
    update() {
        // Keep for backwards compatibility with code that may have wrapped binding
    } 
};

twoWayBindings.selectedOptions = true;
