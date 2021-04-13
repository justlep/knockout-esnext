import {isSubscribable} from './observableUtils';

const outerFrames = [];
let currentFrame,
    lastId = 0;

export const beginDependencyDetection = options => {
    outerFrames.push(currentFrame);
    currentFrame = options;
};

const _beginDependencyDetectionWithEmptyFrame = () => currentFrame = void outerFrames.push(currentFrame); //@inline

export const endDependencyDetection = () => currentFrame = outerFrames.pop(); //@inline

/**
 * For ko-internal usages without callbackTarget and callbackArgs use {@link ignoreDependencyDetectionNoArgs}.
 * @param {function} callback
 * @param {?Object} [callbackTarget]
 * @param {any[]} [callbackArgs]
 * @return {*} the callback's return value
 */
export const ignoreDependencyDetection = (callback, callbackTarget, callbackArgs) => {
    try {
        _beginDependencyDetectionWithEmptyFrame();
        
        // there's a high percentage of calls without callbackTarget and/or callbackArgs, 
        // so let's speed up things by not using `apply` or args in those cases.
        return callbackTarget ? callback.apply(callbackTarget, callbackArgs || []) :
               callbackArgs ? callback(...callbackArgs) : callback();
    } finally {
        endDependencyDetection();
    }
};

/**
 * Slim version of {@link ignoreDependencyDetection} intended for pure, no-args callbacks. 
 * @param {function} callback
 * @return {*}
 * @internal
 */
export const ignoreDependencyDetectionNoArgs = (callback) => {
    try {
        _beginDependencyDetectionWithEmptyFrame();
        return callback();
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
const _getId = () => ++lastId; //@inline

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
