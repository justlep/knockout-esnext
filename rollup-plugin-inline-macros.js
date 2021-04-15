import {createFilter} from '@rollup/pluginutils';
import {basename, join, relative, sep} from 'path';
import {format} from 'util';
import {writeFileSync, readFileSync} from 'fs';

const MARKER_COMMENT = '//@inline';
const MACRO_DEFINITION_REGEX = /^\s*(?:export )?const ([^ ]+?)\s*=\s\(?([^)]*?)\)?\s*=>\s*([^;]*);?\s*?\/\/@inline(-global)?/;
const DEFAULT_INCLUDED_FILENAMES_REGEX = /\.(?:js|mjs)$/i;
const LOGGED_PLUGIN_NAME = 'Rollup inline-macros plugin';
const FLAG_GLOBAL = '-global';

const getParamPlaceholderForIndex = (index) => `%~%>${index}<%~%`; // regex-safe + unlikely to exist anywhere inside macro code
const getParamPlaceholderReplacementRegexForIndex = (index) => new RegExp(getParamPlaceholderForIndex(index), 'g');


/**
 * A rollup plugin that scans each file for const arrow functions marked with a trailing '//@inline' comment.
 * Invocations of those functions within the same file are then replaced with the actual arrow-function code,
 * much like early Pascal "inline" functions or macros in other languages.  
 * Helpful to keep sources DRY while boosting performance in hot execution paths by saving some function calls.
 *
 * Example:
 *   const _isLowercaseString = (s) => typeof s === 'string' && s.toLowerCase() === s; //@inline
 *
 * Invocations like following:
 *   if (_isLowercaseString(foo)) {
 * will be expanded to:  
 *   if ((typeof foo === 'string' && foo.toLowerCase() === foo)) {
 * 
 * 
 * Current limitations:
 *   - multiline-expressions MUST NOT contain line-comments (except the initial inline-marker comment) 
 *   - the invocation must match the number of formal parameters (optional parameters MUST be passed explicitly as undefined)
 *   - invocation parameters that are no identifiers (e.g. object literals or strings) MUST NOT contain commas 
 * 
 * @param {RollupInlineMacrosPluginOptions} opts
 * 
 * Author: Lennart Pegel - https://github.com/justlep
 * License: MIT (http://www.opensource.org/licenses/mit-license.php)
 */
