import {deferredExtender} from './deferredExtender';

export const extenders = Object.create(null);

extenders.deferred = deferredExtender;

export function applyExtenders(requestedExtenders) {
    let target = this;
    if (requestedExtenders) {
        for (let key of Object.keys(requestedExtenders)) {
            let extenderHandler = extenders[key];
            if (typeof extenderHandler === 'function') {
                target = extenderHandler(target, requestedExtenders[key]) || target;
            } else {
                console.warn('Missing extender: ' + key);
            }
        }
    }
    return target;
}

const _throttle = (callback, timeout) => {
    let timeoutInstance;
    return () => {
        if (timeoutInstance) {
            return;
        }
        timeoutInstance = setTimeout(() => {
            timeoutInstance = undefined;
            callback();
        }, timeout);
    };
};

const _debounce = (callback, timeout) => {
    let timeoutInstance;
    return () => {
        clearTimeout(timeoutInstance);
        timeoutInstance = setTimeout(callback, timeout);
    };
};

extenders.rateLimit = (target, options) => {
    let timeout, 
        method, 
        limitFunction;

    if (typeof options === 'number') {
        timeout = options;
    } else {
        timeout = options.timeout;
        method = options.method;
    }

    // rateLimit supersedes deferred updates
    target._deferUpdates = false;

    limitFunction = (typeof method === 'function') ? method : (method === 'notifyWhenChangesStop') ? _debounce : _throttle;
    target.limit(callback => limitFunction(callback, timeout, options));
};

const ORIGINAL_EQUALITY_COMPARER = Symbol();

extenders.notify = (target, notifyWhen) => {
    let currentEqualityComparer = target.equalityComparer;
    if (notifyWhen === 'always') {
        if (currentEqualityComparer) {
            target[ORIGINAL_EQUALITY_COMPARER] = currentEqualityComparer;
            target.equalityComparer = null; // null equalityComparer means to always notify
        }
    } else if (!currentEqualityComparer) {
        target.equalityComparer = target[ORIGINAL_EQUALITY_COMPARER]; 
    }
};

export const defineThrottleExtender = (dependentObservable) => {
    extenders.throttle = (target, timeout) => {
        // Throttling means two things:

        // (1) For dependent observables, we throttle *evaluations* so that, no matter how fast its dependencies
        //     notify updates, the target doesn't re-evaluate (and hence doesn't notify) faster than a certain rate
        target.throttleEvaluation = timeout;

        // (2) For writable targets (observables, or writable dependent observables), we throttle *writes*
        //     so the target cannot change value synchronously or faster than a certain rate
        let writeTimeoutInstance = null;
        return dependentObservable({
            read: target,
            write(value) {
                clearTimeout(writeTimeoutInstance);
                writeTimeoutInstance = setTimeout(() => target(value), timeout);
            }
        });
    };
};
