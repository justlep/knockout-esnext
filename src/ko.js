// This is the final knockout library to be built. 
// Anything that's not contained in the default export at the bottom of this file won't be accessible later.  
import {_overrideOnError, onError} from './onError';
import {addDisposeCallback, cleanNode, removeNode} from './utils.domNodeDisposal';
import {_setKoReferenceForBindingContexts, applyBindings, contextFor, dataFor} from './binding/bindingAttributeSyntax';
import {bindingHandlers} from './binding/bindingHandlers';
import * as utils from './utils';
import {computed, pureComputed} from './subscribables/dependentObservable';
import {observable} from './subscribables/observable';
import {
    isComputed,
    isObservable,
    isObservableArray,
    isPureComputed,
    isSubscribable,
    isWritableObservable,
    unwrapObservable
} from './subscribables/observableUtils';
import {Subscribable} from './subscribables/subscribable';
import {observableArray} from './subscribables/observableArray';
import {extenders} from './subscribables/extenders';
import {when} from './subscribables/when';
import {registerComponent} from './components/defaultLoader';
import './binding/defaultBindings/allDefaultBindings';

// ********************** export all props/methods/namespaces to be exposed publicly *********************************

const ko = {
    version, // eslint-disable-line no-undef
    utils: Object.assign({
        unwrapObservable,
        domNodeDisposal: {
            removeNode,
            addDisposeCallback
        }
    }, utils),
    unwrap: unwrapObservable,
    removeNode,
    cleanNode,
    extenders,
    subscribable: Subscribable,
    isSubscribable,
    observable,
    isObservable,
    isWritableObservable,
    isWriteableObservable: isWritableObservable,
    observableArray,
    isObservableArray,
    computed,
    isComputed,
    isPureComputed,
    pureComputed,
    when,
    bindingHandlers,
    applyBindings,
    contextFor,
    dataFor,
    components: {
        register: registerComponent
    },
    get onError() { return onError; },
    set onError(fnOrNull) { _overrideOnError(fnOrNull); }
};

_setKoReferenceForBindingContexts(ko);

export default ko;