export default function createRollupInlineMacrosPlugin(opts = {}) {
    // Using Rollup's recommended include/exclude filter mechanism -> https://rollupjs.org/guide/en/#example-transformer
    const canProcess = createFilter(opts.include || DEFAULT_INCLUDED_FILENAMES_REGEX, opts.exclude);
    const logFilePath = opts.logFile && join(__dirname, opts.logFile);
    
    let totalMacros = 0,
        totalReplacements = 0,
        totalErrors = 0;
    
    /**
     * A set of all line references that belong to macro definitions. 
     * (may contain multiple entries per single macro in case of multi-line expression macros) 
     * @type {Set<RollupInlineMacrosPlugin_LineReference>} 
     */
    const allMacroDefinitionLineReferences = new Set();
        
    /** @type {Map<string, RollupInlineMacrosPlugin_InlineMacro>} */
    const globalMacrosByName = new Map();
    
    /** @type {Map<string, RollupInlineMacrosPlugin_InlineMacro[]>} */
    const localMacrosByFileId = new Map();
        
    /** @type {Map<string, string[]>|null} */
    const logEntriesByFileId = logFilePath ? new Map() : null;

    /**
     * @param {string} id - the file id in Rollup speak (i.e. the file path)
     * @param {string} code
     * @param {boolean} logFilePathOnce
     * @return {RollupInlineMacrosPlugin_FileUtils}
     */
    const getFileUtils = (id, code, logFilePathOnce) => {
        let filename = basename(id),
            relativeFilePath = (sep === '\\') ? relative(__dirname, id).replace(/\\/g, '/') : relative(__dirname, id),
            filePathToLogOnce = logFilePathOnce ? `\n------- ${relativeFilePath} --------\n\n` : '',
            logEntriesForFile = logEntriesByFileId ? logEntriesByFileId.get(id) : null,
            localMacros = localMacrosByFileId.get(id);

        if (logEntriesForFile === undefined) {
            logEntriesByFileId.set(id, logEntriesForFile = []);
        }
        if (!localMacros) {
            localMacrosByFileId.set(id, localMacros = []);
        }
        return {
            filename,
            relativeFilePath,
            getLineReference: lineIndex => `${relativeFilePath}:${lineIndex + 1}`,
            localMacros,
            lines: code.split('\n'),
            LOG: (lineIndex, msg, ...args) => {
                let line = filePathToLogOnce + format(`[${filename}:${lineIndex + 1}]\n${msg}`, ...args);
                if (logEntriesForFile) {
                    logEntriesForFile.push(line);
                }
                if (opts.verbose) {
                    console.log('\n:' + line);
                }
                filePathToLogOnce = '';
            }
        }
    };
    
    return {
        name: 'inline-macros',
        buildStart() {
            if (logFilePath) {
                // write log file header
                let versionInfo = opts.versionName ? `\nfor ${opts.versionName}\n` : '';
                writeFileSync(logFilePath, `\nRunning ${LOGGED_PLUGIN_NAME}${versionInfo}\n`);
            }
            console.log('Scanning for macros...');
        },
        buildEnd(err) {
            let hasUnusedMacros = false;
            /**
             * @param {RollupInlineMacrosPlugin_InlineMacro} macro
             * @return {string}
             */
            const toMacroUsageString = macro => {
                let count = macro.replacementsCount;
                hasUnusedMacros = hasUnusedMacros || !count;
                return ` ${count ? `${count}x` : '(!) UNUSED '}  ${macro.name}  - [${macro.lineReference}]`; 
            };
            
            let usageSummary = [
                '',
                'Global macros inlining summary:',
                ...Array.from(globalMacrosByName.values()).map(toMacroUsageString),
                '',
                'Local macros inlining summary:',
                ...Array.from(localMacrosByFileId.keys())
                    .sort()
                    .map(fileId => localMacrosByFileId.get(fileId))
                    .filter(macros => macros.length)
                    .map(macros => macros.map(toMacroUsageString).join('\n')),
                ''
            ].join('\n');
            
            let summaryLine1 = `${LOGGED_PLUGIN_NAME} finished ${totalErrors ? `with ${totalErrors} ERROR${totalErrors === 1 ? '' : 'S'}`  : 'successfully'}`,
                summaryLine2 = `Found macros: ${totalMacros} (${globalMacrosByName.size} global) | Inlined usages: ${totalReplacements}`,
                unusedWarning = hasUnusedMacros ? 'NOTICE: found macros which never got inlined\n' : '',
                hr = '='.repeat(Math.max(summaryLine1.length, summaryLine2.length)),
                summary = `${hr}\n${summaryLine1}\n${summaryLine2}\n${unusedWarning}${hr}`;
            
            console.log(summary);

            if (logFilePath) {
                // write log file lines & summary
                let logEntriesToWrite = Array.from(logEntriesByFileId.keys()).sort()
                            .map(fileId => logEntriesByFileId.get(fileId))
                            .filter(arr => arr.length)
                            .map(arr => arr.join('\n\n'));
                logEntriesToWrite.push(usageSummary);
                logEntriesToWrite.push(summary);
                if (err) {
                    logEntriesToWrite.push(err.toString());
                }
                writeFileSync(logFilePath, logEntriesToWrite.join('\n\n') + '\n', {flag: 'a'});
                console.log(`Logs for ${LOGGED_PLUGIN_NAME} written to:\n${logFilePath}\n`);
            }
            if (totalErrors && !opts.ignoreErrors) {
                throw new Error(`${LOGGED_PLUGIN_NAME} throws due to inlining error(s) and 'ignoreErrors' disabled.`);
            }
        },
        /**
         * Phase 1: load each file, parse macro definitions + keep references to the lines they're found in
         * @param {string} id - the file path
         */
        load(id) {
            if (!canProcess(id)) {
                // skip & defer to other loaders,
                // see https://github.com/rollup/rollup/blob/master/docs/05-plugin-development.md#load
                return null;
            }
            const code = readFileSync(id).toString('utf-8');
            const {localMacros, lines, LOG, getLineReference} = getFileUtils(id, code, true);

            // (1) find arrow functions marked as macro
            
            for (let lineIndex = 0, len = lines.length, line, match; lineIndex < len; lineIndex++) {
                line = lines[lineIndex];
                let lineReference = getLineReference(lineIndex);
                if (!(match = ~line.indexOf(MARKER_COMMENT) && line.match(MACRO_DEFINITION_REGEX))) {
                    continue;
                }
                let [, name, paramsString, body, flag] = match,
                    trimmedBody = body.trim(),
                    isMultilineExpression = !trimmedBody, 
                    isGlobal = flag === FLAG_GLOBAL,
                    hasFunctionBody = trimmedBody === '{',
                    skipLines = 0,
                    error;
                
                if (hasFunctionBody) {
                    error = `Non-single-expression function bodies are not yet supported ("${name}")`;
                } else if (globalMacrosByName.has(name)) {
                    error = isGlobal ? `Duplicate name for global macro "${name}"` 
                                     : `Ambiguous name for local macro "${name}" (name already used by global macro)`;
                }

                if (error) {
                    LOG(lineIndex, '(!) ERROR: ' + error);
                    totalErrors++;
                    continue;
                }
                
                if (isMultilineExpression) {
                    // Expressions that span over multiple lines will be trimmed line-wise & concatenated
                    // - An empty'ish or comment line is considered the end of the macro
                    // - Since we're not parsing code here, trailing '// comments' will break the expression!
                    for (let lookaheadLineIndex = lineIndex + 1; lookaheadLineIndex < len; lookaheadLineIndex++) {
                        let _trimmedLine = lines[lookaheadLineIndex].trim();
                        // keep a reference to all lines of the macro (incl the end marker line), 
                        // so these lines can be skipped in phase 2 for replacements
                        allMacroDefinitionLineReferences.add(getLineReference(lookaheadLineIndex));
                        if (!_trimmedLine || /^\s*\/[/*]/.test(_trimmedLine)) {
                            skipLines = (lookaheadLineIndex - lineIndex);
                            break;
                        }
                        trimmedBody += ' ' + _trimmedLine.replace(/;\s*$/, '');
                    }
                }

                allMacroDefinitionLineReferences.add(lineReference);
                
                let invocationRegex = new RegExp(`([^a-zA-Z._~$])${name}\\(([^)]*?)\\)`, 'g'), // groups = prefixChar, paramsString
                    params = paramsString.replace(/\s/g,'').split(','),
                    bodyWithPlaceholders = !params.length ? trimmedBody : params.reduce((body, paramName, i) => {
                        let paramRegex = new RegExp(`([^a-zA-Z._~$])${paramName}([^a-zA-Z_~$])`, 'g');
                        return body.replace(paramRegex, (m, prefix, suffix) => `${prefix}${getParamPlaceholderForIndex(i)}${suffix}`);
                    }, `(${trimmedBody})`);
                
                /** @type {RollupInlineMacrosPlugin_InlineMacro} */
                let macro = {
                    name, 
                    params, 
                    body: trimmedBody, 
                    bodyWithPlaceholders, 
                    invocationRegex,
                    replacementsCount: 0,
                    lineReference
                };

                if (isGlobal) {
                    globalMacrosByName.set(name, macro);
                } else {
                    localMacros.push(macro); 
                }

                LOG(lineIndex, `Found ${isGlobal ? 'global' : 'local'} macro: "${macro.name}" ${isMultilineExpression ? ' (MULTI-LINE-EXPRESSION)' : ''}`);
                totalMacros++;
                lineIndex += skipLines; // non-zero if we had multiline-expressions
            }
            
            return code;
        },
        /**
         * Phase 2: within each file, find invocations of local+global macros and replace invocation with macro body expression
         * @param {string} code - the file content returned from phase 1
         * @param {string} id - the file path
         */
        transform(code, id) {
            if (!canProcess(id)) {
                return;
            }

            const {localMacros, getLineReference, LOG, lines} = getFileUtils(id, code, false);

            /** @type {RollupInlineMacrosPlugin_InlineMacro[]} */
            const availableMacros = [...localMacros, ...globalMacrosByName.values()];

            /** @type {string[]} */
            let originalLines;
            
            lines.forEach((line, lineIndex) => {
                let lineReference = getLineReference(lineIndex),
                    isMacroDefinitionLine = allMacroDefinitionLineReferences.has(lineReference);
                
                if (isMacroDefinitionLine) {
                    // don't expand macro invocations within macro definitions,
                    // instead re-process regular invocation lines until no more macro invocations are left 
                    return;
                }
                
                for (let shouldScanForInvocations = true, lineIteration = 1; shouldScanForInvocations; lineIteration++) {
                    shouldScanForInvocations = false;
                    for (let macro of availableMacros) {
                        let {name, params, invocationRegex, bodyWithPlaceholders} = macro,
                            isPossibleInvocationLine = ~line.indexOf(name + '('); 
                        
                        if (!isPossibleInvocationLine) {
                            continue;
                        }
                        
                        let changedLine = line.replace(invocationRegex, (matchedInvocation, invPrefixChar, invParamsString) => {
                            // FIXME invocations like foo("hey,foo") won't work, but that's ok for now
                            let invParams = invParamsString.split(',').map(s => s.trim());
                            // LOG(lineIndex, `Checking invocation of '${name}'`);
                            if (invParams.length !== params.length) {
                                LOG(lineIndex, `[ERROR] Mismatch # formal parameters (${params.length}) <> invocation (${invParams.length}): \n -> macro: ${name}\n -> usage: ${line}\n`);
                                totalErrors++;
                                return matchedInvocation;
                            }
                            
                            let replacedInvocation = invPrefixChar + bodyWithPlaceholders;
                            
                            invParams.forEach((paramName, i) => {
                                let placeholderRegex = getParamPlaceholderReplacementRegexForIndex(i);
                                replacedInvocation = replacedInvocation.replace(placeholderRegex, paramName);
                            });
                            
                            return replacedInvocation;
                        });
                        
                        if (changedLine !== line) {
                            if (!originalLines) {
                                originalLines = lines.slice(); // lazy-copy original lines before any changes
                            }
                            let iterationLogString = lineIteration > 1 ? `  [iteration #${lineIteration}]` : '';
                            LOG(lineIndex, `Inlined: "${name}"${iterationLogString}\nOLD:  ${originalLines[lineIndex].trim()}\nNEW:  ${changedLine.trim()}`);
                            line = changedLine;
                            lines[lineIndex] = changedLine;
                            macro.replacementsCount++;
                            totalReplacements++;
                            
                            // re-iterate, because macros may be using other macros
                            shouldScanForInvocations = true;
                        }
                    }
                }
            });
            
            return {code: lines.join('\n'), map: null};
        }
    }
}

/**
 * @typedef {Object} RollupInlineMacrosPluginOptions
 * @property {boolean} verbose - if true, detailed processing info* will be written to the console
 *                               (* = the details otherwise written to the optional logfile only)
 * @property {?string} [logFile] - path to a log file (will be overwritten during each run)
 * @property {?string} [versionName] - a version name used to be used in the log file (if enabled)
 * @property {RegExp} [include] - included filenames pattern (falsy value will default to {@link DEFAULT_INCLUDED_FILENAMES_REGEX})
 * @property {RegExp} [exclude] - excluded filenames pattern
 * @property {boolean} [ignoreErrors] - set true to make the plugin NOT throw/break the build if errors were detected during processing
 */

/**
 * @typedef RollupInlineMacrosPlugin_InlineMacro
 * @property {string} name - the function name
 * @property {string[]} params - names of the formal parameters in the function definition
 * @property {string} body - the function body code
 * @property {string} bodyWithPlaceholders - the function body with formal parameters replaced with placeholders,
 *                           e.g. `(foo,bar) => alert(foo + bar)` will have bodyWithPlaceholders `(alert(%0% + %1%))`   
 * @property {RegExp} invocationRegex - the regex to match an invocation
 * @property {number} replacementsCount
 * @property {string} lineReference
 */

/**
 * @typedef {string} RollupInlineMacrosPlugin_LineReference
 * A string containing a filename and line for referencing a code line, e.g. "src/path/file.js:123"
 */

/**
 * @typedef {Object} RollupInlineMacrosPlugin_FileUtils
 * @property {string} filename
 * @property {function} LOG 
 * @property {RollupInlineMacrosPlugin_InlineMacro[]} localMacros
 * @property {string[]} lines
 * @property {string} relativeFilePath
 * @property {function(number): string} getLineReference
 */
