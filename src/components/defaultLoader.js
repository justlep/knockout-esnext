import {_getFirstResultFromLoaders, clearCachedDefinition} from './loaderRegistry';
import {parseHtmlFragment} from '../utils.domManipulation';
import {cloneNodes} from '../utils';
import {loaders} from './loaderRegistry';

const CREATE_VIEW_MODEL_KEY = 'createViewModel';

// The default loader is responsible for two things:
// 1. Maintaining the default in-memory registry of component configuration objects
//    (i.e., the thing you're writing to when you call ko.components.register(someName, ...))
// 2. Answering requests for components by fetching configuration objects
//    from that default in-memory registry and resolving them into standard
//    component definition objects (of the form { createViewModel: ..., template: ... })
// Custom loaders may override either of these facilities, i.e.,
// 1. To supply configuration objects from some other source (e.g., conventions)
// 2. Or, to resolve configuration objects by loading viewmodels/templates via arbitrary logic.
const defaultConfigRegistry = new Map();

export const registerComponent = (componentName, config) => {
    if (!config) {
        throw new Error('Invalid configuration for ' + componentName);
    }
    if (defaultConfigRegistry.has(componentName)) {
        throw new Error('Component ' + componentName + ' is already registered');
    }
    defaultConfigRegistry.set(componentName, config);
};

/**
 * @type {function(string):boolean}
 */
export const isComponentRegistered = defaultConfigRegistry.has.bind(defaultConfigRegistry);

export const unregisterComponent = (componentName) => {
    defaultConfigRegistry.delete(componentName);
    clearCachedDefinition(componentName);
};

export const defaultLoader = {
    getConfig(componentName, callback) {
        let result = defaultConfigRegistry.get(componentName) || null;
        callback(result);
    },
    
    loadComponent(componentName, config, callback) {
        let errorCallback = _makeErrorCallback(componentName);
        _possiblyGetConfigFromAmd(errorCallback, config, loadedConfig => _resolveConfig(componentName, errorCallback, loadedConfig, callback));
    },
    
    loadTemplate(componentName, templateConfig, callback) {
        _resolveTemplate(_makeErrorCallback(componentName), templateConfig, callback);
    },
    
    loadViewModel(componentName, viewModelConfig, callback) {
        _resolveViewModel(_makeErrorCallback(componentName), viewModelConfig, callback);
    }
};

// Takes a config object of the form { template: ..., viewModel: ... }, and asynchronously convert it
// into the standard component definition format:
//    { template: <ArrayOfDomNodes>, createViewModel: function(params, componentInfo) { ... } }.
// Since both template and viewModel may need to be resolved asynchronously, both tasks are performed
// in parallel, and the results joined when both are ready. We don't depend on any promises infrastructure,
// so this is implemented manually below.
const _resolveConfig = (componentName, errorCallback, config, callback) => {
    let result = {},
        makeCallBackWhenZero = 2,
        tryIssueCallback = () => (--makeCallBackWhenZero === 0) && callback(result),
        templateConfig = config['template'],
        viewModelConfig = config['viewModel'];

    if (templateConfig) {
        _possiblyGetConfigFromAmd(errorCallback, templateConfig, loadedConfig => {
            _getFirstResultFromLoaders('loadTemplate', [componentName, loadedConfig], resolvedTemplate => {
                result['template'] = resolvedTemplate;
                tryIssueCallback();
            });
        });
    } else {
        tryIssueCallback();
    }

    if (viewModelConfig) {
        _possiblyGetConfigFromAmd(errorCallback, viewModelConfig, loadedConfig => {
            _getFirstResultFromLoaders('loadViewModel', [componentName, loadedConfig], resolvedViewModel => {
                result[CREATE_VIEW_MODEL_KEY] = resolvedViewModel;
                tryIssueCallback();
            });
        });
    } else {
        tryIssueCallback();
    }
};

/**
 * @param {KnockoutTemplateLoaderErrorCallback} errorCallback
 */
