import {pureComputed} from './dependentObservable';

export const when = (predicate, callback, context) => {

    const _kowhen = (resolve) => {
        let _observable = pureComputed(predicate, context).extend({notify:'always'});
        let subscription = _observable.subscribe(value => {
            if (value) {
                subscription.dispose();
                resolve(value);
            }
        });
        // In case the initial value is true, process it right away
        _observable.notifySubscribers(_observable.peek());

        return subscription;
    };

    return callback ? _kowhen(context ? callback.bind(context) : callback) : new Promise(_kowhen);
};
