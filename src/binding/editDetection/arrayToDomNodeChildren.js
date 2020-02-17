import {nextDomDataKey, getDomData, setDomData} from '../../utils.domData';
import {observable} from '../../subscribables/observable';
import {compareArrays} from './compareArrays';
import {arrayForEach, anyDomNodeIsAttachedToDocument, fixUpContinuousNodeArray, replaceDomNodes} from '../../utils';
import {dependentObservable} from '../../subscribables/dependentObservable';
import {ignoreDependencyDetection} from '../../subscribables/dependencyDetection';
import {insertAfter} from '../../virtualElements';
import {cleanNode, removeNode} from '../../utils.domNodeDisposal';

const LAST_MAPPING_RESULT_DOM_DATA_KEY = nextDomDataKey();
const DELETED_ITEM_DUMMY_VALUE = nextDomDataKey();

// Objective:
// * Given an input array, a container DOM node, and a function from array elements to arrays of DOM nodes,
//   map the array elements to arrays of DOM nodes, concatenate together all these arrays, and use them to populate the container DOM node
// * Next time we're given the same combination of things (with the array possibly having mutated), update the container DOM node
//   so that its children is again the concatenation of the mappings of the array elements, but don't re-map any array elements that we
//   previously mapped - retain those nodes, and just insert/delete other ones

// "callbackAfterAddingNodes" will be invoked after any "mapping"-generated nodes are inserted into the container node
// You can use this, for example, to activate bindings on those nodes.

const _mapNodeAndRefreshWhenChanged = (containerNode, mapping, valueToMap, callbackAfterAddingNodes, index) => {
    // Map this array value inside a dependentObservable so we re-map when any dependency changes
    let mappedNodes = [];
    let _dependentObservable = dependentObservable(() => {
            let newMappedNodes = mapping(valueToMap, index, fixUpContinuousNodeArray(mappedNodes, containerNode)) || [];

            // On subsequent evaluations, just replace the previously-inserted DOM nodes
            if (mappedNodes.length) {
                replaceDomNodes(mappedNodes, newMappedNodes);
                if (callbackAfterAddingNodes) {
                    ignoreDependencyDetection(callbackAfterAddingNodes, null, [valueToMap, newMappedNodes, index]);
                }
            }

            // Replace the contents of the mappedNodes array, thereby updating the record
            // of which nodes would be deleted if valueToMap was itself later removed
            mappedNodes.length = 0;
            
            for (let i = 0, len = newMappedNodes.length; i < len; i++) {
                mappedNodes[i] = newMappedNodes[i];
            }
            
        }, null, {
            disposeWhenNodeIsRemoved: containerNode, 
            disposeWhen: () => !anyDomNodeIsAttachedToDocument(mappedNodes)
        });
    
    return {
        mappedNodes,
        dependentObservable: _dependentObservable.isActive() ? _dependentObservable : undefined
    };
};

