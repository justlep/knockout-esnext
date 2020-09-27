import {deferError} from './utils';

const _taskQueue = [];

let _taskQueueLength = 0,
    _nextHandle = 1,
    _nextIndexToProcess = 0;

export let _scheduler;

// allows for overriding the default scheduler by assigning 'ko.tasks.scheduler = someCustomScheduler' (see ko.js)
export const _overrideScheduler = newScheduler => {
    if (typeof newScheduler !== 'function') {
        throw new Error('Scheduler must be a function');    
    }
    _scheduler = newScheduler;
};

const _processTasks = () => {
    if (!_taskQueueLength) {
        return;
    }
    // Each mark represents the end of a logical group of tasks and the number of these groups is
    // limited to prevent unchecked recursion.
    let mark = _taskQueueLength, countMarks = 0;

    // _nextIndexToProcess keeps track of where we are in the queue; processTasks can be called recursively without issue
    for (let task; _nextIndexToProcess < _taskQueueLength;) {
        if (!(task = _taskQueue[_nextIndexToProcess++])) {
            continue;
        }
        if (_nextIndexToProcess > mark) {
            if (++countMarks >= 5000) {
                _nextIndexToProcess = _taskQueueLength;   // skip all tasks remaining in the queue since any of them could be causing the recursion
                deferError(Error("'Too much recursion' after processing " + countMarks + " task groups."));
                break;
            }
            mark = _taskQueueLength;
        }
        try {
            task();
        } catch (ex) {
            deferError(ex);
        }
    }
};

const _scheduledProcess = () => {
    _processTasks();
    // Reset the queue
    _nextIndexToProcess = 0;
    _taskQueueLength = 0;
    _taskQueue.length = 0;
};

if (typeof MutationObserver !== 'undefined') {
    // Chrome 27+, Firefox 14+, IE 11+, Opera 15+, Safari 6.1+
    // From https://github.com/petkaantonov/bluebird * Copyright (c) 2014 Petka Antonov * License: MIT
    _scheduler = (callback => {
        let elem = document.createElement('b'),
            val = 1;
        new MutationObserver(callback).observe(elem, {attributes: true});
        return () => elem.title = (val = -val); // original classList.toggle is 60% slower in Chrome 85
    })(_scheduledProcess);

} else if (typeof process === 'object') {
    // Running tests in NodeJS
    _scheduler = (callback) => setTimeout(callback, 0);
} else {
    throw new Error('Browser is too old, does not know MutationObserver');
}

export const scheduleTask = (func) => {
    if (!_taskQueueLength) {
        _scheduler(_scheduledProcess);
    }
    _taskQueue[_taskQueueLength++] = func;
    return _nextHandle++;
};

export const cancelTask = (handle) => {
    let index = handle - (_nextHandle - _taskQueueLength);
    if (index >= _nextIndexToProcess && index < _taskQueueLength) {
        _taskQueue[index] = null;
    }
};

// For testing only: reset the queue and return the previous queue length
export const resetForTesting = () => {
    let length = _taskQueueLength - _nextIndexToProcess;
    _nextIndexToProcess = _taskQueueLength = _taskQueue.length = 0;
    return length;
};

export const runEarly = _processTasks;
