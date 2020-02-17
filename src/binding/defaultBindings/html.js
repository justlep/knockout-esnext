import {setHtml} from '../../utils.domManipulation';
import {bindingHandlers} from '../bindingHandlers';


bindingHandlers.html = {
    // Prevent binding on the dynamically-injected HTML (as developers are unlikely to expect that, and it has security implications)
    init: () => ({controlsDescendantBindings: true}),
    update(element, valueAccessor) {
        // setHtml will unwrap the value if needed
        setHtml(element, valueAccessor());
    }
};
