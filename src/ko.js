// This is the final knockout library to be built. 
// Anything that's not contained in the default export at the bottom of this file won't be accessible later.  

import {onError, _overrideOnError} from './onError';
import {childNodes, firstChild, nextSibling, emptyNode, insertAfter, allowedBindings, prepend, setDomNodeChildren} from './virtualElements';
import {cleanNode, removeNode, addDisposeCallback, removeDisposeCallback, _cleanExternalData, _overrideCleanExternalData} from './utils.domNodeDisposal';
import {dataFor, contextFor, applyBindings, applyBindingsToNode, applyBindingsToDescendants,
        bindingEvent, applyBindingAccessorsToNode, _setKoReferenceForBindingContexts} from './binding/bindingAttributeSyntax';
import {bindingHandlers, getBindingHandler, _overrideGetBindingHandler} from './binding/bindingHandlers';
import * as utils from './utils';
import {parseHtmlForTemplateNodes, parseHtmlFragment, setHtml} from './utils.domManipulation';
import {cancelTask, runEarly, resetForTesting, scheduleTask, _scheduler, _overrideScheduler} from './tasks';
import {options} from './options';
import {computed, dependentObservable, pureComputed} from './subscribables/dependentObservable';
import {observable} from './subscribables/observable';
import {isWritableObservable, isSubscribable, isComputed, isPureComputed, isObservable, isObservableArray} from './subscribables/observableUtils';
import {Subscribable} from './subscribables/subscribable';
import {observableArray} from './subscribables/observableArray';
import {memoize, unmemoize, parseMemoText, unmemoizeDomNodeAndDescendants} from './memoization';
import {applyMemoizedBindingsToNextSibling} from './templating/templateRewriting';
import {getDomData, setDomData, clearDomData} from './utils.domData';
import {extenders} from './subscribables/extenders';
import {ignoreDependencyDetection, getDependencies, getDependenciesCount, isInitialDependency, registerDependency} from './subscribables/dependencyDetection';
import {toJS, toJSON} from './subscribables/mappingHelpers';
import {NativeTemplateEngine} from './templating/native/nativeTemplateEngine';
import {setTemplateEngine} from './templating/templating';
import {when} from './subscribables/when';
import {TemplateEngine} from './templating/templateEngine';
import {AnonymousTemplate, DomElementTemplate} from './templating/templateSources';
import {bindingRewriteValidators, parseObjectLiteral, preProcessBindings, _twoWayBindings} from './binding/expressionRewriting';
import {loaders as componentLoaders, _setComponentLoaders, getComponent, clearCachedDefinition} from './components/loaderRegistry';
import {defaultLoader, isComponentRegistered, registerComponent, unregisterComponent} from './components/defaultLoader';
import {setDomNodeChildrenFromArrayMapping} from './binding/editDetection/arrayToDomNodeChildren';
import {renderTemplate} from './templating/templating';
import {compareArrays, _overrideCompareArrays, findMovesInArrayComparison} from './binding/editDetection/compareArrays';
import {KoBindingProvider} from './binding/bindingProvider';
import {addBindingsForCustomElement, getComponentNameForNode, _overrideGetComponentNameForNode} from './components/customElements';
import './binding/defaultBindings/allDefaultBindings';
import {readSelectOrOptionValue, writeSelectOrOptionValue} from './binding/selectExtensions';
import {unwrapObservable} from './utils';

const expressionRewriting = {
    bindingRewriteValidators,
    parseObjectLiteral,
    preProcessBindings,
    _twoWayBindings,
    insertPropertyAccessorsIntoJson: preProcessBindings // alias for backwards compat
};


// ********************** export all props/methods/namespaces to be exposed publicly *********************************

const ko = {
    version, // eslint-disable-line no-undef
    options,
    utils: Object.assign({
        setTimeout: utils.setTimeoutWithCatchError,  // alias for backwards compat.

        parseHtmlFragment,
        parseHtmlForTemplateNodes,
        setHtml,
        parseJson: JSON.parse,
        setDomNodeChildrenFromArrayMapping,
        get compareArrays() { return compareArrays; },
        set compareArrays(fn) { _overrideCompareArrays(fn); },
        findMovesInArrayComparison,

        domData: {
            get: getDomData,
            set: setDomData,
            clear: clearDomData
        },
        domNodeDisposal: {
            removeNode,
            get cleanExternalData() { return _cleanExternalData; },
            set cleanExternalData(fn) { _overrideCleanExternalData(fn); },
            addDisposeCallback,
            removeDisposeCallback
        }
    }, utils),
    unwrap: unwrapObservable,
    removeNode,
    cleanNode,
    memoization: {
        memoize,
        unmemoize,
        parseMemoText,
        unmemoizeDomNodeAndDescendants
    },
    tasks: {
        cancel: cancelTask,
        runEarly,
        resetForTesting,
        schedule: scheduleTask,
        get scheduler() { return _scheduler; },
        set scheduler(s) { _overrideScheduler(s); }
    },
    extenders,
    subscribable: Subscribable,
    isSubscribable,
    computedContext: {
        getDependenciesCount,
        getDependencies,
        isInitial: isInitialDependency,
        registerDependency
    },
    ignoreDependencies: ignoreDependencyDetection,
    observable,
    isObservable,
    isWritableObservable,
    isWriteableObservable: isWritableObservable,
    observableArray,
    isObservableArray,
    computed,
    dependentObservable,
    isComputed,
    isPureComputed,
    pureComputed,
    toJSON,
    toJS,
    when,
    selectExtensions: {
        readValue: readSelectOrOptionValue,
        writeValue: writeSelectOrOptionValue
    },
    expressionRewriting,
    jsonExpressionRewriting: expressionRewriting,
    virtualElements: {
        childNodes,
        firstChild,
        nextSibling,
        allowedBindings,
        emptyNode,
        insertAfter,
        prepend,
        setDomNodeChildren
    },
    bindingProvider: KoBindingProvider,
    get getBindingHandler() { return getBindingHandler; },
    set getBindingHandler(fn) { _overrideGetBindingHandler(fn); },
    bindingHandlers,
    bindingEvent,
    applyBindings,
    applyBindingsToDescendants,
    applyBindingAccessorsToNode,
    applyBindingsToNode,
    contextFor,
    dataFor,
    components: {
        get loaders() { return componentLoaders; },
        set loaders(newLoaders) { _setComponentLoaders(newLoaders); },
        // Expose the default loader so that developers can directly ask it for configuration or to resolve configuration
        defaultLoader,
        get: getComponent,
        clearCachedDefinition,
        isRegistered: isComponentRegistered,
        register: registerComponent,
        unregister: unregisterComponent,
        addBindingsForCustomElement,
        get getComponentNameForNode() { return getComponentNameForNode; },
        set getComponentNameForNode(fn) { _overrideGetComponentNameForNode(fn); }
    },
    templateEngine: TemplateEngine,
    __tr_ambtns: applyMemoizedBindingsToNextSibling, // eslint-disable-line camelcase
    templateSources: {
        domElement: DomElementTemplate,
        anonymousTemplate: AnonymousTemplate
    },
    setTemplateEngine,
    renderTemplate,
    nativeTemplateEngine: NativeTemplateEngine,
    get onError() { return onError; },
    set onError(fnOrNull) { _overrideOnError(fnOrNull); }
};

_setKoReferenceForBindingContexts(ko);

export default ko;
