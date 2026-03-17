import {scheduleTask} from '../tasks';
import {ignoreDependencyDetectionNoArgs} from '../subscribables/dependencyDetection';
import {Subscribable} from '../subscribables/subscribable';
import {defaultLoader} from './defaultLoader.js';

const _loadingSubscribablesCache = new Map(); // Tracks component loads that are currently in flight
const _loadedDefinitionsCache = new Map();    // Tracks component loads that have already completed

export const getComponent = (componentName, callback) => {
    componentName = componentName.toUpperCase();
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
    _loadedDefinitionsCache.delete(componentName.toUpperCase());
};

/**
 * Start loading a component that is not yet loading, and when it's done, move it to loadedDefinitionsCache.
 * @param {string} componentNameUpper - uppercase component name
 * @param {function} callback
 * @private
 */
const _loadNotYetLoadingComponentAndNotify = (componentNameUpper, callback) => {
    // if (_loadingSubscribablesCache.has(componentName)) {
    //     throw new Error('Component "' + componentName + '" is already loading');
    // }
    let _subscribable = new Subscribable(),
        completedAsync;
    
    _loadingSubscribablesCache.set(componentNameUpper, _subscribable);
    _subscribable.subscribe(callback);

    _beginLoadingComponent(componentNameUpper, (definition, config) => {
        let isSynchronousComponent = !!(config && config.synchronous);
        _loadedDefinitionsCache.set(componentNameUpper, {definition, isSynchronousComponent});
        _loadingSubscribablesCache.delete(componentNameUpper);

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

const _beginLoadingComponent = (componentNameUpper, callback) => {
    defaultLoader.getConfig(componentNameUpper, config => {
        if (config) {
            // We have a config, so now load its definition
            defaultLoader.loadComponent(componentNameUpper, config, definition => callback(definition, config));
        } else {
            // The component has no config - it's unknown to all the loaders.
            // Note that this is not an error (e.g., a module loading error) - that would abort the
            // process and this callback would not run. For this callback to run, all loaders must
            // have confirmed they don't know about this component.
            callback(null, null);
        }
    });
};
