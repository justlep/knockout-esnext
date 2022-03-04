import {options as koOptions} from '../options';
import {registerDependencyInternal, beginDependencyDetection, endDependencyDetection} from './dependencyDetection';
import {deferredExtender} from './deferredExtender';
import {hasSubscriptionsForEvent, SUBSCRIBABLE_PROTOTYPE, updateSubscribableVersion, hasSubscribableChanged, initSubscribableInternal} from './subscribable';
import {removeDisposeCallback, addDisposeCallback} from '../utils.domNodeDisposal';
import {setPrototypeOfOrExtend, trySetPrototypeOf, domNodeIsAttachedToDocument, valuesArePrimitiveAndEqual, canSetPrototype} from '../utils';
import {IS_COMPUTED, IS_OBSERVABLE, IS_PURE_COMPUTED} from './observableUtils';
import {defineThrottleExtender} from './extenders';

const COMPUTED_STATE = Symbol('_state');
const THROTTLE_TIMER = Symbol();

export function computed(evaluatorFunctionOrOptions, evaluatorFunctionTarget, options) {
    if (typeof evaluatorFunctionOrOptions === "object") {
        // Single-parameter syntax - everything is on this "options" param
        options = evaluatorFunctionOrOptions;
    } else {
        // Multi-parameter syntax - construct the options according to the params passed
        options = options || {};
        if (evaluatorFunctionOrOptions) {
            options.read = evaluatorFunctionOrOptions;
        }
    }
    if (typeof options.read !== 'function') {
        throw Error("Pass a function that returns the value of the ko.computed");
    }

    let writeFunction = options.write,
        state = {
            latestValue: undefined,
            isStale: true,
            isDirty: true,
            isBeingEvaluated: false,
            suppressDisposalUntilDisposeWhenReturnsFalse: false,
            isDisposed: false,
            pure: false,
            isSleeping: false,
            readFunction: options.read,
            evaluatorFunctionTarget: evaluatorFunctionTarget || options.owner,
            disposeWhenNodeIsRemoved: options.disposeWhenNodeIsRemoved || null,
            disposeWhen: options.disposeWhen,
            domNodeDisposalCallback: null,
            dependencyTracking: {},
            dependenciesCount: 0,
            evaluationTimeoutInstance: null
        };

    function _computedObservable() {
        if (arguments.length) {
            if (typeof writeFunction === 'function') {
                // Writing a value
                writeFunction.apply(state.evaluatorFunctionTarget, arguments);
                return this; // Permits chained assignments
            } 
            throw new Error("Cannot write a value to a ko.computed unless you specify a 'write' option. If you wish to read the current value, don't pass any parameters.");
        } 
        // Reading the value
        if (!state.isDisposed) {
            registerDependencyInternal(_computedObservable);
        }
        if (state.isDirty || (state.isSleeping && _computedObservable.haveDependenciesChanged())) {
            _computedObservable.evaluate();
        }
        return state.latestValue;
    }

    _computedObservable[COMPUTED_STATE] = state;
    _computedObservable.hasWriteFunction = typeof writeFunction === 'function';
    
    // Inherit from './subscribable.js'
    if (!canSetPrototype) {
        // 'subscribable' won't be on the prototype chain unless we put it there directly
        Object.assign(_computedObservable, SUBSCRIBABLE_PROTOTYPE);
    }
    initSubscribableInternal(_computedObservable);

    // Inherit from './computed.js'
    setPrototypeOfOrExtend(_computedObservable, COMPUTED_PROTOTYPE);

    if (options.pure) {
        _computedObservable[IS_PURE_COMPUTED] = true;
        state.pure = true;
        state.isSleeping = true;     // Starts off sleeping; will awake on the first subscription
        //Object.assign(_computedObservable, pureComputedOverrides);
        //above Object.assign for just 3 properties is 25% slower in Chrome85 & 50% slower in FF81 compared to manual assignment 
        _computedObservable.afterSubscriptionRemove = _pureAfterSubscriptionRemove;
        _computedObservable.beforeSubscriptionAdd = _pureBeforeSubscriptionAdd;
        _computedObservable.getVersion = _pureGetVersion;
    } else if (options.deferEvaluation) {
        Object.assign(_computedObservable, deferEvaluationOverrides);
    }

    if (koOptions.deferUpdates) {
        deferredExtender(_computedObservable, true);
    }

    if (DEBUG) {
        // #1731 - Aid debugging by exposing the computed's options
        _computedObservable._options = options;
    }

    let __disposeWhenNodeIsRemoved = state.disposeWhenNodeIsRemoved; 
    
    if (__disposeWhenNodeIsRemoved) {
        // Since this computed is associated with a DOM node, and we don't want to dispose the computed
        // until the DOM node is *removed* from the document (as opposed to never having been in the document),
        // we'll prevent disposal until "disposeWhen" first returns false.
        state.suppressDisposalUntilDisposeWhenReturnsFalse = true;

        // disposeWhenNodeIsRemoved: true can be used to opt into the "only dispose after first false result"
        // behaviour even if there's no specific node to watch. In that case, clear the option so we don't try
        // to watch for a non-node's disposal. This technique is intended for KO's internal use only and shouldn't
        // be documented or used by application code, as it's likely to change in a future version of KO.
        if (!__disposeWhenNodeIsRemoved.nodeType) {
            state.disposeWhenNodeIsRemoved = null;
        }
    }

    // Evaluate, unless sleeping or deferEvaluation is true
    if (!state.isSleeping && !options.deferEvaluation) {
        _computedObservable.evaluate();
    }

    // Attach a DOM node disposal callback so that the computed will be proactively disposed as soon as the node is
    // removed using ko.removeNode. But skip if isActive is false (there will never be any dependencies to dispose).
    __disposeWhenNodeIsRemoved = state.disposeWhenNodeIsRemoved;
    if (__disposeWhenNodeIsRemoved && _computedObservable.isActive()) {
        addDisposeCallback(__disposeWhenNodeIsRemoved, state.domNodeDisposalCallback = () => _computedObservable.dispose());
    }

    return _computedObservable;
}