const _resolveTemplate = (errorCallback, templateConfig, callback) => {
    if (typeof templateConfig === 'string') {
        // Markup - parse it
        return callback(parseHtmlFragment(templateConfig));
    } 
    if (templateConfig.element) {
        let elementIdOrNode = templateConfig.element,
            elem;
        
        if (typeof elementIdOrNode === 'string') {
            elem = document.getElementById(elementIdOrNode) || errorCallback('Cannot find element with ID ' + elementIdOrNode);
        } else if (elementIdOrNode && elementIdOrNode.tagName && elementIdOrNode.nodeType === 1) { // cheaper than `instanceof HTMLElement`
            elem = elementIdOrNode;
        } else {
            errorCallback('Unknown element type: ' + elementIdOrNode);
        }
        // Element instance found - copy its child nodes...
        let tagName = elem.tagName;
        return callback(
            tagName === 'SCRIPT' ? parseHtmlFragment(elem.text) :
            tagName === 'TEMPLATE' ? cloneNodes(elem.content.childNodes) :
            tagName === 'TEXTAREA' ? parseHtmlFragment(elem.value) :
            /* Regular elements such as <div> */ cloneNodes(elem.childNodes)
        );
    }  
    if (Array.isArray(templateConfig)) {
        // Assume already an array of DOM nodes - pass through unchanged
        return callback(templateConfig);
    }
    if (_isDocumentFragment(templateConfig)) {
        // Document fragment - use its child nodes
        return callback([...templateConfig.childNodes]);
    } 
    errorCallback('Unknown template value: ' + templateConfig);
};

const _resolveViewModel = (errorCallback, viewModelConfig, callback) => {
    if (typeof viewModelConfig === 'function') {
        // Constructor - convert to standard factory function format
        // By design, this does *not* supply componentInfo to the constructor, as the intent is that
        // componentInfo contains non-viewmodel data (e.g., the component's element) that should only
        // be used in factory functions, not viewmodel constructors.
        return callback((params /*, componentInfo */) => new viewModelConfig(params));
    } 
    let factoryFn = viewModelConfig[CREATE_VIEW_MODEL_KEY];
    if (typeof factoryFn === 'function') {
        // Already a factory function - use it as-is
        return callback(factoryFn);
    } 
    let fixedInstance = viewModelConfig.instance;
    if (fixedInstance !== undefined) {
        // Fixed object instance - promote to createViewModel format for API consistency
        return callback((params, componentInfo) => fixedInstance);
    } 
    let viewModel = viewModelConfig.viewModel;
    if (viewModel !== undefined) {
        // Resolved AMD module whose value is of the form { viewModel: ... }
        return _resolveViewModel(errorCallback, viewModel, callback);
    } 
    errorCallback('Unknown viewModel value: ' + viewModelConfig);
};

const _isDocumentFragment = obj => obj && obj.nodeType === 11; //@inline

const _possiblyGetConfigFromAmd = (errorCallback, config, callback) => {
    if (typeof config.require !== 'string') {
        callback(config);
        return;
    }
    // The config is the value of an AMD module
    let requireFn = typeof amdRequire === 'function' ? amdRequire : window.require; // eslint-disable-line no-undef
    if (requireFn) {
        requireFn([config.require], module => {
            if (module && (typeof module === 'object') && module.__esModule && module.default) {
                module = module.default;
            }
            callback(module);
        });
    } else {
        errorCallback('Uses require, but no AMD loader is present');
    }
};

/**
 * @callback KnockoutTemplateLoaderErrorCallback
 * @throws {Error}
 */

/**
 * @param {string} componentName
 * @return {KnockoutTemplateLoaderErrorCallback}
 */
const _makeErrorCallback = (componentName) => message => {
    throw new Error('Component \'' + componentName + '\': ' + message);
};

// By default, the default loader is the only registered component loader
loaders.push(defaultLoader);
