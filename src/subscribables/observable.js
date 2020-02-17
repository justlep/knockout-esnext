import {options} from '../options';
import {registerDependency} from './dependencyDetection';
import {setPrototypeOfOrExtend, trySetPrototypeOf, canSetPrototype, valuesArePrimitiveAndEqual} from '../utils';
import {SUBSCRIBABLE_PROTOTYPE} from './subscribable';
import {IS_OBSERVABLE} from './observableUtils';
import {deferredExtender} from './deferredExtender';

const LATEST_VALUE_KEY = Symbol('_latestValue');

export const observable = function (initialValue) {

    let _observable = function () {
        let _self = _observable,
            _lastValue = _self[LATEST_VALUE_KEY];

        // Lets assume, read happens more often than write
        if (!arguments.length) {
            // Read
            registerDependency(_self); // The caller only needs to be notified of changes if they did a "read" operation
            return _lastValue;
        }
        // Write
        // Ignore writes if the value hasn't changed
        let newValue = arguments[0];
        if (_self.isDifferent(_lastValue, newValue)) {
            _self.valueWillMutate();
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
    
    SUBSCRIBABLE_PROTOTYPE.init(_observable);

    // Inherit from './observable.js'
    setPrototypeOfOrExtend(_observable, OBSERVABLE_PROTOTYPE);

    if (options.deferUpdates) {
        deferredExtender(_observable, true);
    }

    return _observable;
};

// Define prototype for observables
export const OBSERVABLE_PROTOTYPE = {
    [IS_OBSERVABLE]: true,
    equalityComparer: valuesArePrimitiveAndEqual,
    peek() {
        return this[LATEST_VALUE_KEY];
    },
    valueHasMutated() {
        this.notifySubscribers(this[LATEST_VALUE_KEY], 'spectate');
        this.notifySubscribers(this[LATEST_VALUE_KEY]);
    },
    valueWillMutate() {
        this.notifySubscribers(this[LATEST_VALUE_KEY], 'beforeChange');
    }
};

observable.fn = OBSERVABLE_PROTOTYPE;

// Note that for browsers that don't support proto assignment, the
// inheritance chain is created manually in the ko.observable constructor
trySetPrototypeOf(OBSERVABLE_PROTOTYPE, SUBSCRIBABLE_PROTOTYPE);