// This function gets called each time a dependency is detected while evaluating a computed.
// It's factored out as a shared function to avoid creating unnecessary function instances during evaluation.
function computedBeginDependencyDetectionCallback(subscribable, id) {
    let computedObservable = this.computedObservable,
        state = computedObservable[COMPUTED_STATE];
    
    if (!state.isDisposed) {
        let __disposalCandidate = this.disposalCount && this.disposalCandidates[id];
        if (__disposalCandidate) {
            // Don't want to dispose this subscription, as it's still being used
            computedObservable.addDependencyTracking(id, subscribable, __disposalCandidate);
            this.disposalCandidates[id] = null; // No need to actually delete the property - disposalCandidates is a transient object anyway
            --this.disposalCount;
        } else if (!state.dependencyTracking[id]) {
            // Brand new subscription - add it
            computedObservable.addDependencyTracking(id, subscribable, state.isSleeping ? {_target: subscribable} : computedObservable.subscribeToDependency(subscribable));
        }
        // If the observable we've accessed has a pending notification, ensure we get notified of the actual final value (bypass equality checks)
        if (subscribable._notificationIsPending) {
            subscribable._notifyNextChangeIfValueIsDifferent();
        }
    }
}

const COMPUTED_PROTOTYPE = {
    [IS_OBSERVABLE]: true,
    [IS_COMPUTED]: true,
    equalityComparer: valuesArePrimitiveAndEqual,
    
    getDependenciesCount() {
        return this[COMPUTED_STATE].dependenciesCount;
    },
    getDependencies() {
        let dependencyTracking = this[COMPUTED_STATE].dependencyTracking,
            dependentObservables = [];
        
        if (dependencyTracking) {
            for (let id of Object.keys(dependencyTracking)) {
                let dependency = dependencyTracking[id];
                dependentObservables[dependency._order] = dependency._target;
            }
        }
        return dependentObservables;
    },
    hasAncestorDependency(obs) {
        let computedState = this[COMPUTED_STATE];
        if (!computedState.dependenciesCount) {
            return false;
        }
        /**
         * Given how often this method is called and regarding its recursive nature,
         * let's forget DRY for a sec & pull a copy of `getDependencies` right here..
         */
        let dependencyTracking = computedState.dependencyTracking;
        if (!dependencyTracking) {
            return false;
        }
        let dependentObservables = [];
        
        for (let id of Object.keys(dependencyTracking)) {
            let dependency = dependencyTracking[id];
            dependentObservables[dependency._order] = dependency._target;
        }
        return dependentObservables.includes(obs) || !!dependentObservables.find(dep => dep.hasAncestorDependency && dep.hasAncestorDependency(obs));
    },
    addDependencyTracking(id, target, trackingObj) {
        let computedState = this[COMPUTED_STATE]; 
        if (computedState.pure && target === this) {
            throw Error("A 'pure' computed must not be called recursively");
        }
        computedState.dependencyTracking[id] = trackingObj;
        trackingObj._order = computedState.dependenciesCount++;
        trackingObj._version = target.getVersion();
    },
    haveDependenciesChanged() {
        let dependencyTracking = this[COMPUTED_STATE].dependencyTracking;
        if (dependencyTracking) {
            let hasEvalDelayed = this._evalDelayed;
            for (let id of Object.keys(dependencyTracking)) {
                let dependency = dependencyTracking[id],
                    depTarget = dependency._target;
                if ((hasEvalDelayed && depTarget._notificationIsPending) || hasSubscribableChanged(depTarget, dependency._version)) {
                    return true;
                }
            }
        }
        return false;
    },
    markDirty() {
        let __evalDelayed = this._evalDelayed;
        // Process "dirty" events if we can handle delayed notifications
        if (__evalDelayed && !this[COMPUTED_STATE].isBeingEvaluated) {
            __evalDelayed(false /*isChange*/);
        }
    },
    isActive() {
        let state = this[COMPUTED_STATE];
        return state.isDirty || state.dependenciesCount > 0;
    },
    respondToChange() {
        // Ignore "change" events if we've already scheduled a delayed notification
        if (!this._notificationIsPending) {
            this.evaluate(true, true /* checkPossiblyAsync */); 
            return;
        }
        let computedState = this[COMPUTED_STATE];
        if (computedState.isDirty) {
            computedState.isStale = true;
        }
    },
    subscribeToDependency(target) {
        if (target._deferUpdates) {
            let dirtySub = target.subscribe(this.markDirty, this, 'dirty'),
                changeSub = target.subscribe(this.respondToChange, this);
            return {
                _target: target,
                dispose: () => {
                    dirtySub.dispose();
                    changeSub.dispose();
                }
            };
        }
        return target.subscribe(val => this.evaluate(val, true /* checkPossiblyAsync */), this);
    },
    evaluate(notifyChange, checkPossiblyAsync) {
        if (checkPossiblyAsync) {
            if (this.throttleEvaluation) {
                clearTimeout(this[THROTTLE_TIMER]);
                this[THROTTLE_TIMER] = setTimeout(() => this.evaluate(true), this.throttleEvaluation);
                return;
            } 
            if (this._evalDelayed) {
                this._evalDelayed(true /*isChange*/);
                return;
            }
            notifyChange = true;
        }

        let state = this[COMPUTED_STATE],
            disposeWhen = state.disposeWhen,
            changed = false;
        
        if (state.isBeingEvaluated) {
            // If the evaluation of a ko.computed causes side effects, it's possible that it will trigger its own re-evaluation.
            // This is not desirable (it's hard for a developer to realise a chain of dependencies might cause this, and they almost
            // certainly didn't intend infinite re-evaluations). So, for predictability, we simply prevent ko.computeds from causing
            // their own re-evaluation. Further discussion at https://github.com/SteveSanderson/knockout/pull/387
            return;
        }

        // Do not evaluate (and possibly capture new dependencies) if disposed
        if (state.isDisposed) {
            return;
        }

        if (state.disposeWhenNodeIsRemoved && !domNodeIsAttachedToDocument(state.disposeWhenNodeIsRemoved) || disposeWhen && disposeWhen()) {
            // See comment above about suppressDisposalUntilDisposeWhenReturnsFalse
            if (!state.suppressDisposalUntilDisposeWhenReturnsFalse) {
                this.dispose();
                return;
            }
        } else {
            // It just did return false, so we can stop suppressing now
            state.suppressDisposalUntilDisposeWhenReturnsFalse = false;
        }

        state.isBeingEvaluated = true;
        try {
            changed = this.evaluateImmediate_CallReadWithDependencyDetection(notifyChange);
        } finally {
            state.isBeingEvaluated = false;
        }

        return changed;
    },
    evaluateImmediate_CallReadWithDependencyDetection(notifyChange) {  // eslint-disable-line camelcase
        // This function is really just part of the evaluateImmediate logic. You would never call it from anywhere else.
        // Factoring it out into a separate function means it can be independent of the try/catch block in evaluateImmediate,
        // which contributes to saving about 40% off the CPU overhead of computed evaluation (on V8 at least).

        let computedObservable = this,
            state = computedObservable[COMPUTED_STATE],
            changed = false;

        // Initially, we assume that none of the subscriptions are still being used (i.e., all are candidates for disposal).
        // Then, during evaluation, we cross off any that are in fact still being used.
        let isInitial = state.pure ? undefined : !state.dependenciesCount,   // If we're evaluating when there are no previous dependencies, it must be the first time
            dependencyDetectionContext = {
                computedObservable,
                disposalCandidates: state.dependencyTracking,
                disposalCount: state.dependenciesCount
            };

        beginDependencyDetection({
            callbackTarget: dependencyDetectionContext,
            callback: computedBeginDependencyDetectionCallback,
            computed: computedObservable,
            isInitial
        });

        // TODO check: Map might be more efficient (at least in Chrome, how about firefox?)
        state.dependencyTracking = {};
        state.dependenciesCount = 0;

        let newValue = this.evaluateImmediate_CallReadThenEndDependencyDetection(state, dependencyDetectionContext);

        if (!state.dependenciesCount) {
            computedObservable.dispose();
            changed = true; // When evaluation causes a disposal, make sure all dependent computeds get notified so they'll see the new state
        } else {
            let equalityComparer = computedObservable.equalityComparer;
            changed = !equalityComparer || !equalityComparer(state.latestValue, newValue);
        }

        if (changed) {
            if (!state.isSleeping) {
                computedObservable.notifySubscribers(state.latestValue, "beforeChange");
            } else {
                updateSubscribableVersion(computedObservable);
            }

            state.latestValue = newValue;
            if (DEBUG) {
                computedObservable._latestValue = newValue;
            }

            computedObservable.notifySubscribers(state.latestValue, "spectate");

            if (!state.isSleeping && notifyChange) {
                computedObservable.notifySubscribers(state.latestValue);
            }
            if (computedObservable._recordUpdate) {
                computedObservable._recordUpdate();
            }
        }

        if (isInitial) {
            computedObservable.notifySubscribers(state.latestValue, "awake");
        }

        return changed;
    },
    evaluateImmediate_CallReadThenEndDependencyDetection(state, dependencyDetectionContext) {  // eslint-disable-line camelcase
        // This function is really part of the evaluateImmediate_CallReadWithDependencyDetection logic.
        // You'd never call it from anywhere else. Factoring it out means that evaluateImmediate_CallReadWithDependencyDetection
        // can be independent of try/finally blocks, which contributes to saving about 40% off the CPU
        // overhead of computed evaluation (on V8 at least).

        try {
            let readFunction = state.readFunction;
            return state.evaluatorFunctionTarget ? readFunction.call(state.evaluatorFunctionTarget) : readFunction();
        } finally {
            endDependencyDetection();

            // For each subscription no longer being used, remove it from the active subscriptions list and dispose it
            if (dependencyDetectionContext.disposalCount && !state.isSleeping) {
                for (let entryToDispose of Object.values(dependencyDetectionContext.disposalCandidates)) {
                    if (entryToDispose && entryToDispose.dispose) {
                        entryToDispose.dispose();
                    }
                }
            }

            state.isStale = state.isDirty = false;
        }
    },
    peek(evaluate) {
        // By default, peek won't re-evaluate, except while the computed is sleeping or to get the initial value when "deferEvaluation" is set.
        // Pass in true to evaluate if needed.
        let state = this[COMPUTED_STATE];
        if ((state.isDirty && (evaluate || !state.dependenciesCount)) || (state.isSleeping && this.haveDependenciesChanged())) {
            this.evaluate();
        }
        return state.latestValue;
    },
    limit(limitFunction) {
        // Override the limit function with one that delays evaluation as well
        SUBSCRIBABLE_PROTOTYPE.limit.call(this, limitFunction);
        this._evalIfChanged = () => {
            let computedState = this[COMPUTED_STATE];
            if (!computedState.isSleeping) {
                if (computedState.isStale) {
                    this.evaluate();
                } else {
                    computedState.isDirty = false;
                }
            }
            return computedState.latestValue;
        };
        this._evalDelayed = (isChange) => {
            let computedState = this[COMPUTED_STATE];
            this._limitBeforeChange(computedState.latestValue);

            // Mark as dirty
            computedState.isDirty = true;
            if (isChange) {
                computedState.isStale = true;
            }
            // Pass the observable to the "limit" code, which will evaluate it when
            // it's time to do the notification.
            this._limitChange(this, !isChange /* isDirty */);
        };
    },
    dispose() {
        let state = this[COMPUTED_STATE];
        if (!state.isSleeping) {
            let __depTracking = state.dependencyTracking;
            if (__depTracking) {
                for (let id of Object.keys(__depTracking)) {
                    let dep = __depTracking[id];
                    if (dep.dispose) {
                        dep.dispose();
                    }
                }
            }
        }
        if (state.disposeWhenNodeIsRemoved && state.domNodeDisposalCallback) {
            removeDisposeCallback(state.disposeWhenNodeIsRemoved, state.domNodeDisposalCallback);
        }
        state.dependencyTracking = undefined;
        state.dependenciesCount = 0;
        state.isDisposed = true;
        state.isStale = false;
        state.isDirty = false;
        state.isSleeping = false;
        state.disposeWhenNodeIsRemoved = undefined;
        state.disposeWhen = undefined;
        state.readFunction = undefined;
        if (!this.hasWriteFunction) {
            state.evaluatorFunctionTarget = undefined;
        }
    }
};

