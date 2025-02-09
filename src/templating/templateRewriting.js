import {memoize} from '../memoization';
import {bindingRewriteValidators, preProcessBindings, parseObjectLiteral} from '../binding/expressionRewriting';
import {applyBindingAccessorsToNode} from '../binding/bindingAttributeSyntax';

const MEMOIZE_DATA_BINDING_ATTR_SYNTAX_REGEX = /(<([a-z]+\d*)(?:\s+(?!data-bind\s*=\s*)[a-z0-9-]+(?:=(?:"[^"]*"|'[^']*'|[^>]*))?)*\s+)data-bind\s*=\s*(["'])([\s\S]*?)\3/gi;
const MEMOIZE_VIRTUAL_CONTAINER_BINDING_SYNTAX_REGEX = /<!--\s*ko\b\s*([\s\S]*?)\s*-->/g;

const _validateDataBindValuesForRewriting = (keyValueArray) => {
    let allValidators = bindingRewriteValidators;
    for (let {key, value} of keyValueArray) {
        // we can assume allValidators is an augmented Array and has the `hasOwnProperty` method
        if (allValidators.hasOwnProperty(key)) {
            let validator = allValidators[key];

            if (typeof validator === 'function') {
                let possibleErrorMessage = validator(value);
                if (possibleErrorMessage) {
                    throw new Error(possibleErrorMessage);
                }
            } else if (!validator) {
                throw new Error('This template engine does not support the \'' + key + '\' binding within its templates');
            }
        }
    }
};

// TODO remove opera anno 2011 hack
const _constructMemoizedTagReplacement = (dataBindAttributeValue, tagToRetain, nodeName, templateEngine) => {
    let dataBindKeyValueArray = parseObjectLiteral(dataBindAttributeValue);
    _validateDataBindValuesForRewriting(dataBindKeyValueArray);
    let rewrittenDataBindAttributeValue = preProcessBindings(dataBindKeyValueArray, {valueAccessors: true});

    // For no obvious reason, Opera fails to evaluate rewrittenDataBindAttributeValue unless it's wrapped in an additional
    // anonymous function, even though Opera's built-in debugger can evaluate it anyway. No other browser requires this
    // extra indirection.
    let applyBindingsToNextSiblingScript =
        'ko.__tr_ambtns(function($context,$element){return(function(){return{ ' + rewrittenDataBindAttributeValue + ' } })()},\'' + nodeName.toLowerCase() + '\')';
    return templateEngine.createJavaScriptEvaluatorBlock(applyBindingsToNextSiblingScript) + tagToRetain;
};

export const applyMemoizedBindingsToNextSibling = (bindings, nodeName) => memoize((domNode, bindingContext) => {
    let nodeToBind = domNode.nextSibling;
    if (nodeToBind && nodeToBind.nodeName.toLowerCase() === nodeName) {
        applyBindingAccessorsToNode(nodeToBind, bindings, bindingContext);
    }
});


export const ensureTemplateIsRewritten = (template, templateEngine, templateDocument) => {
    if (templateEngine.isTemplateRewritten(template, templateDocument)) {
        return;
    }
    templateEngine.rewriteTemplate(template, htmlString => memoizeBindingAttributeSyntax(htmlString, templateEngine), templateDocument);
};

export const memoizeBindingAttributeSyntax = (htmlString, templateEngine) => {
    return htmlString
        .replace(MEMOIZE_DATA_BINDING_ATTR_SYNTAX_REGEX,
            (_0, tagToRetain, nodeName, _3, dataBindAttributeValue) => _constructMemoizedTagReplacement(dataBindAttributeValue, tagToRetain, nodeName, templateEngine))
        .replace(MEMOIZE_VIRTUAL_CONTAINER_BINDING_SYNTAX_REGEX,
            (_0, dataBindAttributeValue) => _constructMemoizedTagReplacement(dataBindAttributeValue, /* tagToRetain: */ '<!-- ko -->', /* nodeName: */ '#comment', templateEngine));
};
