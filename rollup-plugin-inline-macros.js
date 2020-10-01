import {basename, join, relative, sep} from 'path';
import {format} from 'util';
import {writeFileSync} from 'fs';

const MARKER_COMMENT = '//@inline';
const MACRO_DEFINITION_REGEX = /^\s*(?:export )?const ([^ ]+?)\s*=\s\(?([^)]*?)\)?\s*=>\s*([^;]*);?\s*?\/\/@inline(?:-(multiline))?/;
const SUPPORTED_FILENAMES_REGEX = /\.(?:js|esm|es6)$/i;
const LOGGED_PLUGIN_NAME = 'Rollup inline-macros plugin';
const FLAG_MULTILINE_EXPRESSION = 'multiline';

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
 * Author: Lennart Pegel - https://github.com/justlep
 * License: MIT (http://www.opensource.org/licenses/mit-license.php)  
 */
export default function createRollupInlineMacrosPlugin(opts = {verbose: false, logFile: null, versionName: null}) {
    let logFilePath = opts.logFile && join(__dirname, opts.logFile),
        logEntriesForFile,
        totalMacros,
        totalReplacements,
        totalErrors;
    
    return {
        name: 'inline-macros',
        buildStart() {
            logEntriesForFile = logFilePath && [];
            totalMacros = 0;
            totalReplacements = 0;
            totalErrors = 0;
            if (logFilePath) {
                // write log file header
                let versionInfo = opts.versionName ? `\nfor ${opts.versionName}\n` : '';
                writeFileSync(logFilePath, `\nRunning ${LOGGED_PLUGIN_NAME}${versionInfo}\n`);
            }
        },
        buildEnd(err) {
            let summaryLine1 = `${LOGGED_PLUGIN_NAME} finished ${totalErrors ? `with ${totalErrors} ERROR${totalErrors === 1 ? '' : 'S'}`  : 'successfully'}`,
                summaryLine2 = `Found macros: ${totalMacros} | Inlined usages: ${totalReplacements}`,
                hr = '='.repeat(Math.max(summaryLine1.length, summaryLine2.length)),
                summary = `\n\n${hr}\n${summaryLine1}\n${summaryLine2}\n${hr}`;
            console.log(summary);
            if (logFilePath) {
                // write log file lines & summary
                logEntriesForFile.push(summary);
                if (err) {
                    logEntriesForFile.push(err.toString());
                }
                writeFileSync(logFilePath, logEntriesForFile.join('\n\n'), {flag: 'a'});
                console.log(`Logs for ${LOGGED_PLUGIN_NAME} written to:\n${logFilePath}\n`);
            }
        },
        transform(code, id) {
            const currentFilename = basename(id);
            const currentRelativeFilePath = sep === '\\' ? relative(__dirname, id).replace(/\\/g, '/') : relative(__dirname, id);
            if (!SUPPORTED_FILENAMES_REGEX.test(currentFilename)) {
                return {code, map: null};
            }
            /** @type {Map<number, RollupInlineMacrosPlugin_InlineMacro>} */
            const macrosByDefinitionLine = new Map();
            
            let filePathToLogOnce = `\n------- ${currentRelativeFilePath} --------\n\n`;
            
            const LOG = (lineIndex, msg, ...args) => {
                let line = filePathToLogOnce + format(`[${currentFilename}:${lineIndex + 1}]\n${msg}`, ...args);
                if (logEntriesForFile) {
                    logEntriesForFile.push(line);
                }
                if (opts.verbose) {
                    console.log('\n' + line);
                }
                filePathToLogOnce = '';
            } 
            
            let lines = code.split('\n'),
                originalLines;
            
            // (1) find arrow functions marked as macro
            for (let lineIndex = 0, len = lines.length, line, match; lineIndex < len; lineIndex++) {
                line = lines[lineIndex];
                if (!(match = ~line.indexOf(MARKER_COMMENT) && line.match(MACRO_DEFINITION_REGEX))) {
                    continue;
                }
                let [, name, paramsString, body] = match,
                    trimmedBody = body.trim(),
                    isMultilineExpression = !trimmedBody || trimmedBody === FLAG_MULTILINE_EXPRESSION,
                    hasFunctionBody = trimmedBody === '{',
                    skipLines = 0;

                if (hasFunctionBody) {
                    LOG(lineIndex, '(!) Non-single-expression function bodies are not yet supported');
                    totalErrors++;
                    continue;
                }
                
                if (isMultilineExpression) {
                    // Expressions that span over multiple lines will be trimmed line-wise & concatenated
                    // - An empty'ish or comment line is considered the end of the macro
                    // - Since we're not parsing code here, trailing '// comments' will break the expression!
                    for (let lookaheadLineIndex = lineIndex + 1; lookaheadLineIndex < len; lookaheadLineIndex++) {
                        let _trimmedLine = lines[lookaheadLineIndex].trim();
                        if (!_trimmedLine || /^\s*\/[/*]/.test(_trimmedLine)) {
                            skipLines = (lookaheadLineIndex - lineIndex);  
                            break;
                        }
                        trimmedBody += ' ' + _trimmedLine.replace(/;\s*$/, '');
                    }
                } 
                
                let invocationRegex = new RegExp(`([^a-zA-Z._~$])${name}\\(([^)]*?)\\)`, 'g'), // groups = prefixChar, paramsString
                    params = paramsString.replace(/\s/g,'').split(','),
                    bodyWithPlaceholders = !params.length ? trimmedBody : params.reduce((body, paramName, i) => {
                        let paramRegex = new RegExp(`([^a-zA-Z._~$])${paramName}([^a-zA-Z_~$])`, 'g');
                        return body.replace(paramRegex, (m, prefix, suffix) => `${prefix}${getParamPlaceholderForIndex(i)}${suffix}`);
                    }, `(${trimmedBody})`),
                    macro = {name, params, body: trimmedBody, bodyWithPlaceholders, invocationRegex};

                macrosByDefinitionLine.set(lineIndex, macro);
                LOG(lineIndex, 'Found macro: "%s"', macro.name, isMultilineExpression ? ' (MULTI-LINE-EXPRESSION)' : '');
                totalMacros++;
                lineIndex += skipLines; // non-zero if we had multiline-expressions
            }
            
            // (2) replace usages
            lines.forEach((line, lineIndex) => {
                if (macrosByDefinitionLine.has(lineIndex)) {
                    // don't expand macro invocations within macros,
                    // instead re-process regular invocation lines until no more macro invocations are left 
                    return;
                }
                
                for (let shouldScanForInvocations = true, lineIteration = 1; shouldScanForInvocations; lineIteration++) {
                    shouldScanForInvocations = false;
                    for (let macro of macrosByDefinitionLine.values()) {
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
                                LOG(lineIndex, `[ERROR] Mismatch formal parameters (${params.length}) <> invocation (${invParams.length}): \n -> macro: ${name}\n -> usage: ${line}\n`);
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
 * @typedef RollupInlineMacrosPlugin_InlineMacro
 * @property {string} name - the function name
 * @property {string[]} params - names of the formal parameters in the function definition
 * @property {string} body - the function body code
 * @property {string} bodyWithPlaceholders - the function body with formal parameters replaced with placeholders,
 *                           e.g. `(foo,bar) => alert(foo + bar)` will have bodyWithPlaceholders `(alert(%0% + %1%))`   
 * @property {RegExp} invocationRegex - the regex to match an invocation
 */
