import {compareArrays, findMovesInArrayComparison} from '../binding/editDetection/compareArrays';
import {extenders} from './extenders';
import {hasSubscriptionsForEvent} from './subscribable.js';

const ARRAY_CHANGE_EVENT_NAME = 'arrayChange';

export const trackArrayChanges = extenders.trackArrayChanges = (target, options) => {
    // Use the provided options--each call to trackArrayChanges overwrites the previously set options
    target.compareArrayOptions = {};
    if (options && typeof options === "object") {
        Object.assign(target.compareArrayOptions, options);
    }
    target.compareArrayOptions.sparse = true;

    // Only modify the target observable once
    if (target.cacheDiffForKnownOperation) {
        return;
    }
    let trackingChanges = false,
        cachedDiff = null,
        changeSubscription,
        spectateSubscription,
        pendingChanges = 0,
        previousContents,
        underlyingBeforeSubscriptionAddFunction = target.beforeSubscriptionAdd,
        underlyingAfterSubscriptionRemoveFunction = target.afterSubscriptionRemove;

    // Watch "subscribe" calls, and for array change events, ensure change tracking is enabled
    target.beforeSubscriptionAdd = (event) => {
        if (underlyingBeforeSubscriptionAddFunction) {
            underlyingBeforeSubscriptionAddFunction.call(target, event);
        }
        if (event === ARRAY_CHANGE_EVENT_NAME) {
            _trackChanges();
        }
    };
    // Watch "dispose" calls, and for array change events, ensure change tracking is disabled when all are disposed
    target.afterSubscriptionRemove = (event) => {
        if (underlyingAfterSubscriptionRemoveFunction) {
            underlyingAfterSubscriptionRemoveFunction.call(target, event);
        }
        if (event === ARRAY_CHANGE_EVENT_NAME && !hasSubscriptionsForEvent(target, ARRAY_CHANGE_EVENT_NAME)) {
            if (changeSubscription) {
                changeSubscription.dispose();
            }
            if (spectateSubscription) {
                spectateSubscription.dispose();
            }
            spectateSubscription = changeSubscription = null;
            trackingChanges = false;
            previousContents = undefined;
        }
    };

    const _trackChanges = () => {
        if (trackingChanges) {
            // Whenever there's a new subscription and there are pending notifications, make sure all previous
            // subscriptions are notified of the change so that all subscriptions are in sync.
            notifyChanges();
            return;
        }

        trackingChanges = true;

        // Track how many times the array actually changed value
        spectateSubscription = target.subscribe(() => ++pendingChanges, null, "spectate");

        // Each time the array changes value, capture a clone so that on the next
        // change it's possible to produce a diff
        previousContents = [].concat(target.peek() || []);
        cachedDiff = null;
        changeSubscription = target.subscribe(notifyChanges);

        function notifyChanges() {
            if (!pendingChanges) {
                return;
            }
            // Make a copy of the current contents and ensure it's an array
            let currentContents = [].concat(target.peek() || []), changes;

                // Compute the diff and issue notifications, but only if someone is listening
            if (hasSubscriptionsForEvent(target, ARRAY_CHANGE_EVENT_NAME)) {
                changes = _getChanges(previousContents, currentContents);
            }

            // Eliminate references to the old, removed items, so they can be GCed
            previousContents = currentContents;
            cachedDiff = null;
            pendingChanges = 0;

            if (changes && changes.length) {
                target.notifySubscribers(changes, ARRAY_CHANGE_EVENT_NAME);
            }
        }
    };

    const _getChanges = (previousContents, currentContents) => {
        // We try to re-use cached diffs.
        // The scenarios where pendingChanges > 1 are when using rate limiting or deferred updates,
        // which without this check would not be compatible with arrayChange notifications. Normally,
        // notifications are issued immediately so we wouldn't be queueing up more than one.
        if (!cachedDiff || pendingChanges > 1) {
            cachedDiff = compareArrays(previousContents, currentContents, target.compareArrayOptions);
        }

        return cachedDiff;
    };

    target.cacheDiffForKnownOperation = function(rawArray, operationName, args) {
        // Only run if we're currently tracking changes for this observable array
        // and there aren't any pending deferred notifications.
        if (!trackingChanges || pendingChanges) {
            return;
        }
        let diff = [],
            arrayLength = rawArray.length,
            argsLength = args.length,
            offset = 0,
            _nextPushDiffIndex = 0,
            _pushDiff = (status, value, index) => diff[_nextPushDiffIndex++] = {status, value, index};

        switch (operationName) {
            case 'push':
                offset = arrayLength; 
                // eslint-disable-line no-fallthrough
            case 'unshift':
                for (let index = 0; index < argsLength; index++) {
                    _pushDiff('added', args[index], offset + index);
                }
                break;

            case 'pop':
                offset = arrayLength - 1; 
                // eslint-disable-line no-fallthrough
            case 'shift':
                if (arrayLength) {
                    _pushDiff('deleted', rawArray[offset], offset);
                }
                break;

            case 'splice': {
                // Negative start index means 'from end of array'. After that we clamp to [0...arrayLength].
                // See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/splice
                let startIndex = Math.min(Math.max(0, args[0] < 0 ? arrayLength + args[0] : args[0]), arrayLength),
                    endDeleteIndex = argsLength === 1 ? arrayLength : Math.min(startIndex + (args[1] || 0), arrayLength),
                    endAddIndex = startIndex + argsLength - 2,
                    endIndex = endDeleteIndex > endAddIndex ? endDeleteIndex : endAddIndex,
                    additions = [],
                    nextAdditionIndex = 0,
                    deletions = [],
                    nextDeletionIndex = 0;

                for (let index = startIndex, argsIndex = 2; index < endIndex; ++index, ++argsIndex) {
                    if (index < endDeleteIndex) {
                        deletions[nextDeletionIndex++] = _pushDiff('deleted', rawArray[index], index);
                    }
                    if (index < endAddIndex) {
                        additions[nextAdditionIndex++] = _pushDiff('added', args[argsIndex], index);
                    }
                }
                findMovesInArrayComparison(deletions, additions);
                break;
            }
            default:
                return;
        }
        cachedDiff = diff;
    };
};
