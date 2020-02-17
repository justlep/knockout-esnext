import {isObservable, isWritableObservable} from '../subscribables/observableUtils';
import {getBindingHandler} from './bindingHandlers';

const JS_RESERVED_WORDS = {'true': true, 'false': true, 'null': true, 'undefined': true};

const PROPERTY_WRITERS_BINDING_KEY = '_ko_property_writers';

/**
 * Matches something that can be assigned to--either an isolated identifier or something ending with a property accessor
 * This is designed to be simple and avoid false negatives, but could produce false positives (e.g., a+b.c).
 * This also will not properly handle nested brackets (e.g., obj1[obj2['prop']]; see #911).
 * */
const JS_ASSIGNMENT_TARGET = /^(?:[$_a-z][$\w]*|(.+)(\.\s*[$_a-z][$\w]*|\[.+]))$/i;

// The following regular expressions will be used to split an object-literal string into tokens

/** These characters have special meaning to the parser and must not appear in the middle of a token, except as part of a string. */
const SPECIALS = ',"\'`{}()/:[\\]';

/** The actual regular expression by or-ing the following regex strings. The order is important. */
const BINDING_TOKEN = RegExp([
    // These match strings, either with double quotes, single quotes, or backticks
    '"(?:\\\\.|[^"])*"',
    "'(?:\\\\.|[^'])*'",
    "`(?:\\\\.|[^`])*`",
    // Match C style comments
    "/\\*(?:[^*]|\\*+[^*/])*\\*+/",
    // Match C++ style comments
    "//.*\n",
    // Match a regular expression (text enclosed by slashes), but will also match sets of divisions
    // as a regular expression (this is handled by the parsing loop below).
    '/(?:\\\\.|[^/])+/\\w*',
    // Match text (at least two characters) that does not contain any of the above special characters,
    // although some of the special characters are allowed to start it (all but the colon and comma).
    // The text can contain spaces, but leading or trailing spaces are skipped.
    '[^\\s:,/][^' + SPECIALS + ']*[^\\s' + SPECIALS + ']',
    // Match any non-space character not matched already. This will match colons and commas, since they're
    // not matched by "everyThingElse", but will also match any other single character that wasn't already
    // matched (for example: in "a: 1, b: 2", each of the non-space characters will be matched by oneNotSpace).
    '[^\\s]'
].join('|'), 'g');

// Match end of previous token to determine whether a slash is a division or regex.
const DIVISION_LOOK_BEHIND = /[\])"'A-Za-z0-9_$]+$/;
const KEYWORD_REGEX_LOOK_BEHIND = {'in': 1, 'return': 1, 'typeof': 1};

export const parseObjectLiteral = (objectLiteralString) => {
    // Trim leading and trailing spaces from the string
    let str = objectLiteralString ? objectLiteralString.trim() : '';

    // Trim braces '{' surrounding the whole object literal
    if (str && str[0] === '{') {
        str = str.slice(1, -1);
    }

    // Add a newline to correctly match a C++ style comment at the end of the string and
    // add a comma so that we don't need a separate code block to deal with the last item
    str += "\n,";

    // Split into tokens
    let result = [],
        tokens = str.match(BINDING_TOKEN);

    if (tokens.length > 1) {
        let depth = 0;
        for (let i = 0, tok, key = null, values = []; tok = tokens[i]; ++i) {
            let c = tok.charCodeAt(0);
            // A comma signals the end of a key/value pair if depth is zero
            if (c === 44) { // ","
                if (depth <= 0) {
                    result.push((key && values.length) ? {key, value: values.join('')} :
                        {unknown: key || values.join('')});
                    key = 0;
                    depth = 0;
                    values = [];
                    continue;
                }
                // Simply skip the colon that separates the name and value
            } else if (c === 58) { // ":"
                if (!depth && !key && values.length === 1) {
                    key = values.pop();
                    continue;
                }
                // Comments: skip them
            } else if (c === 47 && tok.length > 1 && (tok.charCodeAt(1) === 47 || tok.charCodeAt(1) === 42)) {  // "//" or "/*"
                continue;
                // A set of slashes is initially matched as a regular expression, but could be division
            } else if (c === 47 && i && tok.length > 1) {  // "/"
                // Look at the end of the previous token to determine if the slash is actually division
                let match = tokens[i - 1].match(DIVISION_LOOK_BEHIND);
                if (match && !KEYWORD_REGEX_LOOK_BEHIND[match[0]]) {
                    // The slash is actually a division punctuator; re-parse the remainder of the string (not including the slash)
                    str = str.substr(str.indexOf(tok) + 1);
                    tokens = str.match(BINDING_TOKEN);
                    i = -1;
                    // Continue with just the slash
                    tok = '/';
                }
                // Increment depth for parentheses, braces, and brackets so that interior commas are ignored
            } else if (c === 40 || c === 123 || c === 91) { // '(', '{', '['
                ++depth;
            } else if (c === 41 || c === 125 || c === 93) { // ')', '}', ']'
                --depth;
                // The key will be the first token; if it's a string, trim the quotes
            } else if (!key && !values.length && (c === 34 || c === 39)) { // '"', "'"
                tok = tok.slice(1, -1);
            }
            values.push(tok);
        }
        if (depth > 0) {
            throw Error("Unbalanced parentheses, braces, or brackets");
        }
    }
    return result;
};

