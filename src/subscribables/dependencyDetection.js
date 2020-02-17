import {isSubscribable} from './observableUtils';

const outerFrames = [];
let currentFrame,
    lastId = 0;

export const beginDependencyDetection = options => {
    outerFrames.push(currentFrame);
    currentFrame = options;
};

export const endDependencyDetection = () => currentFrame = outerFrames.pop();

export const ignoreDependencyDetection = (callback, callbackTarget, callbackArgs) => {
    try {
        beginDependencyDetection();
        // there's a high percentage of calls without callbackTarget and/or callbackArgs, 
        // so let's speed up things by not using `apply` or args in those cases
        return callbackTarget ? callback.apply(callbackTarget, callbackArgs || []) :
            callbackArgs ? callback(...callbackArgs) : callback();
    } finally {
        endDependencyDetection();
    }
};

// Return a unique ID that can be assigned to an observable for dependency tracking.
// Theoretically, you could eventually overflow the number storage size, resulting
// in duplicate IDs. But in JavaScript, the largest exact integral value is 2^53
// or 9,007,199,254,740,992. If you created 1,000,000 IDs per second, it would
// take over 285 years to reach that number.
// Reference http://blog.vjeux.com/2010/javascript/javascript-max_int-number-limits.html
const _getId = () => ++lastId;

export const registerDependency = (subscribable) => {
    if (currentFrame) {
        if (!isSubscribable(subscribable)) {
            throw new Error('Only subscribable things can act as dependencies');
        }
        currentFrame.callback.call(currentFrame.callbackTarget, subscribable, subscribable._id || (subscribable._id = _getId()));
    }
};

export const getDependenciesCount = () => currentFrame ? currentFrame.computed.getDependenciesCount() : undefined;
export const getDependencies = () => currentFrame ? currentFrame.computed.getDependencies() : undefined;
export const isInitialDependency = () => currentFrame ? currentFrame.isInitial : undefined;
export const getCurrentComputed = () => currentFrame ? currentFrame.computed : undefined;
