
describe('Basic type checking', function() {
    it('Should be able to verify the knockout type for any object', function () {
        let observable = ko.observable(),
            readOnlyComputed1 = ko.computed(() => observable),
            readOnlyComputed2 = ko.computed({
                read: ko.observable()
            }),
            readWriteComputed = ko.computed({
                read: ko.observable(),
                write: () => {}
            }),
            pureComputed = ko.pureComputed(() => ko.observable()),
            obsArray = ko.observableArray();

        expect(ko.isSubscribable(observable)).toBe(true);
        expect(ko.isSubscribable(obsArray)).toBe(true);
        expect(ko.isSubscribable(readOnlyComputed1)).toBe(true);
        expect(ko.isSubscribable(readOnlyComputed2)).toBe(true);
        expect(ko.isSubscribable(readWriteComputed)).toBe(true);
        expect(ko.isSubscribable(pureComputed)).toBe(true);

        expect(ko.isObservable(observable)).toBe(true);
        expect(ko.isObservable(obsArray)).toBe(true);
        expect(ko.isObservable(readOnlyComputed1)).toBe(true);
        expect(ko.isObservable(readOnlyComputed2)).toBe(true);
        expect(ko.isObservable(readWriteComputed)).toBe(true);
        expect(ko.isObservable(pureComputed)).toBe(true);
        
        expect(ko.isComputed(observable)).toBe(false);
        expect(ko.isComputed(obsArray)).toBe(false);
        expect(ko.isComputed(readOnlyComputed1)).toBe(true);
        expect(ko.isComputed(readOnlyComputed2)).toBe(true);
        expect(ko.isComputed(readWriteComputed)).toBe(true);
        expect(ko.isComputed(pureComputed)).toBe(true);

        // the next block is taken from dependentObservableBehaviors.js
        expect(ko.isComputed(undefined)).toEqual(false);
        expect(ko.isComputed(null)).toEqual(false);
        expect(ko.isComputed('x')).toEqual(false);
        expect(ko.isComputed({})).toEqual(false);
        expect(ko.isComputed(function() {})).toEqual(false);
        expect(ko.isComputed(ko.observable())).toEqual(false);
        // following test makes no sense with the new isComputed anymore
        // expect(ko.isComputed(function() {let x = ko.computed(function() {}); x.__ko_proto__= {}; return x; }())).toEqual(false);
        
        expect(ko.isObservableArray(observable)).toBe(false);
        expect(ko.isObservableArray(obsArray)).toBe(true);
        expect(ko.isObservableArray(readOnlyComputed1)).toBe(false);
        expect(ko.isObservableArray(readOnlyComputed2)).toBe(false);
        expect(ko.isObservableArray(readWriteComputed)).toBe(false);
        expect(ko.isObservableArray(pureComputed)).toBe(false);
        
        expect(ko.isPureComputed(observable)).toBe(false);
        expect(ko.isPureComputed(obsArray)).toBe(false);
        expect(ko.isPureComputed(readOnlyComputed1)).toBe(false);
        expect(ko.isPureComputed(readOnlyComputed2)).toBe(false);
        expect(ko.isPureComputed(readWriteComputed)).toBe(false);
        expect(ko.isPureComputed(pureComputed)).toBe(true);
        
        expect(ko.isWritableObservable(observable)).toBe(true);
        expect(ko.isWritableObservable(obsArray)).toBe(true);
        expect(ko.isWritableObservable(readOnlyComputed1)).toBe(false);
        expect(ko.isWritableObservable(readOnlyComputed2)).toBe(false);
        expect(ko.isWritableObservable(readWriteComputed)).toBe(true);
        expect(ko.isWritableObservable(pureComputed)).toBe(false);
    });
    
});
