import {scheduleTask} from '../tasks';
import {ignoreDependencyDetectionNoArgs} from '../subscribables/dependencyDetection';
import {Subscribable} from '../subscribables/subscribable';

const _loadingSubscribablesCache = new Map(); // Tracks component loads that are currently in flight
const _loadedDefinitionsCache = new Map();    // Tracks component loads that have already completed

export let loaders = [];

export const _setComponentLoaders = (newLoaders) => loaders = newLoaders;

export const getComponent = (componentName, callback) => {
    let cachedDefinition = _loadedDefinitionsCache.get(componentName);
    if (cachedDefinition) {
        // It's already loaded and cached. Reuse the same definition object.
        // Note that for API consistency, even cache hits complete asynchronously by default.
        // You can bypass this by putting synchronous:true on your component config.
        if (cachedDefinition.isSynchronousComponent) {
            // See comment in loaderRegistryBehaviors.js for reasoning
            ignoreDependencyDetectionNoArgs(() => callback(cachedDefinition.definition));
        } else {
            scheduleTask(() => callback(cachedDefinition.definition));
        }
    } else {
        // Join the loading process that is already underway, or start a new one.
        let loadingSubscribable = _loadingSubscribablesCache.get(componentName);
        if (loadingSubscribable) {
            loadingSubscribable.subscribe(callback);
        } else {
            _loadNotYetLoadingComponentAndNotify(componentName, callback);
        }
    }
};

export const clearCachedDefinition = (componentName) => {
    _loadedDefinitionsCache.delete(componentName);
};

/**
 * Start loading a component that is not yet loading, and when it's done, move it to loadedDefinitionsCache.
 * @param {string} componentName
 * @param {function} callback
 * @private
 */
const _loadNotYetLoadingComponentAndNotify = (componentName, callback) => {
    // if (_loadingSubscribablesCache.has(componentName)) {
    //     throw new Error('Component "' + componentName + '" is already loading');
    // }
    let _subscribable = new Subscribable(),
        completedAsync;
    
    _loadingSubscribablesCache.set(componentName, _subscribable);
    _subscribable.subscribe(callback);

    _beginLoadingComponent(componentName, (definition, config) => {
        let isSynchronousComponent = !!(config && config.synchronous);
        _loadedDefinitionsCache.set(componentName, {definition, isSynchronousComponent});
        _loadingSubscribablesCache.delete(componentName);

        // For API consistency, all loads complete asynchronously. However we want to avoid
        // adding an extra task schedule if it's unnecessary (i.e., the completion is already
        // async).
        //
        // You can bypass the 'always asynchronous' feature by putting the synchronous:true
        // flag on your component configuration when you register it.
        if (completedAsync || isSynchronousComponent) {
            // Note that notifySubscribers ignores any dependencies read within the callback.
            // See comment in loaderRegistryBehaviors.js for reasoning
            _subscribable.notifySubscribers(definition);
        } else {
            scheduleTask(() => _subscribable.notifySubscribers(definition));
        }
    });
    completedAsync = true;
};

const _beginLoadingComponent = (componentName, callback) => {
    _getFirstResultFromLoaders('getConfig', [componentName], config => {
        if (config) {
            // We have a config, so now load its definition
            _getFirstResultFromLoaders('loadComponent', [componentName, config], definition => void callback(definition, config));
        } else {
            // The component has no config - it's unknown to all the loaders.
            // Note that this is not an error (e.g., a module loading error) - that would abort the
            // process and this callback would not run. For this callback to run, all loaders must
            // have confirmed they don't know about this component.
            callback(null, null);
        }
    });
};

export const _getFirstResultFromLoaders = (methodName, argsExceptCallback, callback, candidateLoaders) => {
    // On the first call in the stack, start with the full set of loaders
    if (!candidateLoaders) {
        candidateLoaders = loaders.slice(); // Use a copy, because we'll be mutating this array
    }

    // Try the next candidate
    let currentCandidateLoader = candidateLoaders.shift();
    if (!currentCandidateLoader) {
        // No candidates returned a value
        return callback(null);
    }
    
    if (!currentCandidateLoader[methodName]) {
        // This candidate doesn't have the relevant handler. Synchronously move on to the next one.
        return _getFirstResultFromLoaders(methodName, argsExceptCallback, callback, candidateLoaders);
    }
    let wasAborted = false,
        synchronousReturnValue = currentCandidateLoader[methodName](...argsExceptCallback, result => {
            if (wasAborted) {
                callback(null);
            } else if (result !== null) {
                // This candidate returned a value. Use it.
                callback(result);
            } else {
                // Try the next candidate
                _getFirstResultFromLoaders(methodName, argsExceptCallback, callback, candidateLoaders);
            }
        });

    // Currently, loaders may not return anything synchronously. This leaves open the possibility
    // that we'll extend the API to support synchronous return values in the future. It won't be
    // a breaking change, because currently no loader is allowed to return anything except undefined.
    if (synchronousReturnValue !== undefined) {
        wasAborted = true;

        // Method to suppress exceptions will remain undocumented. This is only to keep
        // KO's specs running tidily, since we can observe the loading got aborted without
        // having exceptions cluttering up the console too.
        if (!currentCandidateLoader['suppressLoaderExceptions']) {
            throw new Error('Component loaders must supply values by invoking the callback, not by returning values synchronously.');
        }
    }
};
