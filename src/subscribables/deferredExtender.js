import {cancelTask, scheduleTask} from '../tasks';

export const deferredExtender = (target, options) => {
    if (options !== true) {
        throw new Error('The \'deferred\' extender only accepts the value \'true\', because it is not supported to turn deferral off once enabled.');
    }
    if (target._deferUpdates) {
        return;
    }
    target._deferUpdates = true;
    target.limit(callback => {
        let ignoreUpdates = false,
            handle;

        return () => {
            if (ignoreUpdates) {
                return;
            }
            cancelTask(handle);
            handle = scheduleTask(callback);

            try {
                ignoreUpdates = true;
                target.notifySubscribers(undefined, 'dirty');
            } finally {
                ignoreUpdates = false;
            }
        };
    });
};