// pure overrides: beforeSubscriptionAdd, afterSubscriptionRemove, getVersion
function _pureBeforeSubscriptionAdd(event) {
    // If asleep, wake up the computed by subscribing to any dependencies.
    let computedObservable = this,
        state = computedObservable[COMPUTED_STATE];
    if (!state.isDisposed && state.isSleeping && event === 'change') {
        state.isSleeping = false;
        if (state.isStale || computedObservable.haveDependenciesChanged()) {
            state.dependencyTracking = null;
            state.dependenciesCount = 0;
            if (computedObservable.evaluate()) {
                updateSubscribableVersion(computedObservable);
            }
        } else {
            // First put the dependencies in order
            let dependenciesOrder = [],
                __dependencyTracking = state.dependencyTracking;
            
            if (__dependencyTracking) {
                for (let id of Object.keys(__dependencyTracking)) {
                    dependenciesOrder[__dependencyTracking[id]._order] = id;
                }
            }
            
            // Next, subscribe to each one
            dependenciesOrder.forEach((id, order) => {
                let dependency = __dependencyTracking[id],
                    subscription = computedObservable.subscribeToDependency(dependency._target);
                subscription._order = order;
                subscription._version = dependency._version;
                __dependencyTracking[id] = subscription;
            });
            
            // Waking dependencies may have triggered effects
            if (computedObservable.haveDependenciesChanged()) {
                if (computedObservable.evaluate()) {
                    updateSubscribableVersion(computedObservable);
                }
            }
        }

        if (!state.isDisposed) {     // test since evaluating could trigger disposal
            computedObservable.notifySubscribers(state.latestValue, "awake");
        }
    }
}

