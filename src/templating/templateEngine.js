// If you want to make a custom template engine,
//
// [1] Inherit from this class (like ko.nativeTemplateEngine does)
// [2] Override 'renderTemplateSource', supplying a function with this signature:
//
//        function (templateSource, bindingContext, options) {
//            // - templateSource.text() is the text of the template you should render
//            // - bindingContext.$data is the data you should pass into the template
//            //   - you might also want to make bindingContext.$parent, bindingContext.$parents,
//            //     and bindingContext.$root available in the template too
//            // - options gives you access to any other properties set on "data-bind: { template: options }"
//            // - templateDocument is the document object of the template
//            //
//            // Return value: an array of DOM nodes
//        }
//
// [3] Override 'createJavaScriptEvaluatorBlock', supplying a function with this signature:
//
//        function (script) {
//            // Return value: Whatever syntax means "Evaluate the JavaScript statement 'script' and output the result"
//            //               For example, the jquery.tmpl template engine converts 'someScript' to '${ someScript }'
//        }
//
//     This is only necessary if you want to allow data-bind attributes to reference arbitrary template variables.
//     If you don't want to allow that, you can set the property 'allowTemplateRewriting' to false (like ko.nativeTemplateEngine does)
//     and then you don't need to override 'createJavaScriptEvaluatorBlock'.

import {AnonymousTemplate, DomElementTemplate} from './templateSources';

export class TemplateEngine {

    constructor() {
        this.allowTemplateRewriting = true;
    }
    
    renderTemplateSource(templateSource, bindingContext, options, templateDocument) {
        throw new Error("Override renderTemplateSource");
    }
    
    createJavaScriptEvaluatorBlock(script) {
        throw new Error("Override createJavaScriptEvaluatorBlock");
    }

    makeTemplateSource(template, templateDocument) {
        if (typeof template === "string") {
            // Named template
            let elem = (templateDocument || document).getElementById(template);
            if (elem) {
                return new DomElementTemplate(elem);
            }
            throw new Error("Cannot find template with ID " + template);
        }
        let nodeType = template.nodeType;
        if (nodeType === 1 || nodeType === 8) {
            // Anonymous template (from element or comment node)
            return new AnonymousTemplate(template);
        } 
        throw new Error("Unknown template type: " + template);
    }

    renderTemplate(template, bindingContext, options, templateDocument) {
        let templateSource = this.makeTemplateSource(template, templateDocument);
        return this.renderTemplateSource(templateSource, bindingContext, options, templateDocument);
    }

    isTemplateRewritten(template, templateDocument) {
        // Skip rewriting if requested
        if (!this.allowTemplateRewriting) {
            return true;
        }
        let templateSource = this.makeTemplateSource(template, templateDocument);
        return templateSource.data('isRewritten');
    }

    rewriteTemplate(template, rewriterCallback, templateDocument) {
        let templateSource = this.makeTemplateSource(template, templateDocument),
            rewritten = rewriterCallback(templateSource.text());
        templateSource.text(rewritten);
        templateSource.data('isRewritten', true);
    }
}
