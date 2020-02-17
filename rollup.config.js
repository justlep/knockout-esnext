const {terser} = require('rollup-plugin-terser');
const pkg = require('./package.json');

const buildTarget = (process.env.BUILD_TARGET_ENV || '').toLowerCase();
const isTargetDist = buildTarget === 'dist';

const getBanner = (versionSuffix = '') => `/*!
 * Knockout JavaScript library v${pkg.version}-esnext${versionSuffix}
 * ESNext Edition - https://github.com/justlep/knockout-esnext
 * (c) The Knockout.js team - ${pkg.homepage}
 * License: ${pkg.licenses[0].type} (${pkg.licenses[0].url})
 */
`;
const getIntro = (debugEnabled) => 
    `const DEBUG = ${!!debugEnabled}; // inserted by rollup intro\nconst version = '${pkg.version}'; // inserted by rollup intro`;

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
    output: [
        {   // the minified version
            banner: getBanner(),
            file: isTargetDist ? 'dist/knockout.js' : 'build/output/knockout-latest.js',
            intro: getIntro(),
            format: 'umd',
            name: 'ko',
            sourcemap: false,
            treeshake: false,
            strict: false,
            plugins: [terser()]
        },
        {   // the minified ES Module version
            banner: getBanner(),
            file: isTargetDist ? 'dist/knockout.esm.js' : 'build/output/knockout-latest.esm.js',
            intro: getIntro(),
            format: 'esm',
            sourcemap: false,
            treeshake: false,
            strict: false,
            plugins: [terser()]
        },
        {   // the non-minified debug version incl. sourcemap (DEBUG=true) 
            banner: getBanner(isTargetDist ? '' : '-debug'),
            file: isTargetDist ? 'dist/knockout.debug.js' : 'build/output/knockout-latest.debug.js',
            intro: getIntro(true),
            format: 'umd',
            name: 'ko',
            sourcemap: true,
            treeshake: false,
            strict: false,
            comments: 'all'
        }
    ],
    plugins: [
        {
            name: '__post-dist-build-message__',
            buildEnd: (err) => !err && isTargetDist && showPublishNote()
        }
    ]
};
