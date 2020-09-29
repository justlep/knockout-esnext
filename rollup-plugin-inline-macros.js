import {basename} from 'path';

const MARKER_COMMENT = '//@inline';
const MACRO_DEFINITION_REGEX = /^\*?const ([^ ]+?)\s*=\s\(?([^)]*?)\)?\s*=>\s*([^{].*?);?\s*\/\/@inline/;
const SUPPORTED_FILENAMES_REGEX = /\.(?:js|esm|es6)$/i;

const getParamPlaceholderForIndex = (index) => `%${index}%`;

/**
 * A rollup plugin that scans each file for const arrow functions marked with a trailing '//@inline' comment.
 * Invocations of those functions within the same file are then replaced with the actual arrow-function code,
 * much like early Pascal "inline" functions or macros in other languages.  
 * Helpful to keep sources DRY while boosting performance in hot executions paths by saving some function calls.
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
export default function createRollupInlineMacrosPlugin(opts = {verbose: false}) {
    return {
        name: 'arrow-macros',
        transform(code, id) {
            const currentFile = basename(id);
            if (!SUPPORTED_FILENAMES_REGEX.test(currentFile)) {
                return {code, map: null};
            }
            /** @type {Map<number, InlineMacro>} */
            const macrosByDefinitionLine = new Map();
            const LOG = opts.verbose ? (lineIndex, msg, ...args) => console.log(`[${currentFile}:${lineIndex + 1}] ${msg}`, ...args) 
                                     : () => null;
            
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
                    //LOG(lineIndex, 'Found macro: %o', macro);
                    LOG(lineIndex, 'Found macro: %s', macro.name);
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
                        
                        if (isPossibleInvocationLine) {
                            let changedLine = line.replace(invocationRegex, (matchedInvocation, invPrefixChar, invParamsString) => {
                                // FIXME invocations like foo("hey,foo") won't work, but that's ok for now
                                let invParams = invParamsString.split(',').map(s => s.trim());
                                // LOG(lineIndex, `Checking invocation of '${name}'`);
                                if (invParams.length !== params.length) {
                                    LOG(lineIndex, `(!) Mismatch macro signature <> invocation: \n -> macro: ${name}\n -> usage: ${line}\n\n`);
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
                                let iterationString = lineIteration > 1 ? `  [iteration #${lineIteration}]` : '';
                                LOG(lineIndex, `Inlined invocation of ${name}()${iterationString}\nOLD:  ${originalLines[lineIndex].trim()}\nNEW:  ${changedLine.trim()}\n`);
                                line = changedLine;
                                lines[lineIndex] = changedLine;
                                
                                // re-iterate, because macros may be using other macros
                                shouldScanForInvocations = true;
                            }
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
