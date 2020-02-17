module.exports = function(grunt) {
    require('grunt-load-npm-run-tasks')(grunt);
    
    grunt.initConfig({
        testtypes: {
            global: "spec/types/global",
            module: "spec/types/module"
        }
    });

    grunt.registerTask('clean', 'Clean up output files.', function () {
        let files = grunt.file.expand(['build/output/*.js', 'build/output/*.js.map']);
        files.forEach(file => grunt.file.delete(file));
    });

    grunt.registerMultiTask('testtypes', 'Run types tests', function () {
        let done = this.async(),
            target = this.target;

        grunt.util.spawn({ cmd: "tsc", args: ["-p", this.data] },
            function (error, result, code) {
                grunt.log.writeln(result.stdout);
                if (error) {
                    grunt.log.error(result.stderr);
                } else {
                    grunt.log.ok("Knockout TypeScript " + target + " types validated!");
                }
                done(!error);
            }
        );
    });

    grunt.registerTask('dist', ['npmRun:rollup-dist']);
    
    // Default task.
    grunt.registerTask('default', ['clean', 'npmRun:lint', 'npmRun:test' /* pretest includes npmRun:rollup-dev */, 'testtypes']);
};
