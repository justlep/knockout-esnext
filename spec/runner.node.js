console.log("Running Knockout tests in Node.js");

var jasmine = require('./lib/jasmine-1.2.0/jasmine');

// export jasmine globals
for (var key in jasmine) {
    global[key] = jasmine[key];
}

// add our jasmine extensions to the exported globals
require('./lib/jasmine.extensions');

// export ko globals
global.ko = require('../build/knockout.debug.js');

// reference behaviors that should work out of browser
require('./arrayEditDetectionBehaviors');
require('./asyncBehaviors');
require('./dependentObservableBehaviors');
require('./pureComputedBehaviors');
require('./expressionRewritingBehaviors');
require('./extenderBehaviors');
require('./mappingHelperBehaviors');
require('./observableArrayBehaviors');
require('./observableArrayChangeTrackingBehaviors');
require('./observableBehaviors');
require('./observableUtilsBehaviors');
require('./subscribableBehaviors');
require('./taskBehaviors');
require('./utilsBehaviors');

// get reference to jasmine runtime
var env = jasmine.jasmine.getEnv();

// create reporter to return results
function failureFilter(item) {
    return !item.passed();
}
env.addReporter({
    reportRunnerResults:function (runner) {
        var results = runner.results();
        runner.suites().map(function (suite) {
            // hack around suite results not having a description
            var suiteResults = suite.results();
            suiteResults.description = suite.description;
            return suiteResults;
        }).filter(failureFilter).forEach(function (suite) {
            console.error(suite.description);
            suite.getItems().filter(failureFilter).forEach(function (spec) {
                console.error('\t' + spec.description);
                spec.getItems().filter(failureFilter).forEach(function (expectation) {
                    console.error('\t\t' + expectation.message);
                });
            });
        });
        console.log("Total:" + results.totalCount + " Passed:" + results.passedCount + " Failed:" + results.failedCount);
        process.exit(results.failedCount);
    }
});

// good to go
env.execute();
