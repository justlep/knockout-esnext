import {getDomData, setDomData, nextDomDataKey} from '../utils.domData';
import {setHtml} from '../utils.domManipulation';
import {parseHtmlForTemplateNodes} from '../utils.domManipulation';

// A template source represents a read/write way of accessing a template. This is to eliminate the need for template loading/saving
// logic to be duplicated in every template engine (and means they can all work with anonymous templates, etc.)
//
// Two are provided by default:
//  1. ko.templateSources.domElement       - reads/writes the text content of an arbitrary DOM element
//  2. ko.templateSources.anonymousElement - uses ko.utils.domData to read/write text *associated* with the DOM element, but
//                                           without reading/writing the actual element text content, since it will be overwritten
//                                           with the rendered template output.
// You can implement your own template source if you want to fetch/store templates somewhere other than in DOM elements.
// Template sources need to have the following functions:
//   text()            - returns the template text from your storage location
//   text(value)       - writes the supplied template text to your storage location
//   data(key)         - reads values stored using data(key, value) - see below
//   data(key, value)  - associates "value" with this template and the key "key". Is used to store information like "isRewritten".
//
// Optionally, template sources can also have the following functions:
//   nodes()            - returns a DOM element containing the nodes of this template, where available
//   nodes(value)       - writes the given DOM element to your storage location
// If a DOM element is available for a given template source, template engines are encouraged to use it in preference over text()
// for improved speed. However, all templateSources must supply text() even if they don't supply nodes().
//
// Once you've implemented a templateSource, make your template engine use it by subclassing whatever template engine you were
// using and overriding "makeTemplateSource" to return an instance of your custom template source.

// ---- ko.templateSources.domElement -----

// template types
const TPL_TYPE_SCRIPT = 1;
const TPL_TYPE_TEXTAREA = 2;
const TPL_TYPE_TEMPLATE = 3;
const TPL_TYPE_ELEMENT = 4;

const DOM_DATA_KEY_PREFIX = nextDomDataKey() + '_';
const TEMPLATES_DOM_DATA_KEY = nextDomDataKey();

const SKIP_TEMPLATE_TYPE = Symbol();

const _getTemplateDomData = (element) => getDomData(element, TEMPLATES_DOM_DATA_KEY) || {}; //@inline

export class DomElementTemplate {
    constructor(elem /*, skipTemplateType */) {
        this.domElement = elem;
        if (elem && arguments[1] !== SKIP_TEMPLATE_TYPE) {
             this.templateType = elem.tagName === 'SCRIPT' ? TPL_TYPE_SCRIPT :
                                 elem.tagName === 'TEMPLATE' ? TPL_TYPE_TEMPLATE :
                                 elem.tagName === 'TEXTAREA' ? TPL_TYPE_TEXTAREA : TPL_TYPE_ELEMENT;
        }
    }

    text(/* valueToWrite */) {
        let elemContentsProperty = this.templateType === TPL_TYPE_SCRIPT ? 'text' : 
                                   this.templateType === TPL_TYPE_TEXTAREA ? 'value' : 'innerHTML';

        if (!arguments.length) {
            return this.domElement[elemContentsProperty];
        }
        let valueToWrite = arguments[0];
        if (elemContentsProperty === 'innerHTML') {
            setHtml(this.domElement, valueToWrite);
        } else {
            this.domElement[elemContentsProperty] = valueToWrite;
        }
    }

    data(key /*, valueToWrite */) {
        if (arguments.length === 1) {
            return getDomData(this.domElement, DOM_DATA_KEY_PREFIX + key);
        } 
        setDomData(this.domElement, DOM_DATA_KEY_PREFIX + key, arguments[1]);
    }

    nodes(/* valueToWrite */) {
        let element = this.domElement;
        if (!arguments.length) {
            let templateData = _getTemplateDomData(element),
                nodes = templateData.containerData || (
                        this.templateType === TPL_TYPE_TEMPLATE ? element.content :
                        this.templateType === TPL_TYPE_ELEMENT ? element : undefined);
            
            if (!nodes || templateData.alwaysCheckText) {
                // If the template is associated with an element that stores the template as text,
                // parse and cache the nodes whenever there's new text content available. This allows
                // the user to update the template content by updating the text of template node.
                let text = this.text();
                if (text && text !== templateData.textData) {
                    nodes = parseHtmlForTemplateNodes(text, element.ownerDocument);
                    setDomData(element, TEMPLATES_DOM_DATA_KEY, {containerData: nodes, textData: text, alwaysCheckText: true});
                }
            }
            return nodes;
        } 
    
        let valueToWrite = arguments[0];
        if (this.templateType !== undefined) {
            this.text('');   // clear the text from the node
        }
        setDomData(element, TEMPLATES_DOM_DATA_KEY, {containerData: valueToWrite});
    }
}

// ---- ko.templateSources.anonymousTemplate -----
// Anonymous templates are normally saved/retrieved as DOM nodes through "nodes".
// For compatibility, you can also read "text"; it will be serialized from the nodes on demand.
// Writing to "text" is still supported, but then the template data will not be available as DOM nodes.

export class AnonymousTemplate extends DomElementTemplate {
    constructor(element) {
        super(element, SKIP_TEMPLATE_TYPE);
    }

    /**
     * @override
     */
    text(/* valueToWrite */) {
        if (!arguments.length) {
            let templateData = _getTemplateDomData(this.domElement);
            if (templateData.textData === undefined && templateData.containerData) {
                templateData.textData = templateData.containerData.innerHTML;
            }
            return templateData.textData;
        }
        setDomData(this.domElement, TEMPLATES_DOM_DATA_KEY, {textData: arguments[0]});
    }
}
