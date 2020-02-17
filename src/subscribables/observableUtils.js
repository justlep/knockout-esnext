export const IS_SUBSCRIBABLE = Symbol('IS_SUBSCRIBABLE');
export const isSubscribable = (obj) => !!(obj && obj[IS_SUBSCRIBABLE]);

export const IS_OBSERVABLE = Symbol('IS_OBSERVABLE');
//export const isObservable = (obj) => !!(obj && obj[IS_OBSERVABLE]);
export const isObservable = (obj) => {
    if (!obj) {
        return false;
    }
    if (obj.__ko_proto__) {
        // TODO left this only for not breaking the asyncBehaviors.js tests; remove later 
        throw Error("Invalid object that looks like an observable; possibly from another Knockout instance");
    }
    return !!obj[IS_OBSERVABLE];
};

export const IS_OBSERVABLE_ARRAY = Symbol('IS_OBSERVABLE_ARRAY');
export const isObservableArray = (obj) => !!(obj && obj[IS_OBSERVABLE_ARRAY]);

export const IS_COMPUTED = Symbol('IS_COMPUTED');
export const isComputed = (obj) => !!(obj && obj[IS_COMPUTED]);

export const IS_PURE_COMPUTED = Symbol('IS_PURE_COMPUTED');
export const isPureComputed = (obj) => !!(obj && obj[IS_PURE_COMPUTED]);

export const isWritableObservable = (obj) => !!(obj && (obj[IS_COMPUTED] ? obj.hasWriteFunction : obj[IS_OBSERVABLE]));
export const isWriteable = isWritableObservable; 
