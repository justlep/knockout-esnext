import {addDisposeCallback, removeDisposeCallback} from '../utils.domNodeDisposal';
import {trySetPrototypeOf} from '../utils';
import {applyExtenders} from './extenders';
import {beginDependencyDetection, endDependencyDetection} from './dependencyDetection';
import {isObservable, IS_SUBSCRIBABLE} from './observableUtils';

export class Subscription {
    
    constructor(target, callback, disposeCallback) {
        this._target = target;
        this._callback = callback;
        this._disposeCallback = disposeCallback;
        this._isDisposed = false;
        this._node = null;
        this._domNodeDisposalCallback = null;
    }
    
    dispose() {
        if (this._isDisposed) {
            return;
        }
        if (this._domNodeDisposalCallback) {
            removeDisposeCallback(this._node, this._domNodeDisposalCallback);
        }
        this._isDisposed = true;
        this._disposeCallback();
        this._target = this._callback = this._disposeCallback = this._node = this._domNodeDisposalCallback = null;
    }
    
    disposeWhenNodeIsRemoved(node) {
        this._node = node;
        addDisposeCallback(node, this._domNodeDisposalCallback = this.dispose.bind(this));
    }
}

const DEFAULT_EVENT = 'change';

// Moved out of "limit" to avoid the extra closure
function _limitNotifySubscribers(value, event) {
    if (!event || event === DEFAULT_EVENT) {
        this._limitChange(value);
    } else if (event === 'beforeChange') {
        this._limitBeforeChange(value);
    } else {
        this._origNotifySubscribers(value, event);
    }
}

export const updateSubscribableVersion = (subscribableOrComputed) => subscribableOrComputed._versionNumber++; //@inline-global

export const hasSubscriptionsForEvent = (subscribable, event) => (subscribable._subscriptions[event] || 0).length; //@inline-global

/**
 * (!) must not be shortcut so `subscribable._versionNumber !== versionToCheck`
 * @internal
 */
export const hasSubscribableChanged = (subscribable, versionToCheck) => subscribable.getVersion() !== versionToCheck; //@inline-global

/**
 * @param subscribable
 * cleaner but slower would be { [DEFAULT_EVENT]: [] } instead of {change: []}
 * TODO remove the && once macros with function bodies are supported 
 */
export const initSubscribableInternal = (subscribable) => (subscribable._subscriptions = {change: []}) && (subscribable._versionNumber = 1); //@inline-global 

