import {setTemplateEngine} from '../templating';
import {TemplateEngine} from '../templateEngine';
import {parseHtmlFragment} from '../../utils.domManipulation';

export class NativeTemplateEngine extends TemplateEngine {
    
    constructor() {
        super();
        this.allowTemplateRewriting = false;
    }

    /**
     * @override
     */
    renderTemplateSource(templateSource, bindingContext, options, templateDocument) {
        let templateNode = templateSource.nodes();
        
        if (templateNode) {
            // Use-case "single-child templateNode" is very frequent, so deserves a faster treatment
            // Array.from is 35% slower than spread in Chrome 79; 
            // Spread is 25% slower than copy-by-for-loop, but more readable
            return (templateNode.childNodes.length === 1) ? [templateNode.firstChild.cloneNode(true)]
                                                          : [...templateNode.cloneNode(true).childNodes];
        }
        let templateText = templateSource.text();
        return parseHtmlFragment(templateText, templateDocument);
    }
}

setTemplateEngine(NativeTemplateEngine.instance = new NativeTemplateEngine());
