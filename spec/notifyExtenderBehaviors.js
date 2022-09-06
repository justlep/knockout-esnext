
describe('notify extender', () => {

    const originalObservableEqualityComparer = ko.observable.fn.equalityComparer;
    const originalComputedEqualityComparer = ko.computed.fn.equalityComparer;

    expect(typeof originalObservableEqualityComparer).toBe('function');
    expect(typeof originalComputedEqualityComparer).toBe('function');
    
    afterEach(() => {
        ko.observable.fn.equalityComparer = originalObservableEqualityComparer;
        ko.computed.fn.equalityComparer = originalComputedEqualityComparer;
    });
    
    it('can make observables trigger always', () => {
        let o = ko.observable(1);
        let calledArgs = [];
        
        o.subscribe(v => calledArgs.push(v));
        o(1);
        expect(calledArgs).toEqual([]);
        o(2);
        expect(calledArgs).toEqual([2]);
        o(1);
        expect(calledArgs).toEqual([2,1]);
        o(1);
        expect(calledArgs).toEqual([2,1]);
        
        o.extend({notify: 'always'});
        o(1);
        expect(calledArgs).toEqual([2,1,1]);
        o(1);
        expect(calledArgs).toEqual([2,1,1,1]);
        
        o.extend({notify: null}); // back to default
        o(1);
        expect(calledArgs).toEqual([2,1,1,1]);
        o(1);
        expect(calledArgs).toEqual([2,1,1,1]);
        o(2);
        expect(calledArgs).toEqual([2,1,1,1,2]);
    });

    it('can make computeds trigger always', () => {
        let o = ko.observable({v: 1}),
            comp = ko.computed(() => o().v)
        
        let calledArgs = [];

        comp.subscribe(v => calledArgs.push(v));
        
        o({v:1});
        expect(calledArgs).toEqual([]);
        o({v:2});
        expect(calledArgs).toEqual([2]);
        o({v:1});
        expect(calledArgs).toEqual([2,1]);
        o({v:1});
        expect(calledArgs).toEqual([2,1]);

        comp.extend({notify: 'always'});
        o({v:1});
        expect(calledArgs).toEqual([2,1,1]);
        o({v:1});
        expect(calledArgs).toEqual([2,1,1,1]);

        comp.extend({notify: null}); // back to default
        o({v:1});
        expect(calledArgs).toEqual([2,1,1,1]);
        o({v:1});
        expect(calledArgs).toEqual([2,1,1,1]);
        o({v:2});
        expect(calledArgs).toEqual([2,1,1,1,2]);
    });
    
    it('restores a previous custom equalityComparer of observables', () => {
        let totalComparisons = 0;
        
        ko.observable.fn.equalityComparer = (a,b) => {
            totalComparisons++;
            return a === b;
        };
        
        let o = ko.observable(1);
        let calledArgs = [];

        o.subscribe(v => calledArgs.push(v));
        o(1);
        expect(calledArgs).toEqual([]);
        expect(totalComparisons).toBe(1);
        o(2);
        expect(calledArgs).toEqual([2]);
        expect(totalComparisons).toBe(2);
        o(1);
        expect(calledArgs).toEqual([2,1]);
        expect(totalComparisons).toBe(3);
        o(1);
        expect(calledArgs).toEqual([2,1]);
        expect(totalComparisons).toBe(4);

        o.extend({notify: 'always'});
        o(1);
        expect(calledArgs).toEqual([2,1,1]);
        expect(totalComparisons).toBe(4);
        o(1);
        expect(calledArgs).toEqual([2,1,1,1]);
        expect(totalComparisons).toBe(4);

        o.extend({notify: null}); // back to the equalityComparer that was used before extend notify:always
        o(1);
        expect(calledArgs).toEqual([2,1,1,1]);
        expect(totalComparisons).toBe(5);
        o(1);
        expect(calledArgs).toEqual([2,1,1,1]);
        expect(totalComparisons).toBe(6);
        o(2);
        expect(calledArgs).toEqual([2,1,1,1,2]);
        expect(totalComparisons).toBe(7);
    });
    
    it('restores a previous custom equalityComparer of computeds', () => {
        let totalComparisons = 0;
        
        ko.computed.fn.equalityComparer = (a,b) => {
            totalComparisons++;
            return a === b;
        };

        let o = ko.observable({v: 1}),
            comp = ko.computed(() => o().v)

        expect(totalComparisons).toBe(1); // custom equality comparer was already used once during computed initialization 
        
        let calledArgs = [];

        comp.subscribe(v => calledArgs.push(v));
        
        o({v:1});
        expect(calledArgs).toEqual([]);
        expect(totalComparisons).toBe(2);
        o({v:2});
        expect(calledArgs).toEqual([2]);
        expect(totalComparisons).toBe(3);
        o({v:1});
        expect(calledArgs).toEqual([2,1]);
        expect(totalComparisons).toBe(4);
        o({v:1});
        expect(calledArgs).toEqual([2,1]);
        expect(totalComparisons).toBe(5);

        comp.extend({notify: 'always'});
        
        o({v:1});
        expect(calledArgs).toEqual([2,1,1]);
        expect(totalComparisons).toBe(5);
        o({v:1});
        expect(calledArgs).toEqual([2,1,1,1]);
        expect(totalComparisons).toBe(5);

        comp.extend({notify: null}); // back to the equalityComparer that was used before extend notify:always
        
        o({v:1});
        expect(calledArgs).toEqual([2,1,1,1]);
        expect(totalComparisons).toBe(6);
        o({v:1});
        expect(calledArgs).toEqual([2,1,1,1]);
        expect(totalComparisons).toBe(7);
        o({v:2});
        expect(calledArgs).toEqual([2,1,1,1,2]);
        expect(totalComparisons).toBe(8);
    });
    
    
});