export const SUBSCRIBABLE_PROTOTYPE = {
    [IS_SUBSCRIBABLE]: true,
    
    init(instance) {
        initSubscribableInternal(instance);
    },

    subscribe(callback, callbackTarget, event) {
        event = event || DEFAULT_EVENT;
        let boundCallback = callbackTarget ? callback.bind(callbackTarget) : callback;

        let subscription = new Subscription(this, boundCallback, () => {
            let _subscriptions = this._subscriptions[event],
                foundIndex = _subscriptions.indexOf(subscription);
            if (foundIndex >= 0) {
                _subscriptions.splice(foundIndex, 1);
            }
            if (this.afterSubscriptionRemove) {
                this.afterSubscriptionRemove(event);
            }
        });

        if (this.beforeSubscriptionAdd) {
            this.beforeSubscriptionAdd(event);
        }
        let _subscriptions = this._subscriptions,
            existingSubscriptionsForEvent = _subscriptions[event]; 
        if (existingSubscriptionsForEvent) {
            existingSubscriptionsForEvent.push(subscription);
        } else {
            _subscriptions[event] = [subscription];
        }
        return subscription;
    },

    notifySubscribers(valueToNotify, event = DEFAULT_EVENT) {
        if (event === DEFAULT_EVENT) {
            updateSubscribableVersion(this);
        }
        if (!hasSubscriptionsForEvent(this, event)) {
            return;
        }
        let subs = (event === DEFAULT_EVENT) && this._changeSubscriptions || this._subscriptions[event].slice();
        try {
            beginDependencyDetection(); // Begin suppressing dependency detection (by setting the top frame to undefined)
            for (let i = 0, subscription; subscription = subs[i]; ++i) { // TODO check if subs changes during loop
                // In case a subscription was disposed during the arrayForEach cycle, check
                // for isDisposed on each subscription before invoking its callback
                if (!subscription._isDisposed) {
                    subscription._callback(valueToNotify);
                }
            }
        } finally {
            endDependencyDetection(); // End suppressing dependency detection
        }
    },

    getVersion() {
        return this._versionNumber;
    },

    /**
     * Only for external use. 
     * KO-internally use {@link hasSubscribableChanged} macro directly to save another function call 
     * @param {number} versionToCheck
     * @return {boolean}
     */
    hasChanged(versionToCheck) {
        return hasSubscribableChanged(this, versionToCheck);
    },

    limit(limitFunction) {
        let selfIsObservable = isObservable(this),
            ignoreBeforeChange, 
            notifyNextChange, 
            previousValue, 
            pendingValue, 
            didUpdate,
            beforeChange = 'beforeChange';

        if (!this._origNotifySubscribers) {
            this._origNotifySubscribers = this.notifySubscribers;
            this.notifySubscribers = _limitNotifySubscribers;
        }

        let finish = limitFunction(() => {
            this._notificationIsPending = false;

            // If an observable provided a reference to itself, access it to get the latest value.
            // This allows computed observables to delay calculating their value until needed.
            if (selfIsObservable && pendingValue === this) {
                pendingValue = this._evalIfChanged ? this._evalIfChanged() : this();
            }
            let shouldNotify = notifyNextChange || (didUpdate && (!this.equalityComparer || !this.equalityComparer(previousValue, pendingValue)));

            didUpdate = notifyNextChange = ignoreBeforeChange = false;

            if (shouldNotify) {
                this._origNotifySubscribers(previousValue = pendingValue);
            }
        });

        this._limitChange = (value, isDirty) => {
            if (!isDirty || !this._notificationIsPending) {
                didUpdate = !isDirty;
            }
            this._changeSubscriptions = this._subscriptions[DEFAULT_EVENT].slice();
            this._notificationIsPending = ignoreBeforeChange = true;
            pendingValue = value;
            finish();
        };
        this._limitBeforeChange = (value) => {
            if (!ignoreBeforeChange) {
                previousValue = value;
                this._origNotifySubscribers(value, beforeChange);
            }
        };
        this._recordUpdate = () => didUpdate = true;

        this._notifyNextChangeIfValueIsDifferent = () => {
            let equalityComparer = this.equalityComparer;
            if (!equalityComparer || !equalityComparer(previousValue, this.peek(true /*evaluate*/))) {
                notifyNextChange = true;
            }
        };
    },

    getSubscriptionsCount(event) {
        let event2subscriptions = this._subscriptions;
        if (event) {
            let subscriptions = event2subscriptions[event]; 
            return subscriptions ? subscriptions.length : 0;
        }
        let total = 0;
        if (event2subscriptions) {
            for (let eventName of Object.keys(event2subscriptions)) {
                let subscriptions = event2subscriptions[eventName];
                if (eventName !== 'dirty') {
                    total += subscriptions.length;
                }
            }
        }
        return total;
    },

    // /** @deprecated */
    // isDifferent(oldValue, newValue) {
    //     return !this.equalityComparer || !this.equalityComparer(oldValue, newValue);
    // },

    toString() {
      return '[object Object]';
    },

    extend: applyExtenders
};

/**
 * @constructor
 */
export const Subscribable = function () {
    initSubscribableInternal(this);
};

Subscribable.prototype = SUBSCRIBABLE_PROTOTYPE;
Subscribable.fn = SUBSCRIBABLE_PROTOTYPE;

// For browsers that support proto assignment, we overwrite the prototype of each
// observable instance. Since observables are functions, we need Function.prototype
// to still be in the prototype chain.
trySetPrototypeOf(SUBSCRIBABLE_PROTOTYPE, Function.prototype);
