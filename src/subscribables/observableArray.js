import {observable, OBSERVABLE_PROTOTYPE, observableValueWillMutateInternal, peekObservableInternal} from './observable';
import {setPrototypeOfOrExtend, trySetPrototypeOf} from '../utils';
import {isObservable, IS_OBSERVABLE_ARRAY, IS_OBSERVABLE} from './observableUtils';
import {trackArrayChanges} from './observableArray.changeTracking';


export const observableArray = function (initialValues) {
    initialValues = initialValues || [];

    if (!Array.isArray(initialValues)) {
        throw new Error('The argument passed when initializing an observable array must be an array, or null, or undefined.');
    }
    let result = observable(initialValues);
    setPrototypeOfOrExtend(result, OBSERVABLE_ARRAY_PROTOTYPE);
    trackArrayChanges(result);
    return result;
};

const _getItemFilterPredicate = valueOrPredicate => //@inline
            (typeof valueOrPredicate === 'function' && !valueOrPredicate[IS_OBSERVABLE]) ? valueOrPredicate 
                                                                                         : (value) => value === valueOrPredicate;

const OBSERVABLE_ARRAY_PROTOTYPE = {
    [IS_OBSERVABLE_ARRAY]: true,
    remove(valueOrPredicate) {
        let underlyingArray = peekObservableInternal(this),
            removedValues = [],
            totalRemovedValues = 0,
            predicate = _getItemFilterPredicate(valueOrPredicate);
        
         for (let i = 0; i < underlyingArray.length; i++) {
            let value = underlyingArray[i];
            if (predicate(value)) {
                if (!totalRemovedValues) {
                    observableValueWillMutateInternal(this);
                }
                if (underlyingArray[i] !== value) {
                    throw Error('Array modified during remove; cannot remove item');
                }
                totalRemovedValues = removedValues.push(value);
                underlyingArray.splice(i, 1);
                i--;
            }
        }
        if (totalRemovedValues) {
            this.valueHasMutated();
        }
        return removedValues;
    },

    removeAll(arrayOfValues) {
        // If you passed zero args, we remove everything
        if (arrayOfValues === undefined) {
            let underlyingArray = peekObservableInternal(this),
                allValues = underlyingArray.slice();
            
            observableValueWillMutateInternal(this);
            underlyingArray.splice(0, underlyingArray.length);
            this.valueHasMutated();
            return allValues;
        }
        // If you passed an arg, we interpret it as an array of entries to remove
        return arrayOfValues ? this.remove(value => arrayOfValues.includes(value)) : [];
    },

    destroy(valueOrPredicate) {
        let underlyingArray = peekObservableInternal(this),
            predicate = _getItemFilterPredicate(valueOrPredicate);
        
        observableValueWillMutateInternal(this);
        for (let i = underlyingArray.length - 1; i >= 0; i--) {
            let value = underlyingArray[i];
            if (predicate(value)) {
                value._destroy = true;
            }
        }
        this.valueHasMutated();
    },

    destroyAll(arrayOfValues) {
        // If you passed zero args, we destroy everything

        // If you passed an arg, we interpret it as an array of entries to destroy
        return (arrayOfValues === undefined) ? this.destroy(() => true) : 
                arrayOfValues ? this.destroy(value => arrayOfValues.includes(value)) : [];
    },

    indexOf(item) {
        return this().indexOf(item);
    },

    replace(oldItem, newItem) {
        let underlyingArray = this(),
            index = underlyingArray.indexOf(oldItem);
        if (index >= 0) {
            observableValueWillMutateInternal(this);
            underlyingArray[index] = newItem;
            this.valueHasMutated();
        }
    },

    sorted(compareFunction) {
        let arrayCopy = this().slice();
        return compareFunction ? arrayCopy.sort(compareFunction) : arrayCopy.sort();
    },

    reversed() {
        return this().slice().reverse();
    },

    // Populate ko.observableArray.fn with read-only functions from native arrays
    slice() {
        return this().slice(...arguments);
    }
};

observableArray.fn = OBSERVABLE_ARRAY_PROTOTYPE;

// Note that for browsers that don't support proto assignment, the
// inheritance chain is created manually in the ko.observableArray constructor
trySetPrototypeOf(OBSERVABLE_ARRAY_PROTOTYPE, OBSERVABLE_PROTOTYPE);

// Populate ko.observableArray.fn with read/write functions from native arrays
// Important: Do not add any additional functions here that may reasonably be used to *read* data from the array
// because we'll eval them without causing subscriptions, so ko.computed output could end up getting stale
for (let methodName of ['pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift']) {
    OBSERVABLE_ARRAY_PROTOTYPE[methodName] = function () {
        // Use 'peek' to avoid creating a subscription in any computed that we're executing in the context of
        // (for consistency with mutating regular observables)
        let underlyingArray = peekObservableInternal(this);
        observableValueWillMutateInternal(this);
        this.cacheDiffForKnownOperation(underlyingArray, methodName, arguments);
        let methodCallResult = underlyingArray[methodName].apply(underlyingArray, arguments);
        this.valueHasMutated();
        // The native sort and reverse methods return a reference to the array, but it makes more sense to return the observable array instead.
        return methodCallResult === underlyingArray ? this : methodCallResult;
    };
}