export const setDomNodeChildrenFromArrayMapping = (domNode, array, mapping, options, callbackAfterAddingNodes, editScript) => {
    array = array || [];
    if (typeof array.length === 'undefined') { 
        array = [array]; // Coerce single value into array
    }

    options = options || {};
    let lastMappingResult = getDomData(domNode, LAST_MAPPING_RESULT_DOM_DATA_KEY);
    let isFirstExecution = !lastMappingResult;

    // Build the new mapping result
    let newMappingResult = [];
    let lastMappingResultIndex = 0;
    let currentArrayIndex = 0;

    let nodesToDelete = [];
    let itemsToMoveFirstIndexes = [];
    let itemsForBeforeRemoveCallbacks = [];
    let itemsForMoveCallbacks = [];
    let itemsForAfterAddCallbacks = [];
    let mapData;
    let countWaitingForRemove = 0;

    const _itemAdded = (value) => {
        mapData = {arrayEntry: value, indexObservable: observable(currentArrayIndex++)};
        newMappingResult.push(mapData);
        if (!isFirstExecution) {
            itemsForAfterAddCallbacks.push(mapData);
        }
    };

    const _itemMovedOrRetained = (oldPosition) => {
        mapData = lastMappingResult[oldPosition];
        let _indexObservable = mapData.indexObservable;
        if (currentArrayIndex !== _indexObservable.peek()) {
            itemsForMoveCallbacks.push(mapData);
        }
        // Since updating the index might change the nodes, do so before calling fixUpContinuousNodeArray
        _indexObservable(currentArrayIndex++);
        fixUpContinuousNodeArray(mapData.mappedNodes, domNode);
        newMappingResult.push(mapData);
    };

    const _callCallback = (callback, items) => {
        for (let i = 0, len = items.length; i < len; i++) {
            let item = items[i];
            for (let node of item.mappedNodes) {
                callback(node, i, item.arrayEntry);
            }
        }
    };

    if (isFirstExecution) {
        array.length && arrayForEach(array, _itemAdded);
    } else {
        if (!editScript || (lastMappingResult && lastMappingResult['_countWaitingForRemove'])) {
            // Compare the provided array against the previous one
            let lastArray = lastMappingResult.map(x => x.arrayEntry),
                compareOptions = {
                    'dontLimitMoves': options['dontLimitMoves'],
                    'sparse': true
                };
            editScript = compareArrays(lastArray, array, compareOptions);
        }

        for (let i = 0, editScriptItem, movedIndex, itemIndex; editScriptItem = editScript[i]; i++) {
            movedIndex = editScriptItem['moved'];
            itemIndex = editScriptItem['index'];
            switch (editScriptItem['status']) {
                case "deleted":
                    while (lastMappingResultIndex < itemIndex) {
                        _itemMovedOrRetained(lastMappingResultIndex++);
                    }
                    if (movedIndex === undefined) {
                        mapData = lastMappingResult[lastMappingResultIndex];

                        // Stop tracking changes to the mapping for these nodes
                        if (mapData.dependentObservable) {
                            mapData.dependentObservable.dispose();
                            mapData.dependentObservable = undefined;
                        }

                        // Queue these nodes for later removal
                        if (fixUpContinuousNodeArray(mapData.mappedNodes, domNode).length) {
                            if (options['beforeRemove']) {
                                newMappingResult.push(mapData);
                                countWaitingForRemove++;
                                if (mapData.arrayEntry === DELETED_ITEM_DUMMY_VALUE) {
                                    mapData = null;
                                } else {
                                    itemsForBeforeRemoveCallbacks.push(mapData);
                                }
                            }
                            if (mapData) {
                                nodesToDelete.push.apply(nodesToDelete, mapData.mappedNodes);
                            }
                        }
                    }
                    lastMappingResultIndex++;
                    break;

                case "added":
                    while (currentArrayIndex < itemIndex) {
                        _itemMovedOrRetained(lastMappingResultIndex++);
                    }
                    if (movedIndex !== undefined) {
                        itemsToMoveFirstIndexes.push(newMappingResult.length);
                        _itemMovedOrRetained(movedIndex);
                    } else {
                        _itemAdded(editScriptItem['value']);
                    }
                    break;
            }
        }

        while (currentArrayIndex < array.length) {
            _itemMovedOrRetained(lastMappingResultIndex++);
        }

        // Record that the current view may still contain deleted items
        // because it means we won't be able to use a provided editScript.
        newMappingResult['_countWaitingForRemove'] = countWaitingForRemove;
    }

    // Store a copy of the array items we just considered so we can difference it next time
    setDomData(domNode, LAST_MAPPING_RESULT_DOM_DATA_KEY, newMappingResult);

    // Call beforeMove first before any changes have been made to the DOM
    options.beforeMove && _callCallback(options.beforeMove, itemsForMoveCallbacks);

    // Next remove nodes for deleted items (or just clean if there's a beforeRemove callback)
    nodesToDelete.forEach(options.beforeRemove ? cleanNode : removeNode);

    let lastNode, 
        nodeToInsert, 
        mappedNodes;

    // Since most browsers remove the focus from an element when it's moved to another location,
    // save the focused element and try to restore it later.
    let activeElement = domNode.ownerDocument.activeElement;

    // Try to reduce overall moved nodes by first moving the ones that were marked as moved by the edit script
    if (itemsToMoveFirstIndexes.length) {
        let i;
        while ((i = itemsToMoveFirstIndexes.shift()) !== undefined) {
            mapData = newMappingResult[i];
            for (lastNode = undefined; i;) {
                if ((mappedNodes = newMappingResult[--i].mappedNodes) && mappedNodes.length) {
                    lastNode = mappedNodes[mappedNodes.length - 1];
                    break;
                }
            }
            for (let j = 0; nodeToInsert = mapData.mappedNodes[j]; lastNode = nodeToInsert, j++) {
                insertAfter(domNode, nodeToInsert, lastNode);
            }
        }
    }

    // Next add/reorder the remaining items (will include deleted items if there's a beforeRemove callback)
    for (let i = 0; mapData = newMappingResult[i]; i++) {
        // Get nodes for newly added items
        if (!mapData.mappedNodes) {
            Object.assign(mapData, _mapNodeAndRefreshWhenChanged(domNode, mapping, mapData.arrayEntry, callbackAfterAddingNodes, mapData.indexObservable));
        }

        // Put nodes in the right place if they aren't there already
        for (let j = 0; nodeToInsert = mapData.mappedNodes[j]; lastNode = nodeToInsert, j++) {
            insertAfter(domNode, nodeToInsert, lastNode);
        }

        // Run the callbacks for newly added nodes (for example, to apply bindings, etc.)
        if (!mapData.initialized && callbackAfterAddingNodes) {
            callbackAfterAddingNodes(mapData.arrayEntry, mapData.mappedNodes, mapData.indexObservable);
            mapData.initialized = true;
            lastNode = mapData.mappedNodes[mapData.mappedNodes.length - 1];     // get the last node again since it may have been changed by a preprocessor
        }
    }

    // Restore the focused element if it had lost focus
    if (activeElement && domNode.ownerDocument.activeElement !== activeElement) {
        activeElement.focus();
    }

    // If there's a beforeRemove callback, call it after reordering.
    // Note that we assume that the beforeRemove callback will usually be used to remove the nodes using
    // some sort of animation, which is why we first reorder the nodes that will be removed. If the
    // callback instead removes the nodes right away, it would be more efficient to skip reordering them.
    // Perhaps we'll make that change in the future if this scenario becomes more common.
    options.beforeRemove && _callCallback(options.beforeRemove, itemsForBeforeRemoveCallbacks);

    // Replace the stored values of deleted items with a dummy value. This provides two benefits: it marks this item
    // as already "removed" so we won't call beforeRemove for it again, and it ensures that the item won't match up
    // with an actual item in the array and appear as "retained" or "moved".
    for (let i = 0, len = itemsForBeforeRemoveCallbacks.length; i < len; ++i) {
        itemsForBeforeRemoveCallbacks[i].arrayEntry = DELETED_ITEM_DUMMY_VALUE;
    }

    // Finally call afterMove and afterAdd callbacks
    options.afterMove && _callCallback(options.afterMove, itemsForMoveCallbacks);
    options.afterAdd &&  _callCallback(options.afterAdd, itemsForAfterAddCallbacks);
};
