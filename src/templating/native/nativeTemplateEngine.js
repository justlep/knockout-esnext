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
            // Array.from is 35% slower than spread in Chrome 79
            return [...templateNode.cloneNode(true).childNodes];
        }
        let templateText = templateSource.text();
        return parseHtmlFragment(templateText, templateDocument);
    }
}

setTemplateEngine(NativeTemplateEngine.instance = new NativeTemplateEngine());
