import {isObservable} from './observableUtils';
import {unwrapObservable} from '../utils';

const MAX_NESTED_OBSERVABLE_DEPTH = 10; // Escape the (unlikely) pathological case where an observable's current value is itself (or similar reference cycle)

export const toJS = function (rootObject) {
    if (!arguments.length) {
        throw new Error("When calling ko.toJS, pass the object you want to convert.");
    }

    // We just unwrap everything at every level in the object graph
    return _mapJsObjectGraph(rootObject, valueToMap => {
        // Loop because an observable's value might in turn be another observable wrapper
        for (let i = 0; isObservable(valueToMap) && (i < MAX_NESTED_OBSERVABLE_DEPTH); i++) {
            valueToMap = valueToMap();
        }
        return valueToMap;
    });
};

// replacer and space are optional
export const toJSON = (rootObject, replacer, space) => {
    let plainJavaScriptObject = toJS(rootObject);
    return JSON.stringify(unwrapObservable(plainJavaScriptObject), replacer, space);
};

const _mapJsObjectGraph = (rootObject, mapInputCallback, visitedObjects) => {
    visitedObjects = visitedObjects || new Map();

    rootObject = mapInputCallback(rootObject);
    let canHaveProperties = (typeof rootObject === "object") && (rootObject !== null) && (rootObject !== undefined) &&
        (!(rootObject instanceof RegExp)) && (!(rootObject instanceof Date)) && (!(rootObject instanceof String)) &&
        (!(rootObject instanceof Number)) && (!(rootObject instanceof Boolean));
    if (!canHaveProperties) {
        return rootObject;
    }

    let outputProperties = Array.isArray(rootObject) ? [] : {};
    visitedObjects.set(rootObject, outputProperties);

    _visitPropertiesOrArrayEntries(rootObject, indexer => {
        let propertyValue = mapInputCallback(rootObject[indexer]);

        switch (typeof propertyValue) {
            case 'boolean':
            case 'number':
            case 'string':
            case 'function':
                outputProperties[indexer] = propertyValue;
                break;
            case 'object':
            case 'undefined': {
                let previouslyMappedValue = visitedObjects.get(propertyValue);
                outputProperties[indexer] = (previouslyMappedValue !== undefined)
                    ? previouslyMappedValue
                    : _mapJsObjectGraph(propertyValue, mapInputCallback, visitedObjects);
                break;
            }
        }
    });

    return outputProperties;
};

const _visitPropertiesOrArrayEntries = (rootObject, visitorCallback) => {
    if (rootObject instanceof Array) {
        for (let i = 0; i < rootObject.length; i++) {
            visitorCallback(i);
        }

        // For arrays, also respect toJSON property for custom mappings (fixes #278)
        if (typeof rootObject['toJSON'] === 'function') {
            visitorCallback('toJSON');
        }
    } else {
        for (let propertyName in rootObject) {
            visitorCallback(propertyName);
        }
    }
};
