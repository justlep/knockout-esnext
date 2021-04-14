const {terser} = require('rollup-plugin-terser');
const pkg = require('./package.json');

import createRollupInlineMacrosPlugin from './rollup-plugin-inline-macros';

const buildTarget = (process.env.BUILD_TARGET_ENV || '').toLowerCase();
const isTargetDist = buildTarget === 'dist';
const isEnvTravis = process.env.TRAVIS === 'true';

const getVersion = (versionSuffix) => `${pkg.version}-esnext${versionSuffix || ''}`;

const getFullReleaseName = (versionSuffix) => `Knockout JavaScript library v${getVersion(versionSuffix)}`; 

const getBanner = (versionSuffix = '') => `/*!
 * ${getFullReleaseName(versionSuffix)}
 * ESNext Edition - https://github.com/justlep/knockout-esnext
 * (c) The Knockout.js team - ${pkg.homepage}
 * License: ${pkg.licenses[0].type} (${pkg.licenses[0].url})
 */
`;
const getIntro = (debugEnabled) => 
    `const DEBUG = ${!!debugEnabled}; // inserted by rollup intro\n`+
    `const version = '${getVersion()}'; // inserted by rollup intro`;

const showPublishNote = () => console.log(`
To publish, run:
    git add -f ./dist/knockout.js
    git add -f ./dist/knockout.esm.js
    git add -f ./dist/knockout.debug.js
    git add -f ./dist/knockout.debug.js.map
    git checkout head
    git commit -m 'Version ${pkg.version} for distribution'
    git tag -a v${pkg.version} -m 'Add tag v${pkg.version}'
    git checkout master
    git push origin --tags
`);


export default {
    input: 'src/ko.js',
    treeshake: true,
    output: [
        {   // the minified version
            format: 'umd',
            name: 'ko',
            file: isTargetDist ? 'dist/knockout.js' : 'build/output/knockout-latest.js',
            banner: getBanner(),
            intro: getIntro(),
            sourcemap: false,
            strict: false,
            plugins: [terser()]
        },
        {   // the non-minified debug version incl. sourcemap (DEBUG=true) 
            format: 'umd',
            name: 'ko',
            file: isTargetDist ? 'dist/knockout.debug.js' : 'build/output/knockout-latest.debug.js',
            banner: getBanner(isTargetDist ? '' : '-debug'),
            intro: getIntro(true),
            sourcemap: true,
            strict: false
        },
        {   // the minified ES Module version
            format: 'esm',
            file: isTargetDist ? 'dist/knockout.esm.js' : 'build/output/knockout-latest.esm.js',
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
            logFile: !isEnvTravis && `${isTargetDist ? 'dist' : '/build/output'}/inline-macros-plugin.log`,
            verbose: isEnvTravis
        }),
        {
            name: '__post-dist-build-message__',
            buildEnd: (err) => !err && isTargetDist && showPublishNote()
        }
    ]
};
