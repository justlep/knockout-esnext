import {options} from '../options';
import {registerDependencyInternal} from './dependencyDetection';
import {setPrototypeOfOrExtend, trySetPrototypeOf, canSetPrototype, valuesArePrimitiveAndEqual} from '../utils';
import {initSubscribableInternal, SUBSCRIBABLE_PROTOTYPE} from './subscribable';
import {IS_OBSERVABLE} from './observableUtils';
import {deferredExtender} from './deferredExtender';

/** @internal */
export const LATEST_VALUE_KEY = Symbol('_latestValue');

export const observable = function (initialValue) {

    let _observable = function () {
        let _self = _observable;

        // Lets assume, read happens more often than write
        if (!arguments.length) {
            // Read
            registerDependencyInternal(_self); // The caller only needs to be notified of changes if they did a "read" operation
            return _self[LATEST_VALUE_KEY];
        }
        // Write
        // Ignore writes if the value hasn't changed
        let newValue = arguments[0],
            equalityComparer = _self.equalityComparer;
        
        if (!equalityComparer || !equalityComparer(_self[LATEST_VALUE_KEY], newValue)) {
            observableValueWillMutateInternal(_self);
            _self[LATEST_VALUE_KEY] = newValue;
            _self.valueHasMutated();
        }
        return this; // Permits chained assignments (on the parent view model, not the observable)
    };

    _observable[LATEST_VALUE_KEY] = initialValue;

    // Inherit from './subscribable.js'
    if (!canSetPrototype) {
        // 'subscribable' won't be on the prototype chain unless we put it there directly
        Object.assign(_observable, SUBSCRIBABLE_PROTOTYPE);
    }

    initSubscribableInternal(_observable);

    // Inherit from './observable.js'
    setPrototypeOfOrExtend(_observable, OBSERVABLE_PROTOTYPE);

    if (options.deferUpdates) {
        deferredExtender(_observable, true);
    }

    return _observable;
};

/**
 * To be used internally ONLY for observable/observableArrays but NOT for dependentObservables
 * (!) On dependent observables use .peek() !
 * @internal
 */
export const peekObservableInternal = (observable) => observable[LATEST_VALUE_KEY]; //@inline-global:LATEST_VALUE_KEY

/** @internal */
export const observableValueWillMutateInternal = (obs) => obs.notifySubscribers(obs[LATEST_VALUE_KEY], 'beforeChange'); //@inline-global:LATEST_VALUE_KEY

// Define prototype for observables
export const OBSERVABLE_PROTOTYPE = {
    [IS_OBSERVABLE]: true,
    equalityComparer: valuesArePrimitiveAndEqual,
    peek() {
        return peekObservableInternal(this);
    },
    valueHasMutated() {
        this.notifySubscribers(this[LATEST_VALUE_KEY], 'spectate');
        this.notifySubscribers(this[LATEST_VALUE_KEY]);
    },
    /** exposed only for external uses. KO-internally use {@link observableValueWillMutateInternal} macro */ 
    valueWillMutate() {
        observableValueWillMutateInternal(this);
    }
};

observable.fn = OBSERVABLE_PROTOTYPE;

// Note that for browsers that don't support proto assignment, the
// inheritance chain is created manually in the ko.observable constructor
trySetPrototypeOf(OBSERVABLE_PROTOTYPE, SUBSCRIBABLE_PROTOTYPE);
