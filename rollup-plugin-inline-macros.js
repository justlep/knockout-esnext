import {basename, join, relative, sep} from 'path';
import {format} from 'util';
import {writeFileSync} from 'fs';

const MARKER_COMMENT = '//@inline';
const MACRO_DEFINITION_REGEX = /^\*?const ([^ ]+?)\s*=\s\(?([^)]*?)\)?\s*=>\s*([^{].*?);?\s*\/\/@inline/;
const SUPPORTED_FILENAMES_REGEX = /\.(?:js|esm|es6)$/i;
const LOGGED_PLUGIN_NAME = 'Rollup inline-macros plugin';

const getParamPlaceholderForIndex = (index) => `%${index}%`;


/**
 * A rollup plugin that scans each file for pure const arrow functions marked with a trailing '//@inline' comment.
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
 *   - only single-line arrow functions are supported
 *   - invocation parameters that are no variable names (e.g. object literals or strings) MUST NOT contain commas 
 * 
 * Author: Lennart Pegel - https://github.com/justlep
 * License: MIT (http://www.opensource.org/licenses/mit-license.php)  
 */
export default function createRollupInlineMacrosPlugin(opts = {verbose: false, logFile: null}) {
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
                writeFileSync(logFilePath, `${LOGGED_PLUGIN_NAME}\nStart: ${new Date().toUTCString()}\n\n`);
            }
        },
        buildEnd(err) {
            let summaryLine1 = `${LOGGED_PLUGIN_NAME} finished ${totalErrors ? `with error(s)`  : 'successfully'}`,
                summaryLine2 = `Found macros: ${totalMacros} | Inlined usages: ${totalReplacements} | Errors: ${totalErrors}`,
                hr = '='.repeat(Math.max(summaryLine1.length, summaryLine2.length)),
                summary = `\n\n${hr}\n${summaryLine1}\n${summaryLine2}\n${hr}`;
            console.log(summary);
            if (logFilePath) {
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
            /** @type {Map<number, InlineMacro>} */
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
            lines.forEach((line, lineIndex) => {
                let match = ~line.indexOf(MARKER_COMMENT) && line.match(MACRO_DEFINITION_REGEX);
                if (match) {
                    let [, name, paramsString, body] = match,
                        invocationRegex = new RegExp(`([^a-zA-Z._~$])${name}\\(([^)]*?)\\)`, 'g'), // groups = prefixChar, paramsString
                        params = paramsString.replace(/\s/g,'').split(','),
                        bodyWithPlaceholders = !params.length ? body : params.reduce((body, paramName, i) => {
                            let paramRegex = new RegExp(`([^a-zA-Z._~$])${paramName}([^a-zA-Z_~$])`, 'g');
                            return body.replace(paramRegex, (m, prefix, suffix) => `${prefix}${getParamPlaceholderForIndex(i)}${suffix}`);
                        }, `(${body})`),
                        macro = {name, params, body, bodyWithPlaceholders, invocationRegex};

                    macrosByDefinitionLine.set(lineIndex, macro);
                    LOG(lineIndex, 'Found macro: "%s"', macro.name);
                    totalMacros++;
                }
            });
            
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
                                LOG(lineIndex, `[ERROR] Mismatch macro signature <> invocation: \n -> macro: ${name}\n -> usage: ${line}\n`);
                                totalErrors++;
                                return matchedInvocation;
                            }
                            
                            let replacedInvocation = invPrefixChar + bodyWithPlaceholders;
                            
                            invParams.forEach((paramName, i) => {
                                let placeholderRegex = new RegExp(getParamPlaceholderForIndex(i), 'g');
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
 * @typedef InlineMacro
 * @property {string} name - the function name
 * @property {string[]} params - names of the formal parameters in the function definition
 * @property {string} body - the function body code
 * @property {string} bodyWithPlaceholders - the function body with formal parameters replaced with placeholders,
 *                           e.g. `(foo,bar) => alert(foo + bar)` will have bodyWithPlaceholders `(alert(%0% + %1%))`   
 * @property {RegExp} invocationRegex - the regex to match an invocation
 */