function _pureAfterSubscriptionRemove(event) {
    let state = this[COMPUTED_STATE];
    if (!state.isDisposed && event === 'change' && !hasSubscriptionsForEvent(this, 'change')) {
        let __dependencyTracking = state.dependencyTracking;
        if (__dependencyTracking) {
            for (let id of Object.keys(__dependencyTracking)) {
                let dependency = __dependencyTracking[id];
                if (dependency.dispose) {
                    __dependencyTracking[id] = {
                        _target: dependency._target,
                        _order: dependency._order,
                        _version: dependency._version
                    };
                    dependency.dispose();
                }
            }
        }
        state.isSleeping = true;
        this.notifySubscribers(undefined, "asleep");
    }
}

function _pureGetVersion() {
    // Because a pure computed is not automatically updated while it is sleeping, we can't
    // simply return the version number. Instead, we check if any of the dependencies have
    // changed and conditionally re-evaluate the computed observable.
    let state = this[COMPUTED_STATE];
    if (state.isSleeping && (state.isStale || this.haveDependenciesChanged())) {
        this.evaluate();
    }
    return SUBSCRIBABLE_PROTOTYPE.getVersion.call(this);
}


const deferEvaluationOverrides = {
    beforeSubscriptionAdd(event) {
        // This will force a computed with deferEvaluation to evaluate when the first subscription is registered.
        if (event === 'change' || event === 'beforeChange') {
            this.peek();
        }
    }
};

// Note that for browsers that don't support proto assignment, the
// inheritance chain is created manually in the ko.computed constructor
trySetPrototypeOf(COMPUTED_PROTOTYPE, SUBSCRIBABLE_PROTOTYPE);

// const PROTO_PROPERTY = ko.observable.protoProperty; // already defined in observable.js 

computed.fn = COMPUTED_PROTOTYPE;

export const dependentObservable = computed;

defineThrottleExtender(dependentObservable);

export const pureComputed = function (evaluatorFunctionOrOptions, evaluatorFunctionTarget) {
    if (typeof evaluatorFunctionOrOptions === 'function') {
        return computed(evaluatorFunctionOrOptions, evaluatorFunctionTarget, {pure: true});
    } 
    evaluatorFunctionOrOptions = Object.assign({}, evaluatorFunctionOrOptions); // make a copy of the parameter object
    evaluatorFunctionOrOptions.pure = true;
    return computed(evaluatorFunctionOrOptions, evaluatorFunctionTarget);
};