// Two-way bindings include a write function that allow the handler to update the value even if it's not an observable.
export const twoWayBindings = {};

export const preProcessBindings = (bindingsStringOrKeyValueArray, bindingOptions) => {
    bindingOptions = bindingOptions || {};

    const _processKeyValue = (key, val) => {
        const _callPreprocessHook = (obj) => (obj && obj.preprocess) ? (val = obj.preprocess(val, key, _processKeyValue)) : true;

        if (!bindingParams) {
            if (!_callPreprocessHook(getBindingHandler(key))) {
                return;
            }

            let twoWayBindingsValue = twoWayBindings[key],
                match = twoWayBindingsValue && !JS_RESERVED_WORDS[val] && val.match(JS_ASSIGNMENT_TARGET);
            if (match) {
                let writableVal = match[1] ? ('Object(' + match[1] + ')' + match[2]) : val;
                // For two-way bindings, provide a write method in case the value
                // isn't a writable observable.
                let writeKey = typeof twoWayBindingsValue === 'string' ? twoWayBindingsValue : key;
                propertyAccessorResultStrings.push("'" + writeKey + "':function(_z){" + writableVal + "=_z}");
            }
        }
        // Values are wrapped in a function so that each value can be accessed independently
        if (makeValueAccessors) {
            val = 'function(){return ' + val + ' }';
        }
        resultStrings.push("'" + key + "':" + val);
    };

    let resultStrings = [],
        propertyAccessorResultStrings = [],
        makeValueAccessors = bindingOptions['valueAccessors'],
        bindingParams = bindingOptions['bindingParams'],
        keyValueArray = typeof bindingsStringOrKeyValueArray === "string" ?
            parseObjectLiteral(bindingsStringOrKeyValueArray) : bindingsStringOrKeyValueArray;

    for (let keyValue of keyValueArray) {
        _processKeyValue(keyValue.key || keyValue.unknown, keyValue.value);
    }

    if (propertyAccessorResultStrings.length) {
        _processKeyValue(PROPERTY_WRITERS_BINDING_KEY, "{" + propertyAccessorResultStrings.join(",") + " }");
    }

    return resultStrings.join(",");
};

export const bindingRewriteValidators = [];

export const keyValueArrayContainsKey = (keyValueArray, key) => {
        // unfortunately !!keyValueArray.find(keyVal => keyVal.key === key)` is 10x slower in Chrome 
        for (let i = 0, len = keyValueArray.length; i < len; i++) {
            if (keyValueArray[i].key === key) {
                return true;
            }
        }
        return false;
    };

// Internal, private KO utility for updating model properties from within bindings
// property:            If the property being updated is (or might be) an observable, pass it here
//                      If it turns out to be a writable observable, it will be written to directly
// allBindings:         An object with a get method to retrieve bindings in the current execution context.
//                      This will be searched for a '_ko_property_writers' property in case you're writing to a non-observable
// key:                 The key identifying the property to be written. Example: for { hasFocus: myValue }, write to 'myValue' by specifying the key 'hasFocus'
// value:               The value to be written
// checkIfDifferent:    If true, and if the property being written is a writable observable, the value will only be written if
//                      it is !== existing value on that writable observable
export const writeValueToProperty = (property, allBindings, key, value, checkIfDifferent) => {
    if (!property || !isObservable(property)) {
        let propWriters = allBindings.get(PROPERTY_WRITERS_BINDING_KEY);
        if (propWriters && propWriters[key]) {
            propWriters[key](value);
        }
    } else if (isWritableObservable(property) && (!checkIfDifferent || property.peek() !== value)) {
        property(value);
    }
};

// Making bindings explicitly declare themselves as "two way" isn't ideal in the long term (it would be better if
// all bindings could use an official 'property writer' API without needing to declare that they might). However,
// since this is not, and has never been, a public API (_ko_property_writers was never documented), it's acceptable
// as an internal implementation detail in the short term.
// For those developers who rely on _ko_property_writers in their custom bindings, we expose _twoWayBindings as an
// undocumented feature that makes it relatively easy to upgrade to KO 3.0. However, this is still not an official
// public API, and we reserve the right to remove it at any time if we create a real public property writers API.
export const _twoWayBindings = twoWayBindings;

// alias For backward compatibility (see 'ko.jsonExpressionRewriting' alias below)
// TODO removed, add to documentation
// export const insertPropertyAccessorsIntoJson = preProcessBindings;
