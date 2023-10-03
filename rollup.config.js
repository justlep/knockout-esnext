const {terser} = require('rollup-plugin-terser');
const pkg = require('./package.json');

import createRollupInlineMacrosPlugin from './rollup-plugin-inline-macros';

const getVersion = () => `${pkg.version}`;

const getFullReleaseName = () => `Knockout-ESNext JavaScript library v${getVersion()}`; 

const getBanner = () => `/*!
 * ${getFullReleaseName()}
 * https://github.com/justlep/knockout-esnext
 * Forked from Knockout v3.5.1
 * (c) The Knockout.js team - ${pkg.homepage}
 * License: ${pkg.licenses[0].type} (${pkg.licenses[0].url})
 */
`;
const getIntro = (debugEnabled) => 
    `const DEBUG = ${!!debugEnabled}; // inserted by rollup intro\n`+
    `const version = '${getVersion()}'; // inserted by rollup intro`;

export default {
    input: 'src/ko.js',
    treeshake: true,
    output: [
        {   // the minified version
            format: 'umd',
            name: 'ko',
            file: 'build/knockout.js',
            banner: getBanner(),
            intro: getIntro(),
            sourcemap: false,
            strict: false,
            plugins: [terser()]
        },
        {   // the non-minified debug version incl. sourcemap (DEBUG=true) 
            format: 'umd',
            name: 'ko',
            file: 'build/knockout.debug.js',
            banner: getBanner(),
            intro: getIntro(true),
            sourcemap: true,
            strict: false
        },
        {   // the minified ES Module version
            format: 'esm',
            file: 'build/knockout.esm.js',
            banner: getBanner(),
            intro: getIntro(),
            sourcemap: false,
            strict: false,
            plugins: [terser()]
        }
    ],
    plugins: [
        createRollupInlineMacrosPlugin({
            include: /\.js$/,
            versionName: getFullReleaseName(),
            logFile: '/build/inline-macros-plugin.log',
            verbose: false // TODO re-enable for CI environments
        })
    ]
};
