(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
(function (global){
'use strict';

// compare and isBuffer taken from https://github.com/feross/buffer/blob/680e9e5e488f22aac27599a57dc844a6315928dd/index.js
// original notice:

/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */
function compare(a, b) {
  if (a === b) {
    return 0;
  }

  var x = a.length;
  var y = b.length;

  for (var i = 0, len = Math.min(x, y); i < len; ++i) {
    if (a[i] !== b[i]) {
      x = a[i];
      y = b[i];
      break;
    }
  }

  if (x < y) {
    return -1;
  }
  if (y < x) {
    return 1;
  }
  return 0;
}
function isBuffer(b) {
  if (global.Buffer && typeof global.Buffer.isBuffer === 'function') {
    return global.Buffer.isBuffer(b);
  }
  return !!(b != null && b._isBuffer);
}

// based on node assert, original notice:

// http://wiki.commonjs.org/wiki/Unit_Testing/1.0
//
// THIS IS NOT TESTED NOR LIKELY TO WORK OUTSIDE V8!
//
// Originally from narwhal.js (http://narwhaljs.org)
// Copyright (c) 2009 Thomas Robinson <280north.com>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the 'Software'), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
// ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

var util = require('util/');
var hasOwn = Object.prototype.hasOwnProperty;
var pSlice = Array.prototype.slice;
var functionsHaveNames = (function () {
  return function foo() {}.name === 'foo';
}());
function pToString (obj) {
  return Object.prototype.toString.call(obj);
}
function isView(arrbuf) {
  if (isBuffer(arrbuf)) {
    return false;
  }
  if (typeof global.ArrayBuffer !== 'function') {
    return false;
  }
  if (typeof ArrayBuffer.isView === 'function') {
    return ArrayBuffer.isView(arrbuf);
  }
  if (!arrbuf) {
    return false;
  }
  if (arrbuf instanceof DataView) {
    return true;
  }
  if (arrbuf.buffer && arrbuf.buffer instanceof ArrayBuffer) {
    return true;
  }
  return false;
}
// 1. The assert module provides functions that throw
// AssertionError's when particular conditions are not met. The
// assert module must conform to the following interface.

var assert = module.exports = ok;

// 2. The AssertionError is defined in assert.
// new assert.AssertionError({ message: message,
//                             actual: actual,
//                             expected: expected })

var regex = /\s*function\s+([^\(\s]*)\s*/;
// based on https://github.com/ljharb/function.prototype.name/blob/adeeeec8bfcc6068b187d7d9fb3d5bb1d3a30899/implementation.js
function getName(func) {
  if (!util.isFunction(func)) {
    return;
  }
  if (functionsHaveNames) {
    return func.name;
  }
  var str = func.toString();
  var match = str.match(regex);
  return match && match[1];
}
assert.AssertionError = function AssertionError(options) {
  this.name = 'AssertionError';
  this.actual = options.actual;
  this.expected = options.expected;
  this.operator = options.operator;
  if (options.message) {
    this.message = options.message;
    this.generatedMessage = false;
  } else {
    this.message = getMessage(this);
    this.generatedMessage = true;
  }
  var stackStartFunction = options.stackStartFunction || fail;
  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, stackStartFunction);
  } else {
    // non v8 browsers so we can have a stacktrace
    var err = new Error();
    if (err.stack) {
      var out = err.stack;

      // try to strip useless frames
      var fn_name = getName(stackStartFunction);
      var idx = out.indexOf('\n' + fn_name);
      if (idx >= 0) {
        // once we have located the function frame
        // we need to strip out everything before it (and its line)
        var next_line = out.indexOf('\n', idx + 1);
        out = out.substring(next_line + 1);
      }

      this.stack = out;
    }
  }
};

// assert.AssertionError instanceof Error
util.inherits(assert.AssertionError, Error);

function truncate(s, n) {
  if (typeof s === 'string') {
    return s.length < n ? s : s.slice(0, n);
  } else {
    return s;
  }
}
function inspect(something) {
  if (functionsHaveNames || !util.isFunction(something)) {
    return util.inspect(something);
  }
  var rawname = getName(something);
  var name = rawname ? ': ' + rawname : '';
  return '[Function' +  name + ']';
}
function getMessage(self) {
  return truncate(inspect(self.actual), 128) + ' ' +
         self.operator + ' ' +
         truncate(inspect(self.expected), 128);
}

// At present only the three keys mentioned above are used and
// understood by the spec. Implementations or sub modules can pass
// other keys to the AssertionError's constructor - they will be
// ignored.

// 3. All of the following functions must throw an AssertionError
// when a corresponding condition is not met, with a message that
// may be undefined if not provided.  All assertion methods provide
// both the actual and expected values to the assertion error for
// display purposes.

function fail(actual, expected, message, operator, stackStartFunction) {
  throw new assert.AssertionError({
    message: message,
    actual: actual,
    expected: expected,
    operator: operator,
    stackStartFunction: stackStartFunction
  });
}

// EXTENSION! allows for well behaved errors defined elsewhere.
assert.fail = fail;

// 4. Pure assertion tests whether a value is truthy, as determined
// by !!guard.
// assert.ok(guard, message_opt);
// This statement is equivalent to assert.equal(true, !!guard,
// message_opt);. To test strictly for the value true, use
// assert.strictEqual(true, guard, message_opt);.

function ok(value, message) {
  if (!value) fail(value, true, message, '==', assert.ok);
}
assert.ok = ok;

// 5. The equality assertion tests shallow, coercive equality with
// ==.
// assert.equal(actual, expected, message_opt);

assert.equal = function equal(actual, expected, message) {
  if (actual != expected) fail(actual, expected, message, '==', assert.equal);
};

// 6. The non-equality assertion tests for whether two objects are not equal
// with != assert.notEqual(actual, expected, message_opt);

assert.notEqual = function notEqual(actual, expected, message) {
  if (actual == expected) {
    fail(actual, expected, message, '!=', assert.notEqual);
  }
};

// 7. The equivalence assertion tests a deep equality relation.
// assert.deepEqual(actual, expected, message_opt);

assert.deepEqual = function deepEqual(actual, expected, message) {
  if (!_deepEqual(actual, expected, false)) {
    fail(actual, expected, message, 'deepEqual', assert.deepEqual);
  }
};

assert.deepStrictEqual = function deepStrictEqual(actual, expected, message) {
  if (!_deepEqual(actual, expected, true)) {
    fail(actual, expected, message, 'deepStrictEqual', assert.deepStrictEqual);
  }
};

function _deepEqual(actual, expected, strict, memos) {
  // 7.1. All identical values are equivalent, as determined by ===.
  if (actual === expected) {
    return true;
  } else if (isBuffer(actual) && isBuffer(expected)) {
    return compare(actual, expected) === 0;

  // 7.2. If the expected value is a Date object, the actual value is
  // equivalent if it is also a Date object that refers to the same time.
  } else if (util.isDate(actual) && util.isDate(expected)) {
    return actual.getTime() === expected.getTime();

  // 7.3 If the expected value is a RegExp object, the actual value is
  // equivalent if it is also a RegExp object with the same source and
  // properties (`global`, `multiline`, `lastIndex`, `ignoreCase`).
  } else if (util.isRegExp(actual) && util.isRegExp(expected)) {
    return actual.source === expected.source &&
           actual.global === expected.global &&
           actual.multiline === expected.multiline &&
           actual.lastIndex === expected.lastIndex &&
           actual.ignoreCase === expected.ignoreCase;

  // 7.4. Other pairs that do not both pass typeof value == 'object',
  // equivalence is determined by ==.
  } else if ((actual === null || typeof actual !== 'object') &&
             (expected === null || typeof expected !== 'object')) {
    return strict ? actual === expected : actual == expected;

  // If both values are instances of typed arrays, wrap their underlying
  // ArrayBuffers in a Buffer each to increase performance
  // This optimization requires the arrays to have the same type as checked by
  // Object.prototype.toString (aka pToString). Never perform binary
  // comparisons for Float*Arrays, though, since e.g. +0 === -0 but their
  // bit patterns are not identical.
  } else if (isView(actual) && isView(expected) &&
             pToString(actual) === pToString(expected) &&
             !(actual instanceof Float32Array ||
               actual instanceof Float64Array)) {
    return compare(new Uint8Array(actual.buffer),
                   new Uint8Array(expected.buffer)) === 0;

  // 7.5 For all other Object pairs, including Array objects, equivalence is
  // determined by having the same number of owned properties (as verified
  // with Object.prototype.hasOwnProperty.call), the same set of keys
  // (although not necessarily the same order), equivalent values for every
  // corresponding key, and an identical 'prototype' property. Note: this
  // accounts for both named and indexed properties on Arrays.
  } else if (isBuffer(actual) !== isBuffer(expected)) {
    return false;
  } else {
    memos = memos || {actual: [], expected: []};

    var actualIndex = memos.actual.indexOf(actual);
    if (actualIndex !== -1) {
      if (actualIndex === memos.expected.indexOf(expected)) {
        return true;
      }
    }

    memos.actual.push(actual);
    memos.expected.push(expected);

    return objEquiv(actual, expected, strict, memos);
  }
}

function isArguments(object) {
  return Object.prototype.toString.call(object) == '[object Arguments]';
}

function objEquiv(a, b, strict, actualVisitedObjects) {
  if (a === null || a === undefined || b === null || b === undefined)
    return false;
  // if one is a primitive, the other must be same
  if (util.isPrimitive(a) || util.isPrimitive(b))
    return a === b;
  if (strict && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b))
    return false;
  var aIsArgs = isArguments(a);
  var bIsArgs = isArguments(b);
  if ((aIsArgs && !bIsArgs) || (!aIsArgs && bIsArgs))
    return false;
  if (aIsArgs) {
    a = pSlice.call(a);
    b = pSlice.call(b);
    return _deepEqual(a, b, strict);
  }
  var ka = objectKeys(a);
  var kb = objectKeys(b);
  var key, i;
  // having the same number of owned properties (keys incorporates
  // hasOwnProperty)
  if (ka.length !== kb.length)
    return false;
  //the same set of keys (although not necessarily the same order),
  ka.sort();
  kb.sort();
  //~~~cheap key test
  for (i = ka.length - 1; i >= 0; i--) {
    if (ka[i] !== kb[i])
      return false;
  }
  //equivalent values for every corresponding key, and
  //~~~possibly expensive deep test
  for (i = ka.length - 1; i >= 0; i--) {
    key = ka[i];
    if (!_deepEqual(a[key], b[key], strict, actualVisitedObjects))
      return false;
  }
  return true;
}

// 8. The non-equivalence assertion tests for any deep inequality.
// assert.notDeepEqual(actual, expected, message_opt);

assert.notDeepEqual = function notDeepEqual(actual, expected, message) {
  if (_deepEqual(actual, expected, false)) {
    fail(actual, expected, message, 'notDeepEqual', assert.notDeepEqual);
  }
};

assert.notDeepStrictEqual = notDeepStrictEqual;
function notDeepStrictEqual(actual, expected, message) {
  if (_deepEqual(actual, expected, true)) {
    fail(actual, expected, message, 'notDeepStrictEqual', notDeepStrictEqual);
  }
}


// 9. The strict equality assertion tests strict equality, as determined by ===.
// assert.strictEqual(actual, expected, message_opt);

assert.strictEqual = function strictEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(actual, expected, message, '===', assert.strictEqual);
  }
};

// 10. The strict non-equality assertion tests for strict inequality, as
// determined by !==.  assert.notStrictEqual(actual, expected, message_opt);

assert.notStrictEqual = function notStrictEqual(actual, expected, message) {
  if (actual === expected) {
    fail(actual, expected, message, '!==', assert.notStrictEqual);
  }
};

function expectedException(actual, expected) {
  if (!actual || !expected) {
    return false;
  }

  if (Object.prototype.toString.call(expected) == '[object RegExp]') {
    return expected.test(actual);
  }

  try {
    if (actual instanceof expected) {
      return true;
    }
  } catch (e) {
    // Ignore.  The instanceof check doesn't work for arrow functions.
  }

  if (Error.isPrototypeOf(expected)) {
    return false;
  }

  return expected.call({}, actual) === true;
}

function _tryBlock(block) {
  var error;
  try {
    block();
  } catch (e) {
    error = e;
  }
  return error;
}

function _throws(shouldThrow, block, expected, message) {
  var actual;

  if (typeof block !== 'function') {
    throw new TypeError('"block" argument must be a function');
  }

  if (typeof expected === 'string') {
    message = expected;
    expected = null;
  }

  actual = _tryBlock(block);

  message = (expected && expected.name ? ' (' + expected.name + ').' : '.') +
            (message ? ' ' + message : '.');

  if (shouldThrow && !actual) {
    fail(actual, expected, 'Missing expected exception' + message);
  }

  var userProvidedMessage = typeof message === 'string';
  var isUnwantedException = !shouldThrow && util.isError(actual);
  var isUnexpectedException = !shouldThrow && actual && !expected;

  if ((isUnwantedException &&
      userProvidedMessage &&
      expectedException(actual, expected)) ||
      isUnexpectedException) {
    fail(actual, expected, 'Got unwanted exception' + message);
  }

  if ((shouldThrow && actual && expected &&
      !expectedException(actual, expected)) || (!shouldThrow && actual)) {
    throw actual;
  }
}

// 11. Expected to throw an error:
// assert.throws(block, Error_opt, message_opt);

assert.throws = function(block, /*optional*/error, /*optional*/message) {
  _throws(true, block, error, message);
};

// EXTENSION! This is annoying to write outside this module.
assert.doesNotThrow = function(block, /*optional*/error, /*optional*/message) {
  _throws(false, block, error, message);
};

assert.ifError = function(err) { if (err) throw err; };

var objectKeys = Object.keys || function (obj) {
  var keys = [];
  for (var key in obj) {
    if (hasOwn.call(obj, key)) keys.push(key);
  }
  return keys;
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"util/":4}],2:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],3:[function(require,module,exports){
module.exports = function isBuffer(arg) {
  return arg && typeof arg === 'object'
    && typeof arg.copy === 'function'
    && typeof arg.fill === 'function'
    && typeof arg.readUInt8 === 'function';
}
},{}],4:[function(require,module,exports){
(function (process,global){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (!isString(f)) {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j':
        try {
          return JSON.stringify(args[i++]);
        } catch (_) {
          return '[Circular]';
        }
      default:
        return x;
    }
  });
  for (var x = args[i]; i < len; x = args[++i]) {
    if (isNull(x) || !isObject(x)) {
      str += ' ' + x;
    } else {
      str += ' ' + inspect(x);
    }
  }
  return str;
};


// Mark that a method should not be used.
// Returns a modified function which warns once by default.
// If --no-deprecation is set, then it is a no-op.
exports.deprecate = function(fn, msg) {
  // Allow for deprecating things in the process of starting up.
  if (isUndefined(global.process)) {
    return function() {
      return exports.deprecate(fn, msg).apply(this, arguments);
    };
  }

  if (process.noDeprecation === true) {
    return fn;
  }

  var warned = false;
  function deprecated() {
    if (!warned) {
      if (process.throwDeprecation) {
        throw new Error(msg);
      } else if (process.traceDeprecation) {
        console.trace(msg);
      } else {
        console.error(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }

  return deprecated;
};


var debugs = {};
var debugEnviron;
exports.debuglog = function(set) {
  if (isUndefined(debugEnviron))
    debugEnviron = process.env.NODE_DEBUG || '';
  set = set.toUpperCase();
  if (!debugs[set]) {
    if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
      var pid = process.pid;
      debugs[set] = function() {
        var msg = exports.format.apply(exports, arguments);
        console.error('%s %d: %s', set, pid, msg);
      };
    } else {
      debugs[set] = function() {};
    }
  }
  return debugs[set];
};


/**
 * Echos the value of a value. Trys to print the value out
 * in the best way possible given the different types.
 *
 * @param {Object} obj The object to print out.
 * @param {Object} opts Optional options object that alters the output.
 */
/* legacy: obj, showHidden, depth, colors*/
function inspect(obj, opts) {
  // default options
  var ctx = {
    seen: [],
    stylize: stylizeNoColor
  };
  // legacy...
  if (arguments.length >= 3) ctx.depth = arguments[2];
  if (arguments.length >= 4) ctx.colors = arguments[3];
  if (isBoolean(opts)) {
    // legacy...
    ctx.showHidden = opts;
  } else if (opts) {
    // got an "options" object
    exports._extend(ctx, opts);
  }
  // set default options
  if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
  if (isUndefined(ctx.depth)) ctx.depth = 2;
  if (isUndefined(ctx.colors)) ctx.colors = false;
  if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
  if (ctx.colors) ctx.stylize = stylizeWithColor;
  return formatValue(ctx, obj, ctx.depth);
}
exports.inspect = inspect;


// http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
inspect.colors = {
  'bold' : [1, 22],
  'italic' : [3, 23],
  'underline' : [4, 24],
  'inverse' : [7, 27],
  'white' : [37, 39],
  'grey' : [90, 39],
  'black' : [30, 39],
  'blue' : [34, 39],
  'cyan' : [36, 39],
  'green' : [32, 39],
  'magenta' : [35, 39],
  'red' : [31, 39],
  'yellow' : [33, 39]
};

// Don't use 'blue' not visible on cmd.exe
inspect.styles = {
  'special': 'cyan',
  'number': 'yellow',
  'boolean': 'yellow',
  'undefined': 'grey',
  'null': 'bold',
  'string': 'green',
  'date': 'magenta',
  // "name": intentionally not styling
  'regexp': 'red'
};


function stylizeWithColor(str, styleType) {
  var style = inspect.styles[styleType];

  if (style) {
    return '\u001b[' + inspect.colors[style][0] + 'm' + str +
           '\u001b[' + inspect.colors[style][1] + 'm';
  } else {
    return str;
  }
}


function stylizeNoColor(str, styleType) {
  return str;
}


function arrayToHash(array) {
  var hash = {};

  array.forEach(function(val, idx) {
    hash[val] = true;
  });

  return hash;
}


function formatValue(ctx, value, recurseTimes) {
  // Provide a hook for user-specified inspect functions.
  // Check that value is an object with an inspect function on it
  if (ctx.customInspect &&
      value &&
      isFunction(value.inspect) &&
      // Filter out the util module, it's inspect function is special
      value.inspect !== exports.inspect &&
      // Also filter out any prototype objects using the circular check.
      !(value.constructor && value.constructor.prototype === value)) {
    var ret = value.inspect(recurseTimes, ctx);
    if (!isString(ret)) {
      ret = formatValue(ctx, ret, recurseTimes);
    }
    return ret;
  }

  // Primitive types cannot have properties
  var primitive = formatPrimitive(ctx, value);
  if (primitive) {
    return primitive;
  }

  // Look up the keys of the object.
  var keys = Object.keys(value);
  var visibleKeys = arrayToHash(keys);

  if (ctx.showHidden) {
    keys = Object.getOwnPropertyNames(value);
  }

  // IE doesn't make error fields non-enumerable
  // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
  if (isError(value)
      && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
    return formatError(value);
  }

  // Some type of object without properties can be shortcutted.
  if (keys.length === 0) {
    if (isFunction(value)) {
      var name = value.name ? ': ' + value.name : '';
      return ctx.stylize('[Function' + name + ']', 'special');
    }
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    }
    if (isDate(value)) {
      return ctx.stylize(Date.prototype.toString.call(value), 'date');
    }
    if (isError(value)) {
      return formatError(value);
    }
  }

  var base = '', array = false, braces = ['{', '}'];

  // Make Array say that they are Array
  if (isArray(value)) {
    array = true;
    braces = ['[', ']'];
  }

  // Make functions say that they are functions
  if (isFunction(value)) {
    var n = value.name ? ': ' + value.name : '';
    base = ' [Function' + n + ']';
  }

  // Make RegExps say that they are RegExps
  if (isRegExp(value)) {
    base = ' ' + RegExp.prototype.toString.call(value);
  }

  // Make dates with properties first say the date
  if (isDate(value)) {
    base = ' ' + Date.prototype.toUTCString.call(value);
  }

  // Make error with message first say the error
  if (isError(value)) {
    base = ' ' + formatError(value);
  }

  if (keys.length === 0 && (!array || value.length == 0)) {
    return braces[0] + base + braces[1];
  }

  if (recurseTimes < 0) {
    if (isRegExp(value)) {
      return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
    } else {
      return ctx.stylize('[Object]', 'special');
    }
  }

  ctx.seen.push(value);

  var output;
  if (array) {
    output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
  } else {
    output = keys.map(function(key) {
      return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
    });
  }

  ctx.seen.pop();

  return reduceToSingleString(output, base, braces);
}


function formatPrimitive(ctx, value) {
  if (isUndefined(value))
    return ctx.stylize('undefined', 'undefined');
  if (isString(value)) {
    var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                             .replace(/'/g, "\\'")
                                             .replace(/\\"/g, '"') + '\'';
    return ctx.stylize(simple, 'string');
  }
  if (isNumber(value))
    return ctx.stylize('' + value, 'number');
  if (isBoolean(value))
    return ctx.stylize('' + value, 'boolean');
  // For some reason typeof null is "object", so special case here.
  if (isNull(value))
    return ctx.stylize('null', 'null');
}


function formatError(value) {
  return '[' + Error.prototype.toString.call(value) + ']';
}


function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
  var output = [];
  for (var i = 0, l = value.length; i < l; ++i) {
    if (hasOwnProperty(value, String(i))) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          String(i), true));
    } else {
      output.push('');
    }
  }
  keys.forEach(function(key) {
    if (!key.match(/^\d+$/)) {
      output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
          key, true));
    }
  });
  return output;
}


function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
  var name, str, desc;
  desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
  if (desc.get) {
    if (desc.set) {
      str = ctx.stylize('[Getter/Setter]', 'special');
    } else {
      str = ctx.stylize('[Getter]', 'special');
    }
  } else {
    if (desc.set) {
      str = ctx.stylize('[Setter]', 'special');
    }
  }
  if (!hasOwnProperty(visibleKeys, key)) {
    name = '[' + key + ']';
  }
  if (!str) {
    if (ctx.seen.indexOf(desc.value) < 0) {
      if (isNull(recurseTimes)) {
        str = formatValue(ctx, desc.value, null);
      } else {
        str = formatValue(ctx, desc.value, recurseTimes - 1);
      }
      if (str.indexOf('\n') > -1) {
        if (array) {
          str = str.split('\n').map(function(line) {
            return '  ' + line;
          }).join('\n').substr(2);
        } else {
          str = '\n' + str.split('\n').map(function(line) {
            return '   ' + line;
          }).join('\n');
        }
      }
    } else {
      str = ctx.stylize('[Circular]', 'special');
    }
  }
  if (isUndefined(name)) {
    if (array && key.match(/^\d+$/)) {
      return str;
    }
    name = JSON.stringify('' + key);
    if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
      name = name.substr(1, name.length - 2);
      name = ctx.stylize(name, 'name');
    } else {
      name = name.replace(/'/g, "\\'")
                 .replace(/\\"/g, '"')
                 .replace(/(^"|"$)/g, "'");
      name = ctx.stylize(name, 'string');
    }
  }

  return name + ': ' + str;
}


function reduceToSingleString(output, base, braces) {
  var numLinesEst = 0;
  var length = output.reduce(function(prev, cur) {
    numLinesEst++;
    if (cur.indexOf('\n') >= 0) numLinesEst++;
    return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
  }, 0);

  if (length > 60) {
    return braces[0] +
           (base === '' ? '' : base + '\n ') +
           ' ' +
           output.join(',\n  ') +
           ' ' +
           braces[1];
  }

  return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
}


// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

exports.isBuffer = require('./support/isBuffer');

function objectToString(o) {
  return Object.prototype.toString.call(o);
}


function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}


var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}


// log is just a thin wrapper to console.log that prepends a timestamp
exports.log = function() {
  console.log('%s - %s', timestamp(), exports.format.apply(exports, arguments));
};


/**
 * Inherit the prototype methods from one constructor into another.
 *
 * The Function.prototype.inherits from lang.js rewritten as a standalone
 * function (not on Function.prototype). NOTE: If this file is to be loaded
 * during bootstrapping this function needs to be rewritten using some native
 * functions as prototype setup using normal JavaScript does not work as
 * expected during bootstrapping (see mirror.js in r114903).
 *
 * @param {function} ctor Constructor function which needs to inherit the
 *     prototype.
 * @param {function} superCtor Constructor function to inherit prototype from.
 */
exports.inherits = require('inherits');

exports._extend = function(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || !isObject(add)) return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
};

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

}).call(this,require('_process'),typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./support/isBuffer":3,"_process":7,"inherits":2}],5:[function(require,module,exports){

},{}],6:[function(require,module,exports){
arguments[4][2][0].apply(exports,arguments)
},{"dup":2}],7:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;
process.prependListener = noop;
process.prependOnceListener = noop;

process.listeners = function (name) { return [] }

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],8:[function(require,module,exports){
arguments[4][3][0].apply(exports,arguments)
},{"dup":3}],9:[function(require,module,exports){
arguments[4][4][0].apply(exports,arguments)
},{"./support/isBuffer":8,"_process":7,"dup":4,"inherits":6}],10:[function(require,module,exports){
const assert = require('assert');

const parseXY = k => {
  const split = k.split(',');
  return {x: split[0] | 0, y: split[1] | 0};
};

exports.fromData = function fromData(grid) {
  if (!grid) {
    return Promise.resolve({base:{}, shuttles:{}, offx: 0, offy: 0, w: 0, h:0});
  } if (grid.img) {
    // Its an image!
    return imageToJSON(grid);
  } else {
    return Promise.resolve(grid);
  }
}

exports.toData = function toData(grid) {
  // checkConversion(grid);

  const json = JSONToImage(grid);
  // console.log("saving " + result.length + " bytes");
  return json;
}

function isEmpty(obj) {
  for (var k in obj) return false;
  return true;
};

const VTOI = {};
const ITOV = [
  'solid', // 0
  'nothing', 'thinsolid', // 1, 2
  'positive', 'negative', // 3, 4
  'bridge', // 5
  'ribbon', 'ribbonbridge' // 6, 7
];

ITOV[64] = 'shuttle';
ITOV[128] = 'thinshuttle';

(() => {
  for (let i = 0; i < 16; i++) {
    ITOV[i + 32] = "ins" + (i+1); // 32 to 63.
  }
  ITOV.forEach((v, i) => {VTOI[v] = i;});
})();

function normalizeShuttle(sv) {
  return sv == null ? 0 :
    typeof(sv) === 'string' ? (VTOI[sv] | 0b1111) :
    sv;
}

function imageToJSON(data) {
  const legacy = require('./db_legacy');
  switch(data.v) {
    case null: case undefined:
      // Probably not needed except during migration from old data.
      return legacy.imageToJSONv1(data);
    case 2:
      return imageToJSONv2(data);
    default:
      throw Error(`Cannot parse v${data.v} world data with this version of boilerplate`);
  }
}

function imageToJSONv2({img, offx, offy}) {
  return new Promise((resolve, reject) => {
    const image = new Image;
    image.src = img;

    image.onload = function() {
      // var b, canvas, ctx, data, h, i, imageData, j, k, len, ref, ref1, sv, v, w, x, x0, y;
      // console.log('loaded');
      const canvas = document.createElement('canvas');
      const w = canvas.width = image.width;
      const h = canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;
      // console.log(imageData.data);

      // console.log(w, h, offx, offy);

      const grid = {
        base: {},
        shuttles: {},
        w, h, offx, offy
      };

      for (let i = 0; i < data.length; i += 4) {
        // Unpack the index.
        const idx = i/4;
        const x = idx % w;
        const y = (idx / w)|0;

        const v = ITOV[data[i]];
        const sv = data[i+1];
        if (v !== 'solid') {
          const k = `${x+offx},${y+offy}`;
          grid.base[k] = v;
          if (sv !== 0) {
            grid.shuttles[k] = sv;
          }
        }
      }
      resolve(grid);
    };
    image.onerror = function(e) {
      reject(e);
    };
  });
}

function JSONToImage(grid) {
  if (isEmpty(grid.base)) {
    return {base:{}, shuttles:{}}; // Its a bit gross doing this here.
  }

  const MAX = Number.MAX_SAFE_INTEGER;
  let l = MAX, r = -MAX, t = MAX, b = -MAX;
  for (let k in grid.base) {
    const xy = parseXY(k), x = xy.x, y = xy.y;
    if (x < l) l = x;
    if (x > r) r = x;
    if (y < t) t = y;
    if (y > b) b = y;
  }

  const w = r - l + 1;
  const h = b - t + 1;

  // console.log(w, h);

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(w, h);

  const data = imageData.data;
  // Make the image opaque.
  for (let i = 3; i < data.length; i += 4) data[i] = 255;

  for (let k in grid.base) {
    const v = grid.base[k];
    const sv = grid.shuttles[k];

    const xy = parseXY(k)
    const x = xy.x - l, y = xy.y - t;

    const offs = (x + y * w) * 4

    // Red channel for base, green channel for shuttles.
    data[offs] = VTOI[v];
    data[offs+1] = normalizeShuttle(sv);
  }

  // console.log(imageData.data);
  ctx.putImageData(imageData, 0, 0);

  // window.location = canvas.toDataURL();

  return {
    v: 2,
    offx: l,
    offy: t,
    img: canvas.toDataURL()
  };
}

function checkConversion(grid) {
  const data = JSONToImage(grid);
  imageToJSON(data).then((result) => {
    // console.log(grid);
    // console.log(result);

    for (let k in grid.base) {
      const v = grid.base[k], v2 = result.base[k];
      if (v2 !== v) console.log("WHOA! at " + k + " " + v + " " + v2);
    }
    for (let k in grid.shuttles) {
      const v = grid.shuttles[k], v2 = result.shuttles[k];
      if (v2 !== v) console.log("WHOA! at " + k + " " + v + " " + v2);
    }
    assert.deepEqual(grid.img, result.img);
  }).catch(e => {
    throw e;
  });
}

},{"./db_legacy":11,"assert":1}],11:[function(require,module,exports){
const assert = require('assert');

const VTOI = {};
const ITOV = [
  'solid', // 0
  'nothing', 'thinsolid', // 1, 2
  'positive', 'negative', // 3, 4
  'bridge', // 5
  'ribbon', 'ribbonbridge' // 6, 7
];

ITOV[64] = 'shuttle';
ITOV[128] = 'thinshuttle';

(() => {
  for (let i = 0; i < 16; i++) {
    ITOV[i + 32] = "ins" + (i+1); // 32 to 63.
  }
  ITOV.forEach((v, i) => {VTOI[v] = i;});
})();

// Convert back from a byte to [value, shuttle value].
function fromByte(b) {
  const sv = (b & VTOI.shuttle) ? 'shuttle' :
    (b & VTOI.thinshuttle) ? 'thinshuttle' : null;
  const v = ITOV[b & 0x3f];

  assert(v != null);
  return [v, sv];
};

// Version 1 of the imageToJSON function.
exports.imageToJSONv1 = function imageToJSONv1({img, offx, offy}) {
  return new Promise((resolve, reject) => {
    const image = new Image;
    image.src = img;

    image.onload = function() {
      // var b, canvas, ctx, data, h, i, imageData, j, k, len, ref, ref1, sv, v, w, x, x0, y;
      // console.log('loaded');
      const canvas = document.createElement('canvas');
      const w = canvas.width = image.width;
      const h = canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;
      // console.log(imageData.data);

      // console.log(w * 3, h, offx, offy);

      const grid = {
        base: {},
        shuttles: {},
        w, h, offx, offy
      };

      for (let i = 0; i < data.length; i++) {
        if (i % 4 === 3) continue; // The image is opaque. No data there.

        const b = data[i];
        // Unpack the index.
        // Past-me is a mystical space wizard.
        const x0 = i % (w * 4);
        const x = x0 - (x0 - (x0 % 4)) / 4;
        const y = (i / (w * 4)) | 0;

        const _ = fromByte(b), v = _[0], sv = _[1];
        if (v !== 'solid') {
          const k = (x + offx) + "," + (y + offy);
          grid.base[k] = v;
          if (sv) {
            grid.shuttles[k] = sv;
          }
        }
      }
      resolve(grid);
    };
    image.onerror = function(e) {
      reject(e);
    };
  });
};

},{"assert":1}],12:[function(require,module,exports){
// This is the code that powers the fullscreen boilerplate container found in
//the browser/ directory. Boilerplate itself should be able to run in an inlined
// context as well (inside a page element), so code that assumes there's only
//one bp instance is out here.

require('isomorphic-fetch');

const util = require('boilerplate-jit').util;
const Boilerplate = require('../lib/boilerplate');
const modules = require('./modules');
const db = require('./db');

window.util = util;
var readonly = false;

// It might be worth moving to some little view library for all this. Maybe?
const el = document.getElementById('bp');

const playpausebutton = document.getElementById('playpause');
const stepbutton = document.getElementById('step');
const worldNameLabel = document.getElementById('worldname');

var worldName = null;
(() => {
  const parts = location.pathname.split('/');
  const user = decodeURIComponent(parts[parts.length - 2]);
  const key = decodeURIComponent(parts[parts.length - 1]);
  worldName = `${user}/${key}`;
  worldNameLabel.textContent = worldName;
})();

const loadGrid = () => {
  // We'll actually just fire a request straight at the same URL as the one
  // we're on.
  const path = location.pathname + '.json';
  console.log("loading from " + path);

  // Load from either version of data, preferring new if they both exist.
  // We'll only save back to the new data slots in local storage.

  return fetch(path, {
    headers: {'Accept': 'application/json'},
    credentials: 'same-origin'
  })
  .then(res => (res.status === 404) ? {} : res.json())
  .then(grid => {
    if (grid && grid.readonly) {
      document.getElementById('readonly').style.display = 'inline'
    }
    readonly = !!grid.readonly;
    document.title = `${worldName} - Steamdance`;

    return db.fromData(grid.data)
  });
};

const bpromise = loadGrid().then(grid => {
  const bp = window.bp = new Boilerplate(el, {
    grid: grid,
    animTime: 200,

    // initialZoom: 0.1375,
    // initialX: -178.6,
    // initialY: -26.5,
  });
  el.focus();
  bp.addKeyListener(window);

  if (grid.w && grid.w > 30) { // Start looking at the whole world.
    bp.view.fit(grid.w, grid.h, grid.offx||0, grid.offy||0);
  }

  return bp;
});

var running = false;
var timer = null;
var unsavedMovement = false;

const setRunning = v => {
  document.getElementById('playpanel').className = v ? 'running' : 'stopped';
  if (running !== v) {
    running = v;
    if (v) {
      playpausebutton.textContent = '||';
      timer = setInterval(() => {
        bpromise.then(bp => unsavedMovement |= bp.step());
      }, 200);
    } else {
      playpausebutton.textContent = '►';
      clearInterval(timer);
    }
  }
};

const autoplay = window.location.hash === '#play'
setRunning(autoplay);

const isEmpty = (obj) => {
  for (var k in obj) return false;
  return true;
};

const saveNow = () => bpromise.then(bp => {
  if (readonly) return;
  const grid = bp.getJSONGrid();
  const empty = isEmpty(grid.base) && isEmpty(grid.shuttles);
  if (empty) console.log('removing');

  return fetch(location.pathname + '.json', {
    method: empty ? 'DELETE' : 'PUT',
    headers: {'Content-Type': 'application/json'},
    credentials: 'same-origin',
    body: empty ? null : JSON.stringify({
      data: db.toData(grid),
    })
  }).catch(err => console.error(err));
  // localStorage.setItem("worldv2 " + worldName, db.toString(grid));
});

const save = (() => {
  if (readonly) return;
  // Rate limit saving to once every two seconds
  const DELAY = 0;
  var last = 0, timer = -1;
  return () => {
    const now = Date.now();
    if (now - last > DELAY) {
      saveNow();
      last = now;
    } else {
      // Set a timer.
      if (timer === -1) timer = setTimeout(() => {
        saveNow();
        timer = -1;
        last = Date.now();
      }, last + DELAY - now);
    }
  }
})();

// Save every 15 seconds, or when an edit is made.
bpromise.then(bp => {
  bp.onEditFinish = save;
  // Save every 15 seconds while the world is turning.
  setInterval(() => {
    if (unsavedMovement) {
      save();
      unsavedMovement = false;
    }
  }, 15000);
});

window.addEventListener('keypress', e => {
  // console.log(e.keyCode, e.key, e.which);

  // Space - which doesn't work with e.keyCode on firefox. :p
  if (e.keyCode === 32 || e.which === 32) {
    setRunning(!running);
  }
  switch (e.keyCode) {
    case 13: // Enter. Step the world while we're paused.
      bpromise.then(bp => bp.step()); break;
  }
});

window.onresize = () => bpromise.then(bp => {
  bp.resizeTo(window.innerWidth, window.innerHeight);
});

playpausebutton.onclick = e => setRunning(!running);

stepbutton.onclick = e => bpromise.then(bp => {
  bp.step();
});

// Tool panel.
bpromise.then(bp => {
  const panel = document.getElementsByClassName('toolpanel')[0];

  var selected = null;
  panel.onclick = e => {
    const element = e.target;
    if (element === panel) return;

    bp.changeTool(element.id);
  };

  bp.onToolChanged = newTool => {
    if (selected) selected.className = '';

    const e = document.getElementById(newTool || 'solid');
    if (!e) return;

    e.className = 'selected';
    selected = e;
  };

  bp.onToolChanged(bp.activeTool);
  modules.load(bp);
});

},{"../lib/boilerplate":14,"./db":10,"./modules":13,"boilerplate-jit":21,"isomorphic-fetch":27}],13:[function(require,module,exports){
// This manages the stored modules in the dropdown in the top right.

const util = require('boilerplate-jit').util;
const Boilerplate = require('../lib/boilerplate');

const fl = Math.floor;

const moduleData = [];
var selectedModule = null;
const elementForModuleData = new Map;

const addModElem = document.getElementById('addmod');

const selectModule = m => {
  if (m === selectedModule) return;

  if (selectedModule) {
    selectedModule.classList.remove('selected');
    selectedModule = null;
  }
  if (m) {
    m.classList.add('selected');
    addModElem.style.display = 'none';
    selectedModule = m;
  }
};
addModElem.style.display = 'none';

// Helper to draw a boilerplate grid to a canvas.
// This is used to draw the modules.
const drawTo = (data, size, ctx) => {
  data.base.forEach((x, y, v) => {
    const px = x * size;
    const py = y * size;
    v = util.shuttleStr(data.shuttles.get(x, y)) || v;
    ctx.fillStyle = Boilerplate.colors[v];
    ctx.fillRect(px, py, size, size);
  });
};

const save = () => {
  const json = moduleData.map(data => {
    const result = {base: {}, shuttles: {}};
    result.tw = data.tw;
    result.th = data.th;
    data.base.forEach((x, y, v) => result.base[[x, y]] = v);
    data.shuttles.forEach((x, y, v) => result.shuttles[[x, y]] = v);
    return result;
  });

  localStorage.setItem('bp modules', JSON.stringify(json));
};

const addModule = exports.addModule = (data, bp) => {
  // Might be worth converting this to yo-yo.

  // var canvas, container, ctx, height, moduleElem, rm, size, th, tw, width;
  const container = document.getElementById('moduleList');
  moduleData.push(data);

  const moduleElem = document.createElement('div');
  moduleElem.className = 'module';
  elementForModuleData.set(data, moduleElem);
  container.insertBefore(moduleElem, addModElem.nextSibling);

  const canvas = document.createElement('canvas');
  moduleElem.appendChild(canvas);

  // I did all this with a pseudo-selector (:after) but it didn't work because
  // you can't register onclick on them. Poo.
  const rm = document.createElement('div');
  rm.classList.add('rm');
  rm.textContent = '\u232B';
  moduleElem.appendChild(rm);

  if (data.tw == null) throw Error('need w/h');

  // TODO: Add devicePixelRatio to this.
  const tw = data.tw, th = data.th;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  const size = fl(Math.min(width / tw, height / th));

  canvas.width = width * devicePixelRatio;
  canvas.height = height * devicePixelRatio;

  const ctx = canvas.getContext('2d');
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.translate(fl((width - size * tw) / 2), fl((height - size * th) / 2));

  drawTo(data, size, ctx);
  ctx.strokeStyle = 'rgba(0,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(1, 1, size*tw - 2, size*th - 2);

  moduleElem.onclick = () => {
    selectModule(moduleElem);
    bp.setSelection(data);
  };

  rm.onclick = (e) => { // KAPOW!
    if (selectedModule === moduleElem) {
      selectModule(null);
      addModElem.style.display = 'inherit';
    }
    delete rm.onclick;
    delete moduleElem.onclick;
    container.removeChild(moduleElem);

    elementForModuleData.delete(data);
    const idx = moduleData.indexOf(data);
    moduleData.splice(idx, 1);

    e.stopPropagation();
    save();
  };
  save();

  return moduleElem;
};

exports.load = bp => {
  const modules = JSON.parse(localStorage.getItem('bp modules') || '[]');

  for (var i = 0; i < modules.length; i++) {
    addModule(util.deserializeRegion(modules[i]), bp);
  }

  bp.onSelection = data => {
    var e = elementForModuleData.get(data);
    if (e) {
      selectModule(e);
    } else {
      selectModule(null);
      addModElem.style.display = 'inherit';
    }
  };

  (bp.onSelectionClear = () => {
    selectModule(null);
    addModElem.style.display = 'none'
  })();

  addModElem.onclick = () => {
    const s = bp.selection;
    if (s) {
      const m = addModule(s, bp);
      selectModule(m);
    }
  };
};

},{"../lib/boilerplate":14,"boilerplate-jit":21}],14:[function(require,module,exports){
const assert = require('assert');

const {Jit, Map2, Map3, Set2, Set3, Watcher, util} = require('boilerplate-jit');

const COLORS = require('./colors')
const validBrushes = new Set(Object.keys(COLORS))
const DIRS = util.DIRS;

const {letsShuttleThrough, lerp, clamp, shuttleConnects} = require('./util');
const View = require('./view');

const GLRenderer = require('./gl');

const SHUTTLE = 0x40, THINSHUTTLE = 0x80;

const UP = 0, RIGHT = 1, DOWN = 2, LEFT = 3;

const fl = Math.floor;

const KEY = {
  up:    1 << 0,
  right: 1 << 1,
  down:  1 << 2,
  left:  1 << 3,
  shift: 1 << 4
};

const svStr = (sv) =>
  (typeof sv === 'string') ? sv
    : sv == null ? 'null'
    : (sv & SHUTTLE ? 'S' : 'A') +
      Array.prototype.map.call('urdl', (s, i) => (sv & (1<<i) ? s : '_')).join('');

// We have some additional modules to chain to the jit.

function BlobBounds(blobFiller) {
  // This calculates the bounds of all shuttles and engines.

  blobFiller.addWatch.on(blob => {
    // I'm lazy. I'll just dump it on the blob itself.
    var bottom = -1<<30, right = -1<<30,
      left = 1<<30, top = 1<<30;

    var points = blob.points, edges = blob.edges;
    (points.size < edges.size ? points : edges).forEach((x, y) => {
      if (x < left) left = x;
      if (y < top) top = y;
      if (x > right) right = x;
      if (y > bottom) bottom = y;
    });

    blob.bounds = {left, top, right, bottom};
  });
}

function PrevState(shuttles, currentStates, stepWatch) {
  // Here we store enough information to know what the state of every shuttle
  // was before the most recent call to step().

  // I'd use a WeakMap here but apparently in chrome weakmaps don't support
  // .clear().
  var prevState = new Map;
  shuttles.deleteWatch.on(shuttle => prevState.delete(shuttle));

  currentStates.watch.on((shuttle, prev) => {
    if (!prev) return; // This will fire when the shuttle is first created
    if (!prevState.has(shuttle)) prevState.set(shuttle, prev);
  });

  stepWatch.on(time => {
    if (time !== 'before') return;

    prevState.clear();
  });

  return {
    get(shuttle) { return prevState.get(shuttle); }
  };
}

function addModules(jit) {
  const stepWatch = jit.modules.stepWatch = new Watcher;
  const {shuttles, engines, currentStates} = jit.modules;

  BlobBounds(shuttles);
  BlobBounds(engines);

  const prevState = PrevState(shuttles, currentStates, stepWatch);

  jit.modules.prevState = prevState;
}

function line(x0, y0, x1, y1, f) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const ix = x0 < x1 ? 1 : -1;
  const iy = y0 < y1 ? 1 : -1;
  var e = 0;
  for (var i = 0; i <= dx+dy; i++) {
    f(x0, y0);
    var e1 = e + dy;
    var e2 = e - dx;
    if (Math.abs(e1) < Math.abs(e2)) {
      x0 += ix;
      e = e1;
    } else {
      y0 += iy;
      e = e2;
    }
  }
}

function enclosingRect(a, b) {
  return {
    tx: Math.min(a.tx, b.tx),
    ty: Math.min(a.ty, b.ty),
    tw: Math.abs(b.tx - a.tx) + 1,
    th: Math.abs(b.ty - a.ty) + 1
  };
}

class Boilerplate {

  changeTool(newTool) {
    if (validBrushes.has(newTool)) {
      this.tool = 'paint'
      this.brush = newTool
    } else {
      this.tool = newTool
      this.brush = null
    }

    // this.activeTool = (newTool === 'solid') ? null : newTool;

    // Update toolbar. Gross - should take two arguments.
    this.onToolChanged && this.onToolChanged(newTool)
    this.updateCursor();
  }

  addKeyListener(el) {
    el.addEventListener('keydown', e => {
      const kc = e.keyCode;
      // console.log(kc);

      var newTool = {
        // 1-9
        49: 'nothing',
        50: 'thinsolid',
        51: 'solid',
        52: 'bridge',
        53: 'positive',
        54: 'negative',
        55: 'shuttle',
        56: 'thinshuttle',
        57: 'ribbon',

        80: 'positive', // p
        78: 'negative', // n
        83: 'shuttle', // s
        65: 'thinshuttle', // a
        69: 'nothing', // e
        71: 'thinsolid', // g
        68: 'solid', // d
        66: 'bridge', // b
        82: 'ribbon' // r
      }[kc];

      if (e.ctrlKey) {
        const a = e.shiftKey ? 8 : 0;
        // ins1 to ins16.
        if (49 <= kc && kc <= 57) newTool = `ins${kc - 48 + a}`;
        if (newTool === 'nothing') newTool = 'bridge';
        if (newTool === 'ribbon') newTool = 'ribbonbridge';
      }

      //console.log('newTool', newTool);

      if (newTool) {
        if (this.selection) {
          // Fill the entire selection with the new brush
          for (var x = 0; x < this.selection.tw; x++) {
            for (var y = 0; y < this.selection.th; y++) {
              if (newTool === 'solid') {
                this.selection.base.delete(x, y);
                this.selection.shuttles.delete(x, y);
              } else if (newTool === 'shuttle' || newTool === 'thinshuttle') {
                if (!letsShuttleThrough(this.selection.base.get(x, y))) {
                  this.selection.base.set(x, y, 'nothing');
                }
                this.selection.shuttles.set(x, y, newTool);
              } else {
                this.selection.base.set(x, y, newTool);
                this.selection.shuttles.delete(x, y);
              }
            }
          }
        } else {
          // No selection. Just change the tool.
          this.changeTool(newTool);
        }
      }

      if (37 <= e.keyCode && e.keyCode <= 40) {
        this.lastKeyScroll = Date.now();
      }

      switch (kc) {
        // Left, right, up, down.
        case 37: this.keysPressed |= KEY.left; break;
        case 39: this.keysPressed |= KEY.right; break;
        case 38: this.keysPressed |= KEY.up; break;
        case 40: this.keysPressed |= KEY.down; break;

        case 16: // Shift
          this.keysPressed |= KEY.shift;
          this.imminentSelect = true;
          break;

        case 27: case 192: // Escape.
          if (this.selection)
            this.clearSelection();
          else
            this.changeTool('move');
          break;

        case 190: // '.'
          this.view.snap(this.mouse);
          this.drawAll();
          break;

        case 88: // 'x'
          if (this.selection) this.flip('x');
          break;
        case 89: // 'y'
          if (this.selection) this.flip('y');
          break;
        case 77: // 'm'
          if (this.selection) this.mirror();
          break;

        case 187: case 189: // plus, minus.
          var amt = Math.max(1, this.view.size / 8) / 20;
          if (kc === 189) amt *= -1; // minus key
          if (this.keysPressed & KEY.shift) amt *= 3;
          this.view.zoomBy(amt, {x: this.width/2, y: this.height/2});
          break;
      }

      if ((e.ctrlKey || e.metaKey) && kc === 90) { // Ctrl+Z or Cmd+Z
        if (e.shiftKey) this.redo(); else this.undo();
        e.preventDefault();
      } else if (e.ctrlKey && kc === 89) { // Ctrl+Y for windows
        this.redo();
        e.preventDefault();
      }

      this.draw();
    });

    el.addEventListener('keyup', e => {
      if (37 <= e.keyCode && e.keyCode <= 40)
        this.lastKeyScroll = Date.now();

      switch (e.keyCode) {
        case 16: // Shift
          this.keysPressed &= ~KEY.shift;
          this.imminentSelect = false;
          this.draw();
          break;

        // Left, right, up, down.
        case 37: this.keysPressed &= ~KEY.left; break;
        case 39: this.keysPressed &= ~KEY.right; break;
        case 38: this.keysPressed &= ~KEY.up; break;
        case 40: this.keysPressed &= ~KEY.down; break;
      }
    });

    el.addEventListener('blur', () => {
      this.mouse.mode = null;
      this.imminentSelect = false;
      this.editStop();
      this.draw();
    });

    el.addEventListener('copy', e => this.copy(e));
    el.addEventListener('paste', e => this.paste(e));
  }




  set(x, y, bv, sv) {
    const bp = this.jit.get('base', x, y) || null;
    var sp = this.jit.get('shuttles', x, y) || null;
    if (bv == bp && sp == sv) return false;

    this.onEdit(x, y, bp, sp); // Add to the undo stack
    this.jit.set(x, y, bv, sv);
    return true;
  }

  resetView() { this.view.reset(this.options); }

  setJSONGrid(json) {
    this.jit = Jit(json);
    addModules(this.jit);
    this.gridRenderer.addModules(this.jit);

    // Stop dragging a shuttle if it gets wiped out. This might not be an issue
    // now that shuttles don't automerge, but its *more correct*.
    this.jit.modules.shuttles.deleteWatch.on(s => {
      if (this.draggedShuttle && s === this.draggedShuttle.shuttle)
        this.draggedShuttle = null;
    });

    this.currentEdit = null;
    this.undoStack.length = this.redoStack.length = 0;
    this.drawAll();
  }

  getJSONGrid() { return this.jit.toJSON(); }

  constructor(el, options) {
    this.el = el;
    this.options = options || {};

    this.keysPressed = 0; // bitmask. up=1, right=2, down=4, left=8.
    this.lastKeyScroll = 0; // epoch time

    this.brush = null // Brush type (shuttle, thinshuttle, solid, etc) or null.
    this.tool = 'move' // move, paint, cut, glue

    // A list of patches
    this.currentEdit = null;
    this.undoStack = [];
    this.redoStack = [];

    this.view = new View(this.el.offsetWidth, this.el.offsetHeight, this.options);

    this.canScroll = this.options.canScroll != null ? this.options.canScroll : true;
    this.animTime = this.options.animTime || 0;

    if (this.el.tabIndex === -1) this.el.tabIndex = 0; // Allow keyboard events.

    this.gridCanvas = this.el.appendChild(document.createElement('canvas'));
    this.gridCanvas.className = 'draw';
    this.gridCanvas.style.backgroundColor = COLORS.solid;

    this.dynCanvas = this.el.appendChild(document.createElement('canvas'));
    this.dynCanvas.className = 'draw';

    this.el.boilerplate = this;

    this.gridRenderer = new GLRenderer(this.gridCanvas, this.view);

    this.setJSONGrid(this.options.grid);

    this.mouse = {x: null, y: null, mode: null} // Mode here manages selection state. Bit gross.
    this.imminentSelect = false;
    this.selectedA = this.selectedB = null;
    this.selectOffset = null;
    this.selection = null;

    this.drawAll();


    // ------- Event handlers

    this.view.watch.forward(d => {
      this.width = d.width; this.height = d.height;

      this.dynCanvas.width = d.width * devicePixelRatio;
      this.dynCanvas.height = d.height * devicePixelRatio;

      // I'm not sure why this is needed?
      //@dynCanvas.style.width = @gridCanvas.style.width = @width + 'px'
      //@dynCanvas.style.height = @gridCanvas.style.height = @height + 'px'

      this.dctx = this.dynCanvas.getContext('2d');
      this.dctx.scale(devicePixelRatio, devicePixelRatio);

      this.drawAll();
    });

    this.el.onmousemove = e => {
      this.imminentSelect = !!e.shiftKey;

      // If the mouse is released / pressed while not in the box, handle that correctly
      // (although this is still a little janky with dragging I think)
      if (e.button && !this.mouse.mode) this.el.onmousedown(e);
      if (this.updateMousePos(e)) this.cursorMoved();
      if (this.mouse.mode === 'pan') {
        this.view.scrollBy(-this.mouse.dx, -this.mouse.dy)
      }

      if (this.mouse.mode === 'cut' || this.mouse.mode === 'glue') this.glueOrCut()

      if (this.mouse && this.jit.get('base', this.mouse.tx, this.mouse.ty)) {
        this.draw();
      }
    };

    this.el.onmousedown = e => {
      this.updateMousePos(e);

      if (e.button === 1) {
        this.mouse.mode = 'pan';
      } else if (e.shiftKey) {
        this.mouse.mode = 'select';
        this.clearSelection();
        this.selectedA = this.view.screenToWorld(this.mouse.x, this.mouse.y);
        this.selectedB = this.selectedA;
      } else if (this.selection) {
        this.stamp();
      } else {
        if (this.tool === 'move') {
          const shuttle = this.jit.modules.shuttleGrid.getShuttle(this.mouse.tx, this.mouse.ty);
          if (shuttle) {
            // Grab that sucka!
            const dx = shuttle.currentState.dx, dy = shuttle.currentState.dy;
            this.draggedShuttle = {
              shuttle: shuttle,
              heldPoint: {x:this.mouse.tx - dx, y:this.mouse.ty - dy}
            };
            shuttle.held = true;
          }
        } else if (this.tool === 'paint') {
          this.mouse.mode = 'paint';
          this.mouse.from = {tx: this.mouse.tx, ty: this.mouse.ty};
          this.mouse.direction = null;
          this.editStart();
          this.paint();
        } else if (this.tool === 'cut' || this.tool === 'glue') {
          this.mouse.mode = this.tool
          this.glueOrCut()
        } else {
          console.warn('unknown tool', this.tool)
        }
      }
      this.updateCursor();
      this.draw();
    };

    this.el.onmouseup = () => {
      if (this.draggedShuttle) {
        this.draggedShuttle.shuttle.held = false;
        this.draggedShuttle = null;
      }

      if (this.mouse.mode === 'select') {
        this.selection = this.copySubgrid(enclosingRect(this.selectedA, this.selectedB));
        this.selectOffset = {
          tx: this.selectedB.tx - Math.min(this.selectedA.tx, this.selectedB.tx),
          ty: this.selectedB.ty - Math.min(this.selectedA.ty, this.selectedB.ty)
        };
        this.onSelection && this.onSelection(this.selection);
      } else if (this.mouse.mode === 'paint') {
        this.editStop();
        // Its dangerous firing this event here - it should be in a nextTick or
        // something, but I'm lazy. (Sorry future me)
        this.onEditFinish && this.onEditFinish();
      }

      this.mouse.mode = null;
      this.mouse.direction = null;
      this.imminentSelect = false;
      this.updateCursor();
      this.draw();
    };

    this.el.onmouseout = e => {
      // Pretend the mouse just went up at the edge of the boilerplate instance then went away.
      this.el.onmousemove(e);
      this.mouse.x = this.mouse.y = this.mouse.from = this.mouse.tx = this.mouse.ty = null;
      // ... But if we're drawing, stay in drawing mode.
      this.mouse.mode = null;
      this.draw();
    };

    this.el.onmouseenter = e => {
      if (e.button) {
        this.el.onmousemove(e);
        this.el.onmousedown(e);
      }
    };

    this.el.onwheel = e => {
      if (!this.canScroll) return;
      this.updateMousePos(e);

      if (e.shiftKey || e.ctrlKey) {
        this.view.zoomBy(-(e.deltaY + e.deltaX) / 400, this.mouse);
      } else {
        this.view.scrollBy(e.deltaX, e.deltaY);
      }
      const d = this.view.screenToWorld(this.mouse.x, this.mouse.y);
      this.mouse.tx = d.tx; this.mouse.ty = d.ty;

      e.preventDefault();
      this.cursorMoved();
    };
  }


  updateMousePos(e) {
    this.mouse.from = {tx: this.mouse.tx, ty: this.mouse.ty};

    if (e) {
      const oldX = this.mouse.x;
      const oldY = this.mouse.y;
      this.mouse.x = clamp(e.offsetX, 0, this.el.offsetWidth - 1);
      this.mouse.y = clamp(e.offsetY, 0, this.el.offsetHeight - 1);
      this.mouse.dx = this.mouse.x - oldX
      this.mouse.dy = this.mouse.y - oldY
    }
    const {tx, ty, tc} = this.view.screenToWorldCell(this.mouse.x, this.mouse.y, this.jit);

    if (tx !== this.mouse.tx || ty !== this.mouse.ty || tc !== this.mouse.tc) {
      this.mouse.tx = tx;
      this.mouse.ty = ty;
      this.mouse.tc = tc;
      return true;
    } else {
      return false;
    }
  }

  cursorMoved() {
    switch (this.mouse.mode) {
      case 'paint':
        this.paint(); break;
      case 'select':
        this.selectedB = this.view.screenToWorld(this.mouse.x, this.mouse.y); break;
    }

    if (this.draggedShuttle != null) this.dragShuttleTo(this.mouse.tx, this.mouse.ty);

    this.draw();
    this.updateCursor();
  }

  updateCursor() {
    var c;
    if (this.tool === 'move' && !this.imminentSelect) {
      if (this.draggedShuttle) {
        c = '-webkit-grabbing';
      } else if (this.jit.modules.shuttleGrid.getShuttle(this.mouse.tx, this.mouse.ty)) {
        c = '-webkit-grab';
      } else {
        c = 'default';
      }
    } else { // For now we'll use the crosshair for cut and glue.
      switch (this.mouse.direction) {
        case 'x':
          c = 'ew-resize'; break;
        case 'y':
          c = 'ns-resize'; break;
        default:
          c = 'crosshair';
      }
    }
    this.dynCanvas.style.cursor = c;
  }

  resizeTo(w, h) {
    this.view.resizeTo(w, h);
  }

  paint() {
    // This is a sort of weird way to get the list of valid cells. It works though.
    if (this.brush == null) throw Error('Invalid brush in paint() call');

    const {tx, ty} = this.mouse;
    var {tx:fromtx, ty:fromty} = this.mouse.from;
    if (fromtx == null) fromtx = tx;
    if (fromty == null) fromty = ty;

    line(fromtx, fromty, tx, ty, (x, y) => {
      if (this.brush === 'shuttle' || this.brush === 'thinshuttle') {
        var bv = this.jit.get('base', x, y);
        if (!letsShuttleThrough(bv)) bv = 'nothing';

        // Figure out connectivity.
        var sv = (this.brush === 'shuttle') ? SHUTTLE : THINSHUTTLE;

        const oldsv = this.jit.get('shuttles', x, y);
        if (oldsv != null) sv |= oldsv & 0b1111;

        if (fromtx < x) sv |= (1<<LEFT);
        else if (fromtx > x) sv |= (1<<RIGHT);
        if (fromty < y) sv |= (1<<UP);
        else if (fromty > y) sv |= (1<<DOWN);

        this.set(x, y, bv, sv);
      } else {
        this.set(x, y, this.brush, null);
      }
      fromtx = x; fromty = y;
    });

    this.drawAll();
  }

  glueOrCut() {
    if (this.tool !== 'cut' && this.tool !== 'glue') throw Error('Invalid glueOrCut call')

    const {x, y, tx, ty} = this.mouse
    if (tx == null) return

    const sv = this.jit.get('shuttles', tx, ty)
    if (sv == null) return

    const {tx:rtx, ty:rty} = this.view.screenToWorldRaw(x, y)
    const offx = rtx - tx, offy = rty - ty
    const botright = offx + offy > 1
    const botleft = offy > offx
    
    // There's probably an algebraic expression for this, but ... eh :)
    const dir = [0, 3, 1, 2][botleft + 2 * botright] // up, right, bot, left.

    const bv = this.jit.get('base', tx, ty)
    if (this.tool === 'cut' && shuttleConnects(sv, dir)) {
      this.set(tx, ty, bv, sv & ~(1<<dir))
    } else if (this.tool === 'glue' && !shuttleConnects(sv, dir)) {
      this.set(tx, ty, bv, sv | (1<<dir))
    }
  }

  step() {
    this.jit.modules.stepWatch.signal('before')
    const changed = this.jit.step()
    if (changed) {
      this.lastStepAt = Date.now()
      this.drawAll()
      this.updateCursor()
    }
    this.jit.modules.stepWatch.signal('after')
    return changed
  }

  dragShuttleTo(tx, ty) {
    if (this.draggedShuttle == null) return;

    const {shuttle, heldPoint} = this.draggedShuttle;

    // This is a bit awkward - we don't generate all states.
    const wantedDx = tx - heldPoint.x;
    const wantedDy = ty - heldPoint.y;

    // First find the closest existing state to the mouse.
    var bestState = shuttle.currentState;

    // We'll just do a dumb beam search here. Previously we scanned all the
    // shuttle's states to find a good one but with that its possible to make
    // one shuttle hop over another one by dragging.
    const {shuttleStates, shuttleOverlap} = this.jit.modules;

    var next;
    const tryMove = (dir) => {
      if (next) return;

      next = shuttleStates.getStateNear(bestState, dir);
      if (shuttleOverlap.willOverlap(shuttle, next)) next = null;
    };

    while (bestState.dx !== wantedDx || bestState.dy !== wantedDy) {
      const distX = wantedDx - bestState.dx;
      const distY = wantedDy - bestState.dy;

      next = null;
      if (distX < 0) tryMove(LEFT); else if (distX > 0) tryMove(RIGHT);
      if (distY < 0) tryMove(UP); else if (distY > 0) tryMove(DOWN);

      if (next) {
        bestState = next;
      } else {
        break;
      }
    }

    if (shuttle.currentState !== bestState) {
      this.jit.moveShuttle(shuttle, bestState);
      this.drawAll();
    }
  }


  // --------- UNDO STACK

  editStart() {
    this.editStop();
    this.currentEdit = {
      base: new Map2,
      shuttles: new Map2
    };
  }

  onEdit(x, y, bp, sp) {
    // Called from set() with old base and shuttle values.
    // console.log('set', x, y, bv, svStr(sv), sp, svStr(sp));
    if (this.currentEdit && !this.currentEdit.base.has(x, y)) {
      this.currentEdit.base.set(x, y, bp);

      if (sp != null) {
        // This ungodly mess is needed because if you're drawing over
        // some adjacent shuttles, when we call this.jit.set() it'll
        // unhelpfully clean up subsequent adjancency values.

        // So we'll use adjacency values from previously slurped up items
        // in the currentEdit set.

        // Priority: The old value's adjacency, but use currentEdit's
        // adjacency values if currentEdit contains the adjacent cell.
        DIRS.forEach((d, i) => {
          const _adj = this.currentEdit.shuttles.get(x+d.dx, y+d.dy);
          if (_adj != null) {
            if (_adj&(1<<util.oppositeDir(i))) {
              sp |= 1<<i;
            } else {
              sp &= ~(1<<i);
            }
          }
        });
      }
      // console.log('->t', svStr(sp));
      this.currentEdit.shuttles.set(x, y, sp);
    }
  }

  editStop(stack) {
    if (stack == null) stack = this.undoStack;

    // ... also clear the redo stack for real edits.
    if (this.currentEdit) {
      if (this.currentEdit.base.size || this.currentEdit.shuttles.size) {
        stack.push(this.currentEdit);
      }
      this.currentEdit = null;
    }
  }

  _popStack(from, to) {
    this.editStop();
    var edit = from.pop();
    if (edit) {
      this.editStart();
      // edit.shuttles.forEach((x, y, v) => console.log(x, y, svStr(v)));
      edit.base.forEach((x, y, v) =>
        this.set(x, y, v, edit.shuttles.get(x, y)));
    }
    this.editStop(to);
    this.drawAll();
  }

  redo() { this._popStack(this.redoStack, this.undoStack); }
  undo() { this._popStack(this.undoStack, this.redoStack); }


  // ---------- SELECTION

  copySubgrid(rect) {
    const {tx, ty, tw, th} = rect;
    const subgrid = {
      tw: tw,
      th: th,
      base: new Map2,
      shuttles: new Map2
    };

    for (var y = ty; y < ty + th; y++) {
      for (var x = tx; x < tx + tw; x++) {
        const bv = this.jit.get('base', x, y);
        const sv = this.jit.get('shuttles', x, y);

        if (bv) subgrid.base.set(x - tx, y - ty, bv);
        if (sv) subgrid.shuttles.set(x - tx, y - ty, sv);
      }
    }
    return subgrid;
  }

  _transformSelection(tw, th, shuttlexf, copyfn) {
    if (!this.selection) return;

    const newSelection = {
      tw: tw,
      th: th,
      base: new Map2,
      shuttles: new Map2
    };

    this.selection.base.forEach(copyfn(newSelection.base));

    const copyToShuttles = copyfn(newSelection.shuttles);
    this.selection.shuttles.forEach((x, y, v) => copyToShuttles(x, y, shuttlexf(v)));

    return this.selection = newSelection;
  }

  flip(dir) {
    if (!this.selection) return;

    const {tw, th} = this.selection;

    // UP=0; RIGHT=1; DOWN=2; LEFT=3
    const flipSV = (sv) => (sv & 0xf0) | (
      (dir === 'x') ?
        ((sv&0b0101) | ((sv&0b10)<<2) | ((sv&0b1000) >> 2))
      : ((sv&0b1010) | ((sv&0b1)<<2)  | ((sv&0b100) >> 2))
    );

    this._transformSelection(tw, th, flipSV, dest => (x, y, v) => {
      const x_ = dir === 'x' ? tw - 1 - x : x;
      const y_ = dir === 'y' ? th - 1 - y : y;
      dest.set(x_, y_, v);
    });
  }

  mirror() {
    if (!this.selection) return;

    // UP=0; RIGHT=1; DOWN=2; LEFT=3. Up<=>left, right<=>down.
    const mirrorSV = (sv) => (sv & 0xf0) |
      ((sv&0b1000)>>3) | ((sv&0b1)<<3) | ((sv&0b100)>>1) | ((sv&0b10)<<1);

    // Width and height swapped! So tricky.
    this._transformSelection(this.selection.th, this.selection.tw, mirrorSV,
        dest => (x, y, v) => dest.set(y, x, v));
  }

  stamp() {
    if (!this.selection) throw new Error('tried to stamp without a selection');

    var {tx:mtx, ty:mty} = this.view.screenToWorld(this.mouse.x, this.mouse.y);
    mtx -= this.selectOffset.tx;
    mty -= this.selectOffset.ty;

    var changed = false;
    // We need to set all values, even the nulls.
    this.editStart();

    for (var y = 0; y < this.selection.th; y++) {
      for (var x = 0; x < this.selection.tw; x++) {
        const bv = this.selection.base.get(x, y);
        const sv = this.selection.shuttles.get(x, y);
        if (this.set(mtx + x, mty + y, bv, sv)) changed = true;
      }
    }

    this.editStop();
    this.onEditFinish && this.onEditFinish();

    if (changed) this.drawAll();
  }

  clearSelection() {
    if (this.selection) {
      this.selection = this.selectOffset = null;
      this.onSelectionClear && this.onSelectionClear();
    }
  }

  setSelection(data) {
    this.clearSelection();
    if (data == null) return;
    assert(data.tw != null);
    this.selection = data;
    this.selectOffset = {tx: 0, ty: 0};
    this.onSelection && this.onSelection(this.selection);
  }

  copy(e) {
    var json;
    if (this.selection) {
      json = {tw:this.selection.tw, th:this.selection.th, base:{}, shuttles:{}};
      this.selection.base.forEach((x, y, v) => {
        if (v != null) json.base[`${x},${y}`] = v;
      });
      this.selection.shuttles.forEach((x, y, v) => {
        if (v != null) json.shuttles[`${x},${y}`] = v;
      });
    } else {
      json = this.getJSONGrid();
    }

    e.clipboardData.setData('text', JSON.stringify(json));
    // console.log(JSON.stringify(json));

    e.preventDefault();
  }

  paste(e) {
    const json = e.clipboardData.getData('text');
    if (json) {
      try {
        this.selection = util.deserializeRegion(json);
        this.selectOffset = {tx:0, ty:0};
        this.onSelection && this.onSelection(this.selection);
      } catch (err) {
        this.selection = null;
        console.error('Error parsing data in clipboard:', err.stack);
      }
    }
  }


  // --------- DRAWING

  drawAll() {
    this.needsDrawAll = true;
    this.draw();
  }

  draw() {
    if (this.needsDraw) return;
    this.needsDraw = true;

    requestAnimationFrame(() => {
      this.needsDraw = false;

      if (this.needsDrawAll) {
        this.jit.modules.shuttles.flush();
        // this.gridRenderer.draw();
        this.needsDrawAll = false;
      }

      // This is a weird place to do keyboard scrolling, but if we do it in
      // step() it'll only happen once every few hundred ms.
      if ((this.keysPressed & 0xf) && this.canScroll) {
        const now = Date.now();
        var amt = 0.6 * Math.min(now - this.lastKeyScroll, 300);
        if (this.keysPressed & KEY.shift) amt *= 3;

        if (this.keysPressed & KEY.up) this.view.scrollBy(0, -amt);
        if (this.keysPressed & KEY.right) this.view.scrollBy(amt, 0);
        if (this.keysPressed & KEY.down) this.view.scrollBy(0, amt);
        if (this.keysPressed & KEY.left) this.view.scrollBy(-amt, 0);

        this.lastKeyScroll = now;

        if (this.updateMousePos())
          this.cursorMoved();

      }

      this.dctx.clearRect(0, 0, this.width, this.height);
      this.drawGrid();
      this.drawOverlay();
      if (this.keysPressed) this.draw();
    });
  }

  // Helper to draw blocky cells. Currently only used to draw hovered cells.
  // override is either a string css color or function.
  drawCells(ctx, points, override) {
    const size = this.view.size;
    points.forEach((tx, ty, v) => {
      const {px, py} = this.view.worldToScreen(tx, ty);

      if (px + size < 0 || px >= this.width || py + size < 0 || py >= this.height)
        return;

      const style = (typeof override === 'function') ? override(tx, ty, v)
        : override ? override
        : COLORS[v] || 'red';
      if (style == null) return;

      ctx.fillStyle = style;
      ctx.fillRect(px, py, size, size);
    });
  }

  // Draw a path around the specified blob edge. The edge should be a Set3 of (x,y,dir).
  __old_pathAroundEdge(ctx, edge, border, pos) {
    const sx = pos ? pos.sx : 0,
      sy = pos ? pos.sy : 0;

    // Ok, now for the actual shuttles themselves
    const lineTo = (x, y, dir, em, first) => {
      // Move to the right of the edge.
      //var dx, dy, ex, ey, px, py, ref2, ref3;
      var ex = dir === UP || dir === RIGHT ? x+1 : x;
      var ey = dir === RIGHT || dir === DOWN ? y+1 : y;
      ex += sx; ey += sy; // transform by shuttle state x,y

      var {px, py} = this.view.worldToScreen(ex, ey);
      const {dx, dy} = DIRS[dir];

      // Come in from the edge
      px += border * (-dx - dy * em);
      py += border * (-dy + dx * em);

      if (first) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    };

    const visited = new Set3;
    ctx.beginPath();

    // I can't simply draw from the first edge because the shuttle might have
    // holes (and hence multiple continuous edges).
    edge.forEach((x, y, dir) => {
      // Using pushEdges because I want to draw the outline around just the
      // solid shuttle cells.
      if (visited.has(x, y, dir)) return;

      var first = true; // For the first point we need to call moveTo() not lineTo().

      while (!visited.has(x, y, dir)) {
        visited.add(x, y, dir);
        const {dx, dy} = DIRS[dir];

        var x2, y2, dir2;
        if (edge.has(x2=x+dx-dy, y2=y+dy+dx, dir2=(dir+3)%4) && // up-right
            !edge.has(x, y, (dir + 1) % 4)) { // fix pincy corners
          // Curves in _|
          lineTo(x, y, dir, 1, first);
          x = x2; y = y2; dir = dir2;
          first = false;
        } else if (edge.has((x2=x-dy), (y2=y+dx), dir)) {
          // straight __
          x = x2; y = y2;
        } else {
          // curves down ^|
          // We could check for it, but there's no point.
          lineTo(x, y, dir, -1, first);
          dir = (dir+1) % 4;
          first = false;
        }
      }
      ctx.closePath();
    });
  }

  drawEngine(engine, t) {
    this.__old_pathAroundEdge(this.dctx, engine.edges, 2);

    this.dctx.strokeStyle = engine.type === 'positive' ?
      'hsl(120, 52%, 26%)' : 'hsl(16, 68%, 20%)';

    this.dctx.lineWidth = 4;
    this.dctx.stroke();
  }

  drawGrid() {
    // Will we need to draw again after?
    var needsRedraw = false;

    // For animating shuttle motion
    var t = 1;
    if (this.animTime && this.lastStepAt) {
      const now = Date.now();
      const exact = (now - this.lastStepAt) / this.animTime;

      // This makes the shuttles always draw at exact pixel boundaries
      t = Math.min(1, ((exact * this.view.size) | 0) / this.view.size);
    }

    // Mouse position.
    const mx = this.mouse.x, my = this.mouse.y;
    const {tx:mtx, ty:mty, tc:mtc} = this.view.screenToWorldCell(mx, my, this.jit);

    const hover = {};

    if (this.tool === 'move' && !this.selection && !this.imminentSelect) {
      const bv = this.jit.get('base', mtx, mty);
      const sv = util.shuttleStr(this.jit.get('shuttles', mtx, mty));

      // What is the mouse hovering over? For better or worse, this relies
      // heavily uses the parser internals.
      const modules = this.jit.modules;

      hover.shuttle = modules.shuttleGrid.getShuttle(mtx, mty);

      const engine = modules.engineGrid.get(mtx, mty);
      if (engine) this.drawEngine(engine, t);

      var contents;
      if (sv !== 'shuttle' && bv && (contents = this.jit.getZoneContents(mtx, mty, mtc))) {
        hover.points = contents.points;
        hover.pressure = 0;
        contents.engines.forEach(e => {
          hover.pressure += e.pressure;
          this.drawEngine(e, t);
        });
      }
    }

    if (this.gridRenderer.draw(t, hover)) needsRedraw = true;

    if (hover.points) {
      this.drawCells(this.dctx, hover.points, 'rgba(100,100,100,0.3)');
    }

    if (hover.pressure) {
      const px = mx, py = my + 20;

      const size = 23;
      var fontsize = size;
      const text = ''+hover.pressure;
      while (fontsize > 3) {
        this.dctx.font = `${fl(fontsize)}px sans-serif`;
        if (this.dctx.measureText(text).width < size - 3) break;
        fontsize--;
      }

      this.dctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      this.dctx.fillRect(px, py, size, size);

      this.dctx.fillStyle = hover.pressure < 0 ? COLORS.negative : COLORS.positive;
      this.dctx.textBaseline = 'middle';
      this.dctx.textAlign = 'center';
      this.dctx.fillText(text, px + size / 2, py + size / 2);
    }

    if (t !== 1 && needsRedraw) this.draw();
    // this.draw();
  }

  drawOverlay() {
    const mx = this.mouse.x, my = this.mouse.y
    const {tx:mtx, ty:mty} = this.view.screenToWorld(mx, my)
    const {px:mpx, py:mpy} = this.view.worldToScreen(mtx, mty)

    var sa, sb
    if (this.mouse.mode === 'select') {
      // Selection corners
      sa = this.selectedA;
      sb = this.selectedB;
    } else if (this.imminentSelect) {
      sa = sb = {tx:mtx, ty:mty};
    }

    this.dctx.lineWidth = 1;
    const size = this.view.size;

    // Draw the mouse hover state
    if (this.mouse.tx !== null) {
      if (sa) {
        // The user is dragging out a selection rectangle.
        const {tx, ty, tw, th} = enclosingRect(sa, sb);
        const {px, py} = this.view.worldToScreen(tx, ty);

        this.dctx.fillStyle = 'rgba(0,0,255,0.5)';
        this.dctx.fillRect(px, py, tw * size, th * size);

        this.dctx.strokeStyle = 'rgba(0,255,255,0.5)';
        this.dctx.strokeRect(px, py, tw * size, th * size);
      } else if (this.selection) { // mouse.tx is null when the mouse is outside the div.
        // The user is holding a selection stamp
        this.dctx.globalAlpha = 0.8;

        for (var y = 0; y < this.selection.th; y++) {
          for (var x = 0; x < this.selection.tw; x++) {
            // Ugh so wordy.
            const {px, py} = this.view.worldToScreen(
                x+mtx-this.selectOffset.tx,
                y+mty-this.selectOffset.ty);

            if (px+size >= 0 && px < this.width && py+size >= 0 && py < this.height) {
              var v = this.selection.shuttles.get(x, y) || this.selection.base.get(x, y);
              if (typeof v === 'number') v = util.shuttleStr(v);

              this.dctx.fillStyle = (v ? COLORS[v] : COLORS.solid) || 'red';
              this.dctx.fillRect(px, py, size, size);
            }
          }
        }
        this.dctx.strokeStyle = 'rgba(0,255,255,0.5)';
        this.dctx.strokeRect(mpx - this.selectOffset.tx * size,
            mpy - this.selectOffset.ty * size,
            this.selection.tw * size, this.selection.th * size);
        this.dctx.globalAlpha = 1;
      } else if (mpx != null) {
        if (this.tool === 'paint') {
          // The user is holding a paintbrush
          this.dctx.fillStyle = COLORS[this.brush] || 'red';
          this.dctx.fillRect(mpx + size/4, mpy + size/4, size/2, size/2);

          this.dctx.strokeStyle = this.jit.get('base', mtx, mty) ? 'black' : 'white';
          this.dctx.strokeRect(mpx + 1, mpy + 1, size - 2, size - 2);
        } else if (this.tool === 'cut' || this.tool === 'glue') {
          const {tx:rtx, ty:rty} = this.view.screenToWorldRaw(mx, my)

          // Check that there's a shuttle in the cell
          const sv = this.jit.get('shuttles', mtx, mty)
          if (sv) {
            // Find which edge we're closest to
            const offx = rtx - mtx, offy = rty - mty

            const botright = offx + offy > 1
            const botleft = offy > offx

            const isVert = botright !== botleft //dir === 1 || dir === 3
            // console.log('isvert', isVert, botleft, botright)
            this.dctx.fillStyle = this.tool === 'glue' ? 'green' : 'hotpink'
            if (isVert) this.dctx.fillRect(mpx + (botright ? size : 0) - size/8, mpy, size/4, size)
            else this.dctx.fillRect(mpx, mpy + (botright ? size : 0) - size/8, size, size/4)
          }
        }
      }
    }
  }
}

module.exports = Boilerplate;
Boilerplate.colors = COLORS;

},{"./colors":15,"./gl":16,"./util":18,"./view":19,"assert":1,"boilerplate-jit":21}],15:[function(require,module,exports){
// The boilerplate CSS colors.

const COLORS = module.exports = {
  bridge: 'rgb(26, 126, 213)',
  // bridge: 'hsl(216, 92%, 33%)'
  // thinbridge: 'hsl(203, 67%, 51%)'
  negative: 'hsl(16, 68%, 50%)',
  nothing: 'hsl(0, 0%, 100%)',
  positive: 'hsl(120, 52%, 58%)',
  shuttle: 'hsl(283, 65%, 45%)',
  solid: 'hsl(184, 49%, 7%)',
  thinshuttle: 'hsl(283, 89%, 75%)',
  thinsolid: 'hsl(0, 0%, 71%)',
  //interface: 'hsl(44, 87%, 52%)',
  ribbon: 'rgb(185, 60, 174)',
  ribbonbridge: 'rgb(108, 30, 217)'
};

// These colors are pretty ugly but they'll do for now. Maybe just 1 color but
// with numbers drawn on the cell?
(() => {
  for (var i = 1; i <= 8; i++) {
    COLORS[`ins${i}`] = `hsl(188, ${24 + 6 * i}%, ${43 - 2*i}%)`;
    COLORS[`ins${i+8}`] = `hsl(44, #{24 + 6 * i}%, #{43 - 2*i}%)`;
  }
})();

},{}],16:[function(require,module,exports){
// GL renderer for the grid

const {Map2, Map3, Set2, Set3, Jit, Watcher, util:jitutil} = require('boilerplate-jit');
const {DIRS} = jitutil;
const assert = require('assert');
const compileProgram = require('./glutil').compileProgram;
const {lerp, clamp, shuttleConnects} = require('./util');

const glslify = require('glslify')

// The value here doesn't matter much - and won't until I make a bunch more
// performance tweaks.
const TILE_SIZE = 64;
const SHUTTLE = 0x40, THINSHUTTLE = 0x80;
const UP = 0, RIGHT = 1, DOWN = 2, LEFT = 3;

const TEXMAP = {};

(() => {
  const VALS = [
    'solid',
    'nothing', 'thinsolid',
    'positive', 'negative',
    'bridge',
    'ribbon', 'ribbonbridge'
  ];
  for (let i = 1; i <= 16; i++) {
    VALS.push("ins" + i);
  }
  VALS.forEach((v, i) => {TEXMAP[v] = i;});
})();


const nearestPowerOf2 = (v) => {
  v--;
  v|=v>>1; v|=v>>2; v|=v>>4; v|=v>>8; v|=v>>16;
  return v + 1;
};

assert.equal(TILE_SIZE, nearestPowerOf2(TILE_SIZE));
const TILE_OFFSET_MASK = TILE_SIZE-1; // hax :D

// Awesome bittweaking is awesome, but it has an off-by-1 error for negative
// numbers.
//const T = x => (x & ~TILE_OFFSET_MASK)/TILE_SIZE;
const T = x => Math.floor(x/TILE_SIZE);
const O = x => x & TILE_OFFSET_MASK;
const P = p => (p > 0) ? 0x40 : (p < 0) ? 0x80 : 0;

function FrameTimer(currentStates, shuttles, stepWatch) {
  let time = 1;
  let watch = new Watcher(() => time);

  let inFrame = false;

  stepWatch.on(when => {
    if (when === 'before') {
      inFrame = true;
    } else if (when === 'after') {
      inFrame = false;
      watch.signal(++time);
    }
  });

  function edit() {
    // console.log('edit');
    if (!inFrame) watch.signal(++time);
  }
  // If the user manually moves a shuttle, we'll need to recalculate.
  currentStates.watch.on(edit);

  // Or if the user adds or removes a shuttle...
  shuttles.addWatch.on(edit);
  shuttles.deleteWatch.on(edit);

  return {
    watch,
    get() { return time; }
  };
}

// Keep track of the set of groups which have pressure.
// This module is eager - it'll push out pressure changes across the entire map
// whenever a step happens.
function GroupsWithPressure(baseGrid, engines, groups, regions, zones, currentStates) {
  // Groups start off in dirtySeeds. On flush() we create pressure objects and
  // they move to activePressure. When their zone is destroyed they go to
  // dirtyPressure and on the next flush call we tell our watchers about them.
  // Then dirtyPressure is cleared.

  // This whole module is janky as fuck. I mean, it seems to be *correct* but
  // there's gotta be an easier way to keep track of all the pressurised zones.
  // Might be worth adding some forwardWatches in the jit.
  const pendingSeedPoints = []; // list of {x, y, c}
  const dirtySeeds = new Set; // set of groups
  const activePressure = new Set; // for cold start
  const dirtyPressure = [];

  // const pressureForSeed = new Map; // seed -> pressure
  const pressureForZone = new WeakMap; // zone -> current pressure object.

  // const seedPoints = new WeakMap; // group -> list of {x,y,c}.
  // seedPoints.default = () => [];

  const watch = new Watcher(fn => {
    const all = [];
    activePressure.forEach((p) => all.push(pressure));
    fn([], all);
  })

  // At startup we'll just iterate through all the engines.
  engines.addWatch.forward(e => {
    e.edges.forEach((x, y, dir) => {
      pendingSeedPoints.push({x, y, c:dir});
      // addSeed(e, x, y, dir);
    });
  });

  // But we can't just watch engines - unfortunately engine sides that don't
  // abut onto any cells don't make groups, so we can't then find out when those
  // groups are created. This caused a bug where you draw an engine then cells
  // right next to it and those cells didn't have visible pressure.
  baseGrid.afterWatch.on((x, y, oldV, v) => {
    if (v == null) return;
    // Check for adjacent engines and add seed points if we find any.
    for (var d = 0; d < 4; d++) {
      const {dx, dy} = DIRS[d];
      const v2 = baseGrid.get(x+dx, y+dy);
      if (v2 === 'positive' || v2 === 'negative') {
        pendingSeedPoints.push({x:x+dx, y:y+dy, c:jitutil.oppositeDir(d)});
      }
    }
  });

  function makePressurized(seed) { // seed is a group.
    const pressure = {
      regions: new Set,
      // groups: new Set,
      pressure: 0,
      seeds: [] // almost always just 1 item.
    };

    // Flood fill to find all the regions.
    const r0 = regions.get(seed, currentStates.map);
    assert(r0); // region can't be filled because its part of an engine
    jitutil.fillGraph(r0, (r, hmm) => {
      pressure.regions.add(r);
      r.groups.forEach(g => {
        // pressure.groups.add(g)
        if (dirtySeeds.has(g)) {
          // assert(!pressureForSeed.has(g));

          pressure.seeds.push(g);
          dirtySeeds.delete(g);
          // pressureForSeed.set(g, pressure);
        }
      });
      // pressure.regions.add(r);
      r.edges.forEach(g => {
        assert(g.used);
        const r2 = regions.get(g, currentStates.map);
        if (r2) hmm(r2);
      });
    });

    // We could calculate the pressure here, but the zone will need be generated
    //  anyway. We may as well just reuse its pressure calculation.
    const zone = zones.getZoneForRegion(r0);
    pressure.pressure = zone.pressure;
    pressureForZone.set(zone, pressure);
    activePressure.add(pressure);

    return pressure;
  }


  function deleteSeed(group) {
    // console.log('ds', group);
    assert(!dirtySeeds.has(group));
    group.engines.forEach(e => {
      if (e.used) e.edges.forEach((x, y, dir) => {
        if (group.points.has(x, y, dir)) {
          // console.log('pushing point back', x, y, dir, e, e.used);
          pendingSeedPoints.push({x, y, c:dir});
        }
      });
    });
  }

  // If an engine gets deleted, the groups and zones will get deleted too.
  // The only thing we need to clean up is the dirty groups.
  groups.deleteWatch.on(g => {
    // The pressure object will be removed anyway because the zone will get destroyed.
    if (dirtySeeds.delete(g)) {
      // console.log('deleting seed', g);
      deleteSeed(g);
    }
  });

  zones.watch.on(z => {
    const p = pressureForZone.get(z);
    if (!p) return;
    // console.log('dirty pressure', p);
    dirtyPressure.push(p);
    for (var i = 0; i < p.seeds.length; i++) {
      const s = p.seeds[i];
      if (s.used)
        dirtySeeds.add(s);
      else
        deleteSeed(s);
    }
    // pressureForZone.delete(z); // its a weak map. not needed.
    activePressure.delete(p);
  });

  return {
    watch,
    flush() {
      engines.flush();
      if (pendingSeedPoints.length) {
        for (var i = 0; i < pendingSeedPoints.length; i++) {
          const {x, y, c} = pendingSeedPoints[i];
          // The engine has been deleted.
          const v = baseGrid.get(x, y);
          if (v !== 'positive' && v !== 'negative') continue;

          const g = groups.get(x, y, c);
          if (!g) continue;

          // console.log('addSeed', x, y, c, g);
          dirtySeeds.add(g);
        }
        pendingSeedPoints.length = 0;
      }

      const newPressure = [];
      // console.log('flush', dirtySeeds);
      dirtySeeds.forEach(s => {
        // console.log('dirty seed', s);
        newPressure.push(makePressurized(s));
      });
      assert.equal(dirtySeeds.size, 0);

      watch.signal(dirtyPressure, newPressure);
      dirtyPressure.length = 0;
    }
  };
}

function Tiles(gl, baseGrid, groups, zones, frameTimer) {
  const tiles = new Map2(makeTile);

  function makeTile(tx, ty) {
    return {
      lastFlush: -1,
      count: 0,

      // One channel. High 2 bits for pressure, low 6 bits for value.
      data: new Uint8Array(TILE_SIZE * TILE_SIZE),
      dirty: false,
      tex: -1,
      bind() {
        if (this.tex == -1) {
          this.tex = gl.createTexture();
          // gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.bindTexture(gl.TEXTURE_2D, this.tex);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          this.dirty = true;
        } else {
          gl.bindTexture(gl.TEXTURE_2D, this.tex);
        }

        if (this.dirty) {
          // console.log('dirty', tx, ty);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, TILE_SIZE, TILE_SIZE, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.data);
          this.dirty = false;
        }
      }
    };
  }

  baseGrid.afterWatch.forward((x, y, oldv, v) => {
    const tx = T(x), ty = T(y);
    const ox = O(x), oy = O(y);

    const t = tiles.getDef(tx, ty);
    if (oldv != null) t.count--;
    if (v != null) t.count++;
    t.dirty = true;
    t.data[(ox + oy * TILE_SIZE)] = TEXMAP[v];
    // t.data[(ox + (TILE_SIZE - oy - 1) * TILE_SIZE)] = TEXMAP[v];

    if (t.count == 0) {
      // console.log('deleting tile', tx, ty);
      tiles.delete(tx, ty);
      if (t.tex != -1) gl.deleteTexture(t.tex);
    }
  });

  return {
    data: tiles,
    get(x, y) { return tiles.get(T(x), T(y)); },
    cleanup() {
      tiles.forEach(t => {
        if (t.tex != -1) { gl.deleteTexture(t.tex); }
      })
    },
    onContextLost() {
      tiles.forEach((x, y, t) => t.tex = -1);
    },
    setPressure(group, pressure) {
      let _tx = 0, _ty = 0;
      let t = null;
      group.points.forEach((x, y, c, v) => {
        if (v === 'nothing' || v === 'thinsolid') {
          const tx = T(x), ty = T(y);
          const ox = O(x), oy = O(y);

          if (t === null || tx !== _tx || ty !== _ty) {
            t = tiles.get(tx, ty);
            _tx = tx; _ty = ty;
          }

          if (t === undefined) {
            assert(pressure === 0);
            return;
          }

          const offset = ox + oy * TILE_SIZE;
          const oldv = t.data[offset];
          // assert(oldv === 1 || oldv === 2);
          t.data[offset] = (oldv & 0x3f) | pressure;
          t.dirty = true;
        }
      });
    }
  };
}

function GroupPressure(tiles, groupsWithPressure) {
  function set(group, pressure) {
    tiles.setPressure(group, pressure);
  }

  groupsWithPressure.watch.forward((oldp, newp) => {
    // old and new are lists. We need to figure out the set of groups to update.
    // Each group will appear zero or one times in old, and zero or one times in
    // new.

    const newGroups = new Map; // group -> pressure.
    for (let i = 0; i < newp.length; i++) {
      const p = newp[i];
      // console.log('newp', p);
      if (p.pressure === 0) continue;
      p.regions.forEach(r => r.groups.forEach(g => {
        newGroups.set(g, p.pressure);
      }));
    }
    for (let i = 0; i < oldp.length; i++) {
      const p = oldp[i];
      // console.log('oldp', p);
      if (p.pressure === 0) continue;
      const _p = P(p.pressure);
      p.regions.forEach(r => r.groups.forEach(g => {
        if (newGroups.has(g)) {
          if (_p === P(newGroups.get(g))) {
            newGroups.delete(g);
          }
        } else {
          set(g, 0);
        }
      }));
    }
    newGroups.forEach((p, g) => set(g, P(p)));
  });
}

function ShuttleGeometry(shuttles) {
  const verts = new Map; // shuttle -> float array
  verts.default = shuttle => {
    const points = shuttle.points;

    // Its more compact to use a temporary set here but slower. This is
    // memoised though, so its not a big deal.
    const edges = new Set3;
    points.forEach((x, y, v) => {
      if (v & SHUTTLE) for (var d = 0; d < 4; d++) {
        const {dx, dy} = DIRS[d];
        if (!shuttleConnects(v, d) || points.get(x+dx, y+dy) & THINSHUTTLE) edges.add(x, y, d);
      }
    });

    const sVerts = traceEdges(edges, 1.8/20);


    // Thinshuttles are more complicated. We'll make polys around the
    // thinshuttle cells and any adjacent shuttle cell.
    edges.clear();
    points.forEach((x, y, v) => {
      if (v & THINSHUTTLE) {
        for (var d = 0; d < 4; d++) {
          if (!shuttleConnects(v, d)) edges.add(x, y, d);
        }
      } else {
        // Got a shuttle. Include only if its connected to a ts.
        var touchesTs = false;
        for (var d = 0; d < 4; d++) {
          const {dx, dy} = DIRS[d];
          if (shuttleConnects(v, d) && (points.get(x+dx, y+dy) & THINSHUTTLE))
            touchesTs = true;
        }
        if (!touchesTs) return;

        for (var d = 0; d < 4; d++) {
          const {dx, dy} = DIRS[d];
          if (!shuttleConnects(v, d) || (points.get(x+dx, y+dy) & SHUTTLE))
            edges.add(x, y, d);
        }
      }
    });

    const tsVerts = traceEdges(edges, 0.25);

    return {s:sVerts, ts:tsVerts};
  };

  shuttles.deleteWatch.on(shuttle => verts.delete(shuttle));

  const lineTo = (dest, x, y, dir, border, em) => {
    // Move to the right of the edge.
    let ex = dir === UP || dir === RIGHT ? x+1 : x;
    let ey = dir === RIGHT || dir === DOWN ? y+1 : y;
    // ex += sx; ey += sy; // transform by shuttle state x,y

    // let {px, py} = this.view.worldToScreen(ex, ey);
    const {dx, dy} = DIRS[dir];

    // Come in from the edge
    ex += border * (-dx - dy * em);
    ey += border * (-dy + dx * em);

    // console.log('lineTo', px, py, x, y, dir, em, first);
    dest.push(ex, ey);
  };

  // Draw a path around the specified blob edge. The edge should be a Set3 of (x,y,dir).
  function traceEdges(edges, border) {
    const loop = [];

    const visited = new Set3;

    // I can't simply draw from the first edge because the shuttle might have
    // holes (and hence multiple continuous edges).
    edges.forEach((x, y, dir) => {
      // console.log('v', x, y, dir);
      if (visited.has(x, y, dir)) return;

      if (loop.length) {
        // Add degenerate triangles.
        loop.push(loop[0], loop[1],
          loop[0], loop[1]);
      }
      const loopStart = loop.length;

      while (!visited.has(x, y, dir)) {
        visited.add(x, y, dir);
        // console.log('visiting', x, y, dir);
        const {dx, dy} = DIRS[dir];

        let x2, y2, dir2;
        if (edges.has(x, y, dir2=(dir+1)%4)) {
          // curves down ^|
          lineTo(loop, x, y, dir, border, -1);
          dir = dir2;
        } else if (edges.has(x2=x-dy, y2=y+dx, dir)) {
          // straight __
          x = x2; y = y2;
        } else if (edges.has(x2=x+dx-dy, y2=y+dy+dx, dir2=(dir+3)%4)) {
          // Curves in _|
          lineTo(loop, x, y, dir, border, 1);
          x = x2; y = y2; dir = dir2;
        } else {
          // Loops back on itself immediately. =
          // console.log('loopy');
          lineTo(loop, x, y, dir, border, 1);
          lineTo(loop, x-dy, y+dx, (dir+3)%4, border, 1);
          x = x+dx; y = y+dy; dir = (dir+2)%4;
        }
      }

      if (loopStart !== 0) {
        loop.push(loop[loopStart], loop[loopStart+1]);
      }
      // console.log('----- path closed', JSON.stringify(loop), loopStart);
    });

    // console.log(loop);
    return loop.length ? new Float32Array(loop) : null;
  }

  return {
    get(shuttle) {
      return verts.getDef(shuttle);
    }
  }
}

function ShuttleBuffers(gl, shuttles, shuttleGeometry) {
  const buffersForShuttle = new Map;

  const bufferForVerts = verts => {
    if (!verts) return {buffer:null, size:0};
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    // console.log(verts);
    return {buffer, size:verts.length};
  }

  buffersForShuttle.default = shuttle => {
    const geometry = shuttleGeometry.get(shuttle);
    return {
      s:bufferForVerts(geometry.s),
      ts:bufferForVerts(geometry.ts)
    };
  };

  shuttles.deleteWatch.on(shuttle => {
    const data = buffersForShuttle.get(shuttle);
    if (data) {
      if (data.s.buffer != null) gl.deleteBuffer(data.s.buffer);
      if (data.ts.buffer != null) gl.deleteBuffer(data.ts.buffer);
    }
  });

  return {
    get(shuttle) {
      return buffersForShuttle.getDef(shuttle);
    },
    onContextLost() {
      buffersForShuttle.clear();
    }
  }
}

const SHUTTLE_COLORS = {
  ts: [0.847, 0.529, 0.972],
  tshover: [0.784, 0.337, 0.96],
  s: [0.58, 0.16, 0.749],
  shover: [0.501, 0.035, 0.682],
};

module.exports = class GLRenderer {
  constructor(canvas, view) {
    this.canvas = canvas;
    this.view = view;
    //this.jit = jit;
    const opts = {antialias:true, depth:false, stencil:true};
    const gl = this.gl = canvas.getContext('webgl', opts)

    view.watch.forward(({width, height}) => {
      canvas.width = width * devicePixelRatio;
      canvas.height = height * devicePixelRatio;

      gl.viewport(0,0, canvas.width, canvas.height);
      //this.updateProjection();
      // this.draw();
    });

    const tverts = new Float32Array([0,0, 0,1, 1,0, 1,1]);

    const init = () => {
      this.gridShader = compileProgram(gl, ['proj', 'tile'], ['pos'], {
        vertex: glslify(["#define GLSLIFY 1\nattribute vec2 pos;\n\nuniform mat3 proj;\n\nvarying vec2 tilexy;\n\nvoid main(void) {\n  tilexy = pos;\n  gl_Position = vec4((vec3(pos, 1) * proj).xy, 0, 1);\n}\n"]),
        fragment: glslify(["precision mediump float;\n#define GLSLIFY 1\nuniform sampler2D tile;\nvarying vec2 tilexy;\n\n/* I generated the colors from here: http://www.cssportal.com/css-color-converter/\nfunction round(x) { return Math.floor(x * 1000) / 1000; }\nfunction rgb(r, g, b) { console.log(\"vec4(\" + round(r/255) + \", \" + round(g/255) + \", \" + round(b/255) + \", 1)\");}\n */\nvoid main(void) {\n  ivec3 v = ivec3(texture2D(tile, tilexy) * 256.0);\n  int t = v.r;\n  bool neg = (t >= 0x80);\n  if (neg) t -= 0x80;\n\n  bool pos = (t >= 0x40);\n  if (pos) t -= 0x40;\n\n  vec4 color =\n    (t == 0) ? // solid\n      vec4(0.035, 0.098, 0.105, 1) :\n    (t == 1) ? // nothing\n      vec4(1,1,1, 1) :\n    (t == 2) ? // thinsolid\n      vec4(0.709, 0.709, 0.709, 1) :\n    (t == 3) ? // positive\n      vec4(0.36, 0.8, 0.36, 1) :\n    (t == 4) ? // negative\n      vec4(0.839, 0.341, 0.16, 1) :\n    (t == 5) ? // bridge\n      vec4(0.101, 0.494, 0.835, 1) :\n    (t == 6) ? // Ribbon\n      vec4(0.725, 0.235, 0.682, 1) :\n    (t == 7) ? // Ribbonbridge\n      vec4(0.423, 0.117, 0.85, 1)\n    :\n      vec4(1, 0.411, 0.705, 1); // hotpink for anything else.\n\n  gl_FragColor =\n    neg ? color * 0.8 + vec4(0.2, 0, 0, 0.2) :\n    pos ? color * 0.8 + vec4(0, 0.2, 0, 0.2) :\n    color;\n\n  // gl_FragColor = vec4(tilexy.xyx, 1);\n}\n"]),
      });
      this.shuttleShader = compileProgram(gl, ['proj', 'color'], ['pos'], {
        // These shaders are super generic.
        vertex: glslify(["#define GLSLIFY 1\nattribute vec2 pos;\n\nuniform mat3 proj;\n\nvoid main(void) {\n  gl_Position = vec4((vec3(pos, 1) * proj).xy, 0, 1);\n}\n"]),
        fragment: glslify(["precision mediump float;\n#define GLSLIFY 1\nuniform vec3 color;\n\nvoid main(void) {\n  // vec4(0.58, 0.16, 0.749, 1);\n  gl_FragColor = vec4(color, 1);\n}\n"]),
      });

      this.verts = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.verts);
      gl.bufferData(gl.ARRAY_BUFFER, tverts, gl.STATIC_DRAW);
    };

    init();


    canvas.addEventListener('webglcontextlost', (e) => {
      console.log('webglcontextlost');
      e.preventDefault();
      if (this.tiles) this.tiles.onContextLost();
      if (this.shuttleBuffers) this.shuttleBuffers.onContextLost();
    }, false);

    canvas.addEventListener('webglcontextrestored', () => {
      console.log('webglcontextrestored');
      init();
      this.draw();
    }, false);


    // For debugging.
    const lc = gl.getExtension('WEBGL_lose_context');
    window.loseContext = () => lc.loseContext();
    window.restoreContext = () => lc.restoreContext();
  }

  addModules(jit) {
    const modules = jit.modules;
    const {
      baseGrid,
      shuttles, engines,
      groups, regions, zones,
      currentStates,
      stepWatch
    } = modules;
    this.modules = modules;

    // Delete old textures so we don't leak.
    if (this.tiles) this.tiles.cleanup();

    this.frameTimer = modules.frameTimer = FrameTimer(currentStates, shuttles, stepWatch);
    this.tiles = modules.tiles = Tiles(this.gl, baseGrid, groups, zones, this.frameTimer);
    this.groupWithPressure = modules.groupWithPressure = GroupsWithPressure(baseGrid, engines, groups, regions, zones, currentStates);
    this.groupPressure = GroupPressure(this.tiles, this.groupWithPressure);
    this.shuttleGeometry = modules.shuttleGeometry = ShuttleGeometry(shuttles);
    this.shuttleBuffers = ShuttleBuffers(this.gl, shuttles, this.shuttleGeometry);
  }

  setupProjection(proj, scale, x, y) {
    const view = this.view;
    // Scroll size in pixels, rounded off to avoid weird glitching
    const scrollx = Math.floor(view.scrollX * view.size);
    const scrolly = Math.floor(view.scrollY * view.size);

    proj[0] = 2*scale/view.width;
    proj[4] = -2*scale/view.height;

    proj[2] = 2 * (x * scale - scrollx) / view.width - 1;
    proj[5] = 1 - 2 * (y * scale - scrolly) / view.height;
    proj[8] = 1;
  }

  drawGrid() {
    const gl = this.gl;
    const shader = this.gridShader;
    gl.useProgram(shader.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.verts);
    // index, size, type, normalized, stride, offset from the buffer
    gl.vertexAttribPointer(shader.attrs.pos, 2, gl.FLOAT, false, 8, 0);

    const view = this.view;
    const maxtx = T(view.scrollX + view.width / view.size);
    const maxty = T(view.scrollY + view.height / view.size);

    // Might be better off with a 16 array - I hear 4x4 matricies are faster?
    const proj = new Float32Array(9);

    for (let x = T(view.scrollX); x <= maxtx; x++) {
      for (let y = T(view.scrollY); y <= maxty; y++) {
        const t = this.tiles.data.get(x, y);
        if (!t) continue;

        // console.log('rendering tile', x, y);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(shader.uniforms.tile, 0);
        t.bind();

        const view = this.view;
        this.setupProjection(proj, TILE_SIZE * view.size, x, y);
        gl.uniformMatrix3fv(shader.uniforms.proj, false, proj);

        // DRAW!
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
  }

  drawShuttleGeometry(shuttle, t, type) {
    const view = this.view;
    const gl = this.gl;

    // Might be faster to hoist this somewhere.
    const proj = new Float32Array(9);

    const prevState = this.modules.prevState.get(shuttle);
    var sx, sy;
    if (prevState && !shuttle.held) {
      sx = lerp(t, prevState.dx, shuttle.currentState.dx);
      sy = lerp(t, prevState.dy, shuttle.currentState.dy);
    } else {
      sx = shuttle.currentState.dx; sy = shuttle.currentState.dy;
    }

    const bounds = shuttle.bounds;
    const topLeft = view.worldToScreen(bounds.left + sx, bounds.top + sy);
    const botRight = view.worldToScreen(bounds.right + sx + 1, bounds.bottom + sy + 1);
    // First get bounds - we might not even be able to display the shuttle.
    // As an optimisation for even bigger worlds we could put all the shuttles
    // in an AABB tree and do a rectangle intersection test.
    if (topLeft.px > view.width ||
        topLeft.py > view.height ||
        botRight.px < 0 ||
        botRight.py < 0)
      return false;

    const {buffer, size} = this.shuttleBuffers.get(shuttle)[type];
    if (buffer == null) return false; // No geometry of this type.

    this.setupProjection(proj, view.size, sx, sy);
    gl.uniformMatrix3fv(this.shuttleShader.uniforms.proj, false, proj);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    // index, size, type, normalized, stride, offset from the buffer
    gl.vertexAttribPointer(this.shuttleShader.attrs.pos, 2, gl.FLOAT, false, 8, 0);

    gl.drawArrays(gl.TRIANGLE_FAN, 0, size/2);

    return true;
  }

  stencilDance(fn) {
    const gl = this.gl;
    gl.colorMask(false, false, false, false);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
    gl.stencilFunc(gl.ALWAYS, 0, 0);
    gl.stencilMask(1);

    fn(false);

    gl.colorMask(true, true, true, true);
    // Clear any pixels that get drawn.
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.ZERO);

    gl.stencilFunc(gl.EQUAL, 1, 1);

    fn(true);
  }

  drawShuttles(t, hovered) {
    // Using this trick: http://fly.srk.fer.hr/~unreal/theredbook/chapter13.html
    // "Drawing Filled, Concave Polygons Using the Stencil Buffer"

    var numDrawn = 0;
    const gl = this.gl;
    const shader = this.shuttleShader;
    gl.enable(gl.STENCIL_TEST);
    gl.useProgram(shader.program);

    const eachShuttleType = (tsArgs, sArgs, fn) => {
      fn('ts', tsArgs);
      fn('s', sArgs);
    };

    eachShuttleType(SHUTTLE_COLORS.ts, SHUTTLE_COLORS.s, (type, color) => {
      gl.uniform3fv(shader.uniforms.color, color);
      this.stencilDance(() => {
        this.modules.shuttles.forEach(shuttle => {
          if (shuttle != hovered) {
            if (this.drawShuttleGeometry(shuttle, t, type)) numDrawn++;
          }
        });
      });
    });

    if (hovered) {
      eachShuttleType(SHUTTLE_COLORS.tshover, SHUTTLE_COLORS.shover, (type, color) => {
        gl.uniform3fv(shader.uniforms.color, color);
        this.stencilDance(() => this.drawShuttleGeometry(hovered, t, type));
      });
      numDrawn++;
    }

    gl.disable(gl.STENCIL_TEST);
    return numDrawn;
  }

  draw(t, hover) {
    const gl = this.gl;
    if (gl.isContextLost()) return;

    this.groupWithPressure.flush();
    // console.log('draw base');
    // gl.clearStencil(10);
    // gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.drawGrid();
    return this.drawShuttles(t, hover.shuttle);
  }

}

},{"./glutil":17,"./util":18,"assert":1,"boilerplate-jit":21,"glslify":26}],17:[function(require,module,exports){

// Type is gl.FRAGMENT_SHADER or gl.VERTEX_SHADER
function compile(gl, type, code) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, code);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }

  return shader;
}

exports.compileProgram = function compileProgram(gl, uniformNames, attrNames, source) {
  const program = gl.createProgram();

  const vert = compile(gl, gl.VERTEX_SHADER, source.vertex);
  const frag = compile(gl, gl.FRAGMENT_SHADER, source.fragment);
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  gl.validateProgram(program);
  let message = gl.getProgramInfoLog(program);
  if (message) console.warn(message);
  //gl.useProgram(program);

  const uniforms = {};
  if (uniformNames) uniformNames.forEach(u => {
    uniforms[u] = gl.getUniformLocation(program, u);
  });

  const attrs = {};
  if (attrNames) attrNames.forEach(name => {
    attrs[name] = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(attrs[name]);
  })

  return {
    program,
    uniforms,
    attrs,
    draw() {

    }

  };
};

},{}],18:[function(require,module,exports){

const letsShuttleThrough = (v) =>
  v==='nothing' || v==='bridge' || v==='ribbon' || v==='ribbonbridge';

const layerOf = v => v==='shuttle' || v==='thinshuttle' ? 'shuttles' : 'base';

// t=0 -> x, t=1 -> y
const lerp = (t, x, y) => (1 - t)*x + t*y;

const clamp = (x, min, max) => Math.max(Math.min(x, max), min);

const shuttleConnects = (sv, dir) => sv & (1<<dir);

module.exports = {letsShuttleThrough, layerOf, lerp, clamp, shuttleConnects};

},{}],19:[function(require,module,exports){
const Watcher = require('boilerplate-jit').Watcher;
const clamp = require('./util').clamp;

const UP=0, RIGHT=1, DOWN=2, LEFT=3;

// For now using old export syntax to make require() easier.
module.exports = class View {
  constructor(width, height, options) {
    this.width = width;
    this.height = height;
    this.watch = new Watcher(fn => {fn(this)});
    this.reset(options);
  }

  reset(options = {}) {
    this.zoomLevel = options.initialZoom || 1;
    this.zoomBy(0); // set this.size.

    // In tile coordinates.
    this.scrollX = options.initialX || 0;
    this.scrollY = options.initialY || 0;
    this.watch.signal(this);
  }

  fit(w, h, offx, offy) {
    // Put a 1 tile border in.
    offx -= 1; offy -= 1;
    w += 2; h += 2;

    this.scrollX = offx;
    this.scrollY = offy;
    const sizeW = this.width / w, sizeH = this.height / h;
    let tileSize;
    if (sizeW > sizeH) {
      tileSize = sizeH;
      this.scrollX -= (this.width/tileSize - w)/2;
    } else {
      tileSize = sizeW;
      this.scrollY -= (this.height/tileSize - h)/2;
    }
    this.zoomLevel = tileSize / 20;
    this.zoomBy(0);
  }

  zoomBy(diff, center) { // Center is {x, y}
    const oldsize = this.size;
    this.zoomLevel += diff;
    this.zoomLevel = clamp(this.zoomLevel, 1/20, 5);

    // this.size = Math.floor(20 * this.zoomLevel);
    this.size = 20 * this.zoomLevel;

    // Recenter
    if (center != null) {
      this.scrollX += center.x / oldsize - center.x / this.size;
      this.scrollY += center.y / oldsize - center.y / this.size;
    }
    this.watch.signal(this);
  }

  snap(center) {
    const fl = Math.floor(this.size);
    // const AMT = 0.05;
    if (this.size != fl) {
      const oldsize = this.size;
      this.size = fl;//(oldsize - fl < AMT) ? fl : oldsize - AMT;

      if (center != null) {
        this.scrollX += center.x / oldsize - center.x / this.size;
        this.scrollY += center.y / oldsize - center.y / this.size;
      }
      return true;
    } else return false;
  }

  scrollBy(dx, dy) {
    this.scrollX += dx / this.size;
    this.scrollY += dy / this.size;
    this.watch.signal(this);
  }

  resizeTo(width, height) {
    this.width = width;
    this.height = height;
    this.watch.signal(this);
  }

  // **** Utility methods

  // given pixel x,y returns unrounded tile x,y. This is useful for cut and glue
  screenToWorldRaw(px, py) {
    if (px == null) return {tx:null, ty:null};
    // first, the top-left pixel of the screen is at |_ scroll * size _| px from origin
    px += Math.floor(this.scrollX * this.size);
    py += Math.floor(this.scrollY * this.size);
    // now we can simply divide and floor to find the tile
    return {
      tx: px / this.size,
      ty: py / this.size
    }
  }

  // given pixel x,y returns tile x,y
  screenToWorld(px, py) {
    const {tx, ty} = this.screenToWorldRaw(px, py)
    if (tx == null) return {tx:null, ty:null}
    else return {tx: Math.floor(tx), ty: Math.floor(ty)}
  }

  // Same as screenToWorld, but also returns which cell in the result.
  screenToWorldCell(px, py, jit) {
    if (px == null) return {tx:null, ty:null};
    // This logic is adapted from screenToWorld above.
    px += Math.floor(this.scrollX * this.size);
    py += Math.floor(this.scrollY * this.size);
    const tx_ = px / this.size, ty_ = py / this.size;
    const tx = Math.floor(tx_), ty = Math.floor(ty_);

    // There's no cell for solid (null) cells.
    const v = jit.get('base', tx, ty);
    if (!v) return {tx, ty, tc:null};

    const offX = tx_ - tx, offY = ty_ - ty;
    const upRight = offX > offY;
    const downRight = offX + offY > 1;

    var tc;
    switch (v) {
      case 'bridge': // The only cells are UP and RIGHT.
        tc = (upRight !== downRight) ? UP : RIGHT;
        break;
      case 'ribbon': case 'ribbonbridge':
        tc = Math.floor(offY * util.NUMINS);
        break;
      case 'negative': case 'positive':
        tc = upRight ? (downRight ? RIGHT : UP) : (downRight ? DOWN : LEFT);
        break;
      default:
        tc = 0;
    }

    return {tx, ty, tc};
  }

  worldToScreen(tx, ty) {
    if (tx == null) return {px:null, py:null};
    return {
      px: tx * this.size - Math.floor(this.scrollX * this.size),
      py: ty * this.size - Math.floor(this.scrollY * this.size)
    };
  }
};

},{"./util":18,"boilerplate-jit":21}],20:[function(require,module,exports){
// Generated by CoffeeScript 1.10.0
var Map2, Map3, Set2, Set3, SetOfPairs, assert, inspect,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

inspect = require('util').inspect;

assert = require('assert');

exports.Set2 = Set2 = require('set2');

Map.prototype.getDef = WeakMap.prototype.getDef = function(k) {
  var v;
  v = this.get(k);
  if (v == null) {
    v = this["default"](k);
    this.set(k, v);
  }
  return v;
};

Set.prototype.map = function(fn) {
  var result;
  result = new Set;
  this.forEach(function(x) {
    return result.add(fn(x));
  });
  return result;
};

exports.Map2 = Map2 = (function(superClass) {
  extend(Map2, superClass);

  function Map2(data) {
    if (typeof data === 'function') {
      this["default"] = data;
      Map2.__super__.constructor.call(this);
    } else {
      Map2.__super__.constructor.call(this, data);
    }
  }

  Map2.prototype.getDef = function(k1, k2) {
    var v;
    v = this.get(k1, k2);
    if (v == null) {
      this.set(k1, k2, v = this["default"](k1, k2));
    }
    return v;
  };

  Map2.prototype.forEach = function(fn) {
    return Map2.__super__.forEach.call(this, function(v, k1, k2) {
      return fn(k1, k2, v);
    });
  };

  return Map2;

})(require('map2'));

exports.Map3 = Map3 = (function() {
  function Map3(data) {
    var i, k1, k2, k3, len, ref, v;
    this.map = new Map;
    this.size = 0;
    if (typeof data === 'function') {
      this["default"] = data;
    } else if (data) {
      for (i = 0, len = data.length; i < len; i++) {
        ref = data[i], k1 = ref[0], k2 = ref[1], k3 = ref[2], v = ref[3];
        this.set(k1, k2, k3, v);
      }
    }
  }

  Map3.prototype.get = function(k1, k2, k3) {
    var l1, l2, v;
    l1 = this.map.get(k1);
    if (l1) {
      l2 = l1.get(k2);
    }
    if (l2) {
      v = l2.get(k3);
    }
    if ((v == null) && this["default"]) {
      this.set(k1, k2, k3, v = this["default"](k1, k2));
    }
    return v;
  };

  Map3.prototype.has = function(k1, k2, k3) {
    var l1, l2;
    l1 = this.map.get(k1);
    if (l1) {
      l2 = l1.get(k2);
    }
    return (l2 != null ? l2.has(k3) : void 0) || false;
  };

  Map3.prototype.set = function(k1, k2, k3, v) {
    var l1, l2;
    l1 = this.map.get(k1);
    if (!l1) {
      l1 = new Map;
      this.map.set(k1, l1);
    }
    l2 = l1.get(k2);
    if (!l2) {
      l2 = new Map;
      l1.set(k2, l2);
    }
    this.size -= l2.size;
    l2.set(k3, v);
    this.size += l2.size;
    return this;
  };

  Map3.prototype["delete"] = function(k1, k2, k3) {
    var deleted, l1, l2;
    l1 = this.map.get(k1);
    if (l1) {
      l2 = l1.get(k2);
    }
    if (l2) {
      deleted = l2["delete"](k3);
      if (deleted) {
        this.size--;
      }
      return deleted;
    } else {
      return false;
    }
  };

  Map3.prototype.forEach = function(fn) {
    return this.map.forEach(function(l1, k1) {
      return l1.forEach(function(l2, k2) {
        return l2.forEach(function(v, k3) {
          return fn(k1, k2, k3, v);
        });
      });
    });
  };

  Map3.prototype.clear = function() {
    return this.map.clear();
  };

  Map3.prototype.inspect = function(depth, options) {
    var entries;
    if (depth < 0) {
      return "[Map3 (" + this.size + ")]";
    }
    if (this.size === 0) {
      return '{[Map3]}';
    }
    entries = [];
    this.forEach(function(k1, k2, k3, v) {
      return entries.push("(" + (inspect(k1, options)) + "," + (inspect(k2, options)) + "," + (inspect(k3, options)) + ") : " + (inspect(v, options)));
    });
    assert(entries.length === this.size);
    return "{[Map3] " + (entries.join(', ')) + " }";
  };

  return Map3;

})();

exports.Set3 = Set3 = (function() {
  function Set3(data) {
    var i, len, ref, v1, v2, v3;
    this.map = new Map;
    this.size = 0;
    if (data) {
      for (i = 0, len = data.length; i < len; i++) {
        ref = data[i], v1 = ref[0], v2 = ref[1], v3 = ref[2];
        this.add(v1, v2, v3);
      }
    }
  }

  Set3.prototype.has = function(v1, v2, v3) {
    var l1, l2;
    l1 = this.map.get(v1);
    if (l1) {
      l2 = l1.get(v2);
    }
    return (l2 != null ? l2.has(v3) : void 0) || false;
  };

  Set3.prototype.add = function(v1, v2, v3) {
    var l1, l2;
    l1 = this.map.get(v1);
    if (!l1) {
      l1 = new Map;
      this.map.set(v1, l1);
    }
    l2 = l1.get(v2);
    if (!l2) {
      l2 = new Set;
      l1.set(v2, l2);
    }
    this.size -= l2.size;
    l2.add(v3);
    this.size += l2.size;
    return this;
  };

  Set3.prototype["delete"] = function(v1, v2, v3) {
    var l1, l2;
    l1 = this.map.get(v1);
    if (l1) {
      l2 = l1.get(v2);
    }
    if (l2 != null ? l2["delete"](v3) : void 0) {
      this.size--;
      if (l2.size === 0) {
        l1["delete"](v2);
        if (l1.size === 0) {
          this.map["delete"](v1);
        }
      }
      return true;
    } else {
      return false;
    }
  };

  Set3.prototype.forEach = function(fn) {
    return this.map.forEach(function(l1, v1) {
      return l1.forEach(function(l2, v2) {
        return l2.forEach(function(v3) {
          return fn(v1, v2, v3);
        });
      });
    });
  };

  Set3.prototype.clear = function() {
    return this.map.clear();
  };

  Set3.prototype.inspect = function(depth, options) {
    var entries;
    if (depth < 0) {
      return "[Set3 (" + this.size + ")]";
    }
    if (this.size === 0) {
      return '{[Set3]}';
    }
    entries = [];
    this.forEach(function(v1, v2, v3) {
      return entries.push("(" + (inspect(v1, options)) + "," + (inspect(v2, options)) + "," + (inspect(v3, options)) + ")");
    });
    assert(entries.length === this.size);
    return "{[Set3] " + (entries.join(', ')) + " }";
  };

  return Set3;

})();

exports.SetOfPairs = SetOfPairs = (function(superClass) {
  extend(SetOfPairs, superClass);

  function SetOfPairs() {
    return SetOfPairs.__super__.constructor.apply(this, arguments);
  }

  SetOfPairs.prototype.add = function(a, b) {
    SetOfPairs.__super__.add.call(this, a, b);
    return SetOfPairs.__super__.add.call(this, b, a);
  };

  SetOfPairs.prototype["delete"] = function(a, b) {
    if (SetOfPairs.__super__["delete"].call(this, a, b)) {
      SetOfPairs.__super__["delete"].call(this, b, a);
      return true;
    } else {
      return false;
    }
  };

  SetOfPairs.prototype.getAll = function(a) {
    return this.map.get(a);
  };

  SetOfPairs.prototype.deleteAll = function(a) {
    var set;
    if (set = this.map.get(a)) {
      set.forEach((function(_this) {
        return function(b) {
          var set2;
          set2 = _this.map.get(b);
          set2["delete"](a);
          if (set2.size === 0) {
            return _this.map["delete"](b);
          }
        };
      })(this));
      this.map["delete"](a);
      this.size -= set.size * 2;
      return true;
    } else {
      return false;
    }
  };

  return SetOfPairs;

})(Set2);

},{"assert":1,"map2":28,"set2":29,"util":9}],21:[function(require,module,exports){
// Generated by CoffeeScript 1.10.0
var collections, i, k, len, ref;

exports.Jit = require('./jit');

exports.util = require('./util');

exports.Watcher = require('./watch');

collections = require('./collections2');

ref = ['Map2', 'Set2', 'Map3', 'Set3'];
for (i = 0, len = ref.length; i < len; i++) {
  k = ref[i];
  exports[k] = collections[k];
}

},{"./collections2":20,"./jit":22,"./util":24,"./watch":25}],22:[function(require,module,exports){
(function (process){
// Generated by CoffeeScript 1.10.0
var AwakeShuttles, BaseBuffer, BaseGrid, BlobFiller, CollapseDetector, CurrentStates, DIRS, DOWN, EngineGrid, FillKeys, GroupConnections, Groups, Jit, LEFT, Map2, Map3, RIGHT, Regions, SHUTTLE, Set2, Set3, SetOfPairs, ShuttleBuffer, ShuttleGrid, ShuttleOverlap, ShuttleStates, StateForce, Step, THINSHUTTLE, UP, Watcher, Zones, abs, assert, compareByPosition, filename, fill, letsShuttleThrough, log, makeId, normalizeShuttleV, parseFile, parseXY, pump, ref, ref1, shuttleConnects, util,
  indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

Watcher = require('./watch');

ref = require('./collections2'), Map2 = ref.Map2, Map3 = ref.Map3, Set2 = ref.Set2, Set3 = ref.Set3, SetOfPairs = ref.SetOfPairs;

ref1 = util = require('./util'), parseXY = ref1.parseXY, fill = ref1.fill, DIRS = ref1.DIRS;

log = require('./log');

assert = require('assert');

UP = 0;

RIGHT = 1;

DOWN = 2;

LEFT = 3;

makeId = (function() {
  var nextId;
  nextId = 1;
  return function() {
    return nextId++;
  };
})();

letsShuttleThrough = function(v) {
  return v === 'nothing' || v === 'bridge' || v === 'ribbon' || v === 'ribbonbridge';
};

log.quiet = true;

abs = function(x) {
  if (x >= 0) {
    return x;
  } else {
    return -x;
  }
};

SHUTTLE = 0x40;

THINSHUTTLE = 0x80;

normalizeShuttleV = function(v) {
  if (typeof v === 'number') {
    return v;
  }
  if (v === 'shuttle') {
    return SHUTTLE | 0xf;
  } else if (v === 'thinshuttle') {
    return THINSHUTTLE | 0xf;
  } else {
    assert.equal(v, null);
    return 0;
  }
};

shuttleConnects = function(sv, dir) {
  return !!(sv & (1 << dir));
};

compareByPosition = function(a, b) {
  var _by, ax, ay, bx;
  ay = a.anchor.y + a.currentState.dy;
  _by = b.anchor.y + b.currentState.dy;
  if (ay !== _by) {
    return ay - _by;
  }
  ax = a.anchor.x + a.currentState.dx;
  bx = b.anchor.x + b.currentState.dx;
  return ax - bx;
};

BaseGrid = function() {
  var afterWatch, beforeWatch, forEach, grid;
  grid = new Map2;
  forEach = function(fn) {
    return grid.forEach(function(x, y, v) {
      return fn(x, y, null, v);
    });
  };
  beforeWatch = new Watcher(forEach);
  afterWatch = new Watcher(forEach);
  return {
    beforeWatch: beforeWatch,
    afterWatch: afterWatch,
    get: grid.get.bind(grid),
    set: function(x, y, v) {
      var oldv;
      assert((v == null) || typeof v === 'string');
      if (v === null || v === 'solid') {
        v = void 0;
      }
      assert(v !== 'shuttle' && v !== 'thinshuttle');
      oldv = grid.get(x, y);
      beforeWatch.signal(x, y, oldv, v);
      oldv = grid.get(x, y);
      if (v !== oldv) {
        if (v) {
          grid.set(x, y, v);
        } else {
          grid["delete"](x, y);
        }
        afterWatch.signal(x, y, oldv, v);
        return true;
      } else {
        return false;
      }
    },
    forEach: grid.forEach.bind(grid),
    checkEmpty: function() {
      return assert.strictEqual(0, grid.size);
    }
  };
};

pump = function(grid) {
  return function(x, y) {
    var v;
    v = grid.get(x, y);
    if (v) {
      grid["delete"](x, y);
    }
    return v;
  };
};

BaseBuffer = function(grid, values) {
  var buffer, watch;
  buffer = new Map2;
  watch = new Watcher;
  grid.afterWatch.forward(function(x, y, oldv, v) {
    if (indexOf.call(values, oldv) >= 0) {
      assert.equal(buffer.get(x, y), oldv);
      buffer["delete"](x, y);
      watch.signal(x, y);
    }
    if (indexOf.call(values, v) >= 0) {
      buffer.set(x, y, v);
      return watch.signal(x, y, v);
    }
  });
  return {
    watch: watch,
    data: buffer,
    pump: pump(buffer)
  };
};

ShuttleBuffer = function() {
  var buffer, watch;
  buffer = new Map2;
  watch = new Watcher;
  return {
    set: function(x, y, v) {
      var connects, connects2, d, d2, dx, dy, j, l, len, len1, oldV, ref2, ref3, v2, x2, y2;
      v = normalizeShuttleV(v);
      watch.signal(x, y, v);
      if (v) {
        if (buffer.get(x, y) === v) {
          return;
        }
        for (d = j = 0, len = DIRS.length; j < len; d = ++j) {
          ref2 = DIRS[d], dx = ref2.dx, dy = ref2.dy;
          connects = shuttleConnects(v, d);
          x2 = x + dx;
          y2 = y + dy;
          v2 = buffer.get(x2, y2);
          if (v2) {
            connects2 = shuttleConnects(v2, (d2 = util.oppositeDir(d)));
            if (connects !== connects2) {
              if (connects) {
                v2 |= 1 << d2;
              } else {
                v2 &= ~(1 << d2);
              }
              buffer.set(x2, y2, v2);
            }
          } else {
            v &= ~(1 << d);
          }
        }
        return buffer.set(x, y, v);
      } else {
        oldV = buffer.get(x, y);
        for (d = l = 0, len1 = DIRS.length; l < len1; d = ++l) {
          ref3 = DIRS[d], dx = ref3.dx, dy = ref3.dy;
          if (!(shuttleConnects(oldV, d))) {
            continue;
          }
          x2 = x + dx;
          y2 = y + dy;
          v2 = buffer.get(x2, y2);
          d2 = util.oppositeDir(d);
          assert(shuttleConnects(v2, d2));
          v2 &= ~(1 << d2);
          buffer.set(x2, y2, v2);
        }
        return buffer["delete"](x, y);
      }
    },
    watch: watch,
    data: buffer,
    pump: pump(buffer)
  };
};

BlobFiller = function(type, buffer) {
  var Blob, addWatch, blobs, deleteBlob, deleteWatch;
  if (type !== 'shuttle' && type !== 'engine') {
    throw Error('Invalid type');
  }
  blobs = new Set;
  addWatch = new Watcher(function(fn) {
    return blobs.forEach(fn);
  });
  deleteWatch = new Watcher;
  deleteBlob = function(b, pos) {
    var dx, dy;
    if (!blobs["delete"](b)) {
      return false;
    }
    assert(!pos || (pos.dx != null));
    log("Destroyed " + type + " " + b.id + " at", b.points);
    assert(b.used);
    b.used = false;
    if (pos) {
      dx = pos.dx, dy = pos.dy;
    } else {
      dx = dy = 0;
    }
    b.points.forEach(function(x2, y2, v) {
      return buffer.data.set(x2 + dx, y2 + dy, v);
    });
    deleteWatch.signal(b);
    return true;
  };
  Blob = function(x, y, v0) {
    this.id = makeId();
    this.used = true;
    this.size = 0;
    this.points = new Map2;
    this.edges = new Set3;
    if (type === 'shuttle') {
      this.pushEdges = new Set3;
      this.numValidStates = 0;
      this.currentState = null;
      this.eachCurrentPoint = function(fn) {
        var dx, dy;
        dx = this.currentState ? this.currentState.dx : 0;
        dy = this.currentState ? this.currentState.dy : 0;
        return this.points.forEach(function(x, y, v) {
          return fn(x + dx, y + dy, v);
        });
      };
      this.blockedX = this.blockedY = null;
      this.stepTag = 0;
      this.imX = this.imY = 0;
      this.imXRem = this.imYRem = 0;
      this.zoneDeps = new Set;
      this.shuttleDeps = new Set;
    }
    this.anchor = {
      x: x,
      y: y
    };
    blobs.add(this);
    util.fill3(x, y, v0, (function(_this) {
      return function(x, y, v, hmm) {
        var d, dx, dy, j, len, ref2, results, v2, x2, y2;
        buffer.pump(x, y);
        _this.size++;
        _this.points.set(x, y, v);
        if (y < _this.anchor.y || (y === _this.anchor.y && x < _this.anchor.x)) {
          _this.anchor.x = x;
          _this.anchor.y = y;
        }
        results = [];
        for (d = j = 0, len = DIRS.length; j < len; d = ++j) {
          ref2 = DIRS[d], dx = ref2.dx, dy = ref2.dy;
          x2 = x + dx;
          y2 = y + dy;
          v2 = _this.points.get(x2, y2) || buffer.data.get(x2, y2);
          if (v2 && ((type === 'shuttle' && shuttleConnects(v, d)) || (type === 'engine' && v2 === v))) {
            if (type === 'shuttle') {
              assert(shuttleConnects(v2, util.oppositeDir(d)));
            }
            hmm(x2, y2, v2);
          } else {
            _this.edges.add(x, y, d);
          }
          if (type === 'shuttle' && v & SHUTTLE && (!v2 || !(v2 & SHUTTLE) || !shuttleConnects(v, d))) {
            results.push(_this.pushEdges.add(x, y, d));
          } else {
            results.push(void 0);
          }
        }
        return results;
      };
    })(this));
    assert(this.size);
    if (type === 'shuttle') {
      assert(this.pushEdges.size === 0 || this.pushEdges.size >= 4);
    }
    if (type === 'engine') {
      this.type = v0;
      this.pressure = (v0 === 'positive' ? 1 : -1) * this.size;
    }
    log(this.id, "Added " + type, this);
    addWatch.signal(this);
  };
  return {
    addWatch: addWatch,
    deleteWatch: deleteWatch,
    flush: function() {
      buffer.data.forEach(function(x, y, v) {
        return new Blob(x, y, v);
      });
      return assert.equal(buffer.data.size, 0);
    },
    flushAt: function(x, y) {
      var v;
      if (v = buffer.data.get(x, y)) {
        return new Blob(x, y, v);
      }
    },
    forEach: function(fn) {
      this.flush();
      return blobs.forEach(fn);
    },
    "delete": deleteBlob,
    check: function(invasive) {
      if (invasive) {
        this.forEach(function() {});
      }
      return blobs.forEach((function(_this) {
        return function(b) {
          assert(b.used);
          return b.points.forEach(function(x, y, v) {
            var c1, c2, d, dx, dy, j, len, ref2, results, v2;
            if (type === 'engine') {
              assert(!buffer.data.has(x, y));
            }
            results = [];
            for (d = j = 0, len = DIRS.length; j < len; d = ++j) {
              ref2 = DIRS[d], dx = ref2.dx, dy = ref2.dy;
              if (b.points.has(x + dx, y + dy)) {
                if (type === 'shuttle') {
                  v2 = b.points.get(x + dx, y + dy);
                  c1 = shuttleConnects(v, d);
                  c2 = shuttleConnects(v2, util.oppositeDir(d));
                  results.push(assert.equal(c1, c2, "Mismatched adjacency in a shuttle: " + c1 + " " + c2));
                } else {
                  results.push(void 0);
                }
              } else {
                if (type === 'engine') {
                  v2 = buffer.data.get(x + dx, y + dy);
                  results.push(assert(v2 !== v));
                } else if (type === 'shuttle') {
                  assert(!shuttleConnects(v, d));
                  if (v & SHUTTLE) {
                    results.push(assert(b.pushEdges.has(x, y, d)));
                  } else {
                    results.push(void 0);
                  }
                } else {
                  results.push(void 0);
                }
              }
            }
            return results;
          });
        };
      })(this));
    }
  };
};

EngineGrid = function(grid, engines) {
  var engineGrid;
  engineGrid = new Map2;
  grid.beforeWatch.forward(function(x, y, oldv, v) {
    var dx, dy, e, j, len, ref2, results;
    if ((oldv === 'positive' || oldv === 'negative') && (e = engineGrid.get(x, y))) {
      engines["delete"](e);
    }
    if (v === 'positive' || v === 'negative') {
      results = [];
      for (j = 0, len = DIRS.length; j < len; j++) {
        ref2 = DIRS[j], dx = ref2.dx, dy = ref2.dy;
        if ((e = engineGrid.get(x + dx, y + dy))) {
          results.push(engines["delete"](e));
        }
      }
      return results;
    }
  });
  engines.addWatch.forward(function(engine) {
    return engine.points.forEach(function(x, y, v) {
      return engineGrid.set(x, y, engine);
    });
  });
  engines.deleteWatch.on(function(engine) {
    return engine.points.forEach(function(x, y) {
      return engineGrid["delete"](x, y);
    });
  });
  return {
    get: function(x, y) {
      var e;
      e = engineGrid.get(x, y);
      if (!e) {
        return engines.flushAt(x, y);
      } else {
        return e;
      }
    },
    check: function(invasive) {
      return engineGrid.forEach(function(x, y, e) {
        var dx, dy, e2, j, len, ref2;
        assert(e.used);
        for (j = 0, len = DIRS.length; j < len; j++) {
          ref2 = DIRS[j], dx = ref2.dx, dy = ref2.dy;
          if ((e2 = engineGrid.get(x + dx, y + dy))) {
            assert(e2 === e || e.type !== e2.type);
          }
        }
        return e.points.forEach(function(x, y, v) {
          return assert.equal(engineGrid.get(x, y), e);
        });
      });
    }
  };
};

ShuttleStates = function(baseGrid, shuttles) {
  var addWatch, canShuttleFitAt, createStateAt, deleteWatch, shuttleStates;
  shuttleStates = new Map;
  addWatch = new Watcher(function(fn) {
    return shuttleStates.forEach(function(shuttle, states) {
      return states.forEach(function(x, y, state) {
        return fn(state);
      });
    });
  });
  deleteWatch = new Watcher;
  shuttles.deleteWatch.on(function(shuttle) {
    var states;
    states = shuttleStates.get(shuttle);
    if (states) {
      shuttleStates["delete"](shuttle);
      return states.forEach(function(x, y, state) {
        return deleteWatch.signal(state);
      });
    }
  });
  canShuttleFitAt = function(shuttle, dx, dy) {
    var fits;
    fits = true;
    shuttle.points.forEach((function(_this) {
      return function(x, y) {
        if (!letsShuttleThrough(baseGrid.get(x + dx, y + dy))) {
          return fits = false;
        }
      };
    })(this));
    return fits;
  };
  createStateAt = function(shuttle, dx, dy) {
    var state, states, valid;
    states = shuttleStates.get(shuttle);
    valid = canShuttleFitAt(shuttle, dx, dy);
    state = {
      dx: dx,
      dy: dy,
      valid: valid,
      shuttle: shuttle,
      id: valid ? shuttle.numValidStates : -1,
      stepTag: 0
    };
    if (valid) {
      shuttle.numValidStates++;
    }
    if (states) {
      states.set(dx, dy, state);
    } else {
      shuttleStates.set(shuttle, new Map2([[dx, dy, state]]));
    }
    if (valid) {
      log('made shuttle state for shuttle', state.id, state.shuttle.id, state.dx, state.dy);
    }
    addWatch.signal(state);
    return state;
  };
  return {
    flushStatesAt: function(x, y) {
      return shuttles.flushAt(x, y);
    },
    addWatch: addWatch,
    deleteWatch: deleteWatch,
    get: function(s) {
      return shuttleStates.get(s);
    },
    getInitialState: function(s) {
      var ref2;
      return ((ref2 = this.get(s)) != null ? ref2.get(0, 0) : void 0) || createStateAt(s, 0, 0);
    },
    collapse: function(shuttle) {
      var saved, states;
      log('collapsing', shuttle);
      saved = shuttle.currentState;
      if (!(states = shuttleStates.get(shuttle))) {
        return;
      }
      return states.forEach(function(dx, dy, state) {
        if (state === saved) {
          return;
        }
        states["delete"](dx, dy);
        return deleteWatch.signal(state);
      });
    },
    getStateNear: function(state, dir) {
      var dx, dy, ref2, successor;
      assert(state.shuttle.used);
      if (!state.valid) {
        return null;
      }
      ref2 = DIRS[dir], dx = ref2.dx, dy = ref2.dy;
      dx += state.dx;
      dy += state.dy;
      successor = shuttleStates.get(state.shuttle).get(dx, dy);
      if (successor == null) {
        successor = createStateAt(state.shuttle, dx, dy);
      }
      if (successor.valid) {
        return successor;
      }
    },
    "delete": function(state) {
      var shuttle;
      log('deleting state', state);
      shuttle = state.shuttle;
      assert(shuttle.used);
      shuttleStates.get(shuttle)["delete"](state.dx, state.dy);
      return deleteWatch.signal(state);
    }
  };
};

ShuttleGrid = function(shuttleStates) {
  var fillGrid, fillWatch, stateGrid, stateWatch;
  fillGrid = new Map2(function() {
    return new Set;
  });
  fillWatch = new Watcher;
  stateGrid = new Map2(function() {
    return new Set;
  });
  stateWatch = new Watcher;
  shuttleStates.addWatch.forward(function(state) {
    return state.shuttle.points.forEach(function(x, y, v) {
      x += state.dx;
      y += state.dy;
      stateGrid.getDef(x, y).add(state);
      stateWatch.signal(x, y);
      if (v & SHUTTLE && state.valid) {
        fillGrid.getDef(x, y).add(state);
        return fillWatch.signal(x, y);
      }
    });
  });
  shuttleStates.deleteWatch.on(function(state) {
    log('shuttle grid removing', state.shuttle.id, state.dx, state.dy);
    return state.shuttle.points.forEach(function(x, y, v) {
      x += state.dx;
      y += state.dy;
      stateGrid.get(x, y)["delete"](state);
      stateWatch.signal(x, y);
      if (v & SHUTTLE && state.valid) {
        fillGrid.get(x, y)["delete"](state);
        return fillWatch.signal(x, y);
      }
    });
  });
  return {
    fillGrid: fillGrid,
    fillWatch: fillWatch,
    stateGrid: stateGrid,
    stateWatch: stateWatch,
    getStates: function(x, y) {
      return stateGrid.get(x, y);
    },
    getShuttle: function(x, y) {
      var ref2, shuttle;
      shuttle = null;
      if ((ref2 = stateGrid.get(x, y)) != null) {
        ref2.forEach(function(state) {
          if (state.shuttle.currentState === state) {
            return shuttle = state.shuttle;
          }
        });
      }
      return shuttle;
    },
    getValue: function(x, y) {
      var dx, dy, ref2, shuttle;
      if (!(shuttle = this.getShuttle(x, y))) {
        return;
      }
      ref2 = shuttle.currentState, dx = ref2.dx, dy = ref2.dy;
      return shuttle.points.get(x - dx, y - dy);
    },
    check: function() {}
  };
};

FillKeys = function(baseGrid, shuttleStates, shuttleGrid) {
  var calcKeyAt, fillKey, fillStates, keysReferencingState, watch;
  fillKey = new Map2;
  fillStates = new Map;
  fillStates["default"] = function() {
    return new Set;
  };
  fillStates.set('', new Set);
  keysReferencingState = new WeakMap;
  keysReferencingState["default"] = function() {
    return new Set;
  };
  watch = new Watcher;
  shuttleGrid.fillWatch.on(function(x, y) {
    return fillKey["delete"](x, y);
  });
  baseGrid.afterWatch.on(function(x, y, oldv, v) {
    if (letsShuttleThrough(oldv)) {
      return fillKey["delete"](x, y);
    }
  });
  shuttleStates.deleteWatch.on(function(state) {
    var ref2;
    return (ref2 = keysReferencingState.get(state)) != null ? ref2.forEach(function(key) {
      fillStates["delete"](key);
      return watch.signal(key);
    }) : void 0;
  });
  calcKeyAt = function(x, y) {
    var j, key, l, len, len1, ref2, set, state, stateList;
    stateList = [];
    if ((ref2 = shuttleGrid.fillGrid.get(x, y)) != null) {
      ref2.forEach(function(state) {
        return stateList.push(state);
      });
    }
    stateList.sort(function(s1, s2) {
      if (s1.shuttle !== s2.shuttle) {
        return s1.shuttle.id - s2.shuttle.id;
      } else {
        return s1.id - s2.id;
      }
    });
    key = stateList.map(function(state) {
      return state.shuttle.id + "." + state.id;
    }).join(' ');
    if (!fillStates.has(key)) {
      set = fillStates.getDef(key);
      for (j = 0, len = stateList.length; j < len; j++) {
        state = stateList[j];
        set.add(state);
      }
    }
    for (l = 0, len1 = stateList.length; l < len1; l++) {
      state = stateList[l];
      keysReferencingState.getDef(state).add(key);
    }
    return key;
  };
  return {
    watch: watch,
    getFilledStates: function(key) {
      return fillStates.get(key);
    },
    getFillKey: function(x, y) {
      var key;
      if (!letsShuttleThrough(baseGrid.get(x, y))) {
        return '';
      }
      shuttleStates.flushStatesAt(x, y);
      key = fillKey.get(x, y);
      if (!key) {
        key = calcKeyAt(x, y);
        fillKey.set(x, y, key);
      }
      return key;
    },
    checkEmpty: function() {
      assert.equal(0, fillKey.size);
      return assert.equal(1, fillStates.size);
    }
  };
};

Groups = function(baseGrid, engines, engineGrid, shuttleGrid, fillKeys) {
  var addWatch, check, deleteGroup, deleteGroupsAt, deleteWatch, edgeGrid, groupGrid, groups, groupsWithEngine, makeGroupAt, pendingCells;
  pendingCells = new Set3;
  groups = new Set;
  groupGrid = new Map3;
  edgeGrid = new Map2(function() {
    return new Set;
  });
  addWatch = new Watcher(groups);
  deleteWatch = new Watcher;
  groupsWithEngine = new WeakMap;
  groupsWithEngine["default"] = function() {
    return new Set;
  };
  deleteGroupsAt = function(x, y) {
    var c, cmax, group, j, ref2, results;
    cmax = util.cellMax(baseGrid.get(x, y));
    results = [];
    for (c = j = 0, ref2 = cmax; 0 <= ref2 ? j < ref2 : j > ref2; c = 0 <= ref2 ? ++j : --j) {
      if ((group = groupGrid.get(x, y, c))) {
        results.push(deleteGroup(group));
      } else {
        results.push(void 0);
      }
    }
    return results;
  };
  deleteGroup = function(group) {
    log(group._id, ': deleting group', group._id);
    assert(group.used);
    group.used = false;
    groups["delete"](group);
    group.engines.forEach(function(e) {
      return groupsWithEngine.get(e)["delete"](group);
    });
    group.points.forEach(function(px, py, pc, pv) {
      pendingCells.add(px, py, pc);
      return groupGrid["delete"](px, py, pc);
    });
    group.edges.forEach(function(x, y, c) {
      return edgeGrid.get(x, y)["delete"](group);
    });
    return deleteWatch.signal(group);
  };
  baseGrid.afterWatch.forward(function(x, y, oldv, v) {
    var c, cmax, dx, dy, group, j, l, len, n, ref2, ref3, ref4, results;
    cmax = util.cellMax(oldv);
    for (c = j = 0, ref2 = cmax; 0 <= ref2 ? j < ref2 : j > ref2; c = 0 <= ref2 ? ++j : --j) {
      if ((group = groupGrid.get(x, y, c))) {
        deleteGroup(group);
      }
      pendingCells["delete"](x, y, c);
    }
    for (l = 0, len = DIRS.length; l < len; l++) {
      ref3 = DIRS[l], dx = ref3.dx, dy = ref3.dy;
      deleteGroupsAt(x + dx, y + dy);
    }
    results = [];
    for (c = n = 0, ref4 = util.cellMax(v); 0 <= ref4 ? n < ref4 : n > ref4; c = 0 <= ref4 ? ++n : --n) {
      results.push(pendingCells.add(x, y, c));
    }
    return results;
  });
  engines.deleteWatch.on(function(e) {
    var set;
    set = groupsWithEngine.get(e);
    if (set) {
      set.forEach(function(g) {
        return deleteGroup(g);
      });
      return groupsWithEngine["delete"](e);
    }
  });
  shuttleGrid.fillWatch.on(function(x, y) {
    var ref2;
    deleteGroupsAt(x, y);
    return (ref2 = edgeGrid.get(x, y)) != null ? ref2.forEach(function(g) {
      return deleteGroup(g);
    }) : void 0;
  });
  makeGroupAt = function(x, y, c) {
    var filledStates, group, key, shuttles, v0;
    v0 = baseGrid.get(x, y);
    assert(v0 != null);
    assert(c < util.cellMax(v0));
    assert(pendingCells.has(x, y, c));
    key = fillKeys.getFillKey(x, y);
    filledStates = fillKeys.getFilledStates(key);
    shuttles = util.uniqueShuttlesInStates(filledStates);
    group = {
      _id: makeId(),
      used: true,
      size: 0,
      fillKey: key,
      points: new Map3,
      edges: new Set3,
      shuttles: shuttles,
      shuttleKey: shuttles.map(function(s) {
        return "" + s.id;
      }).join(' '),
      useless: true,
      engines: new Set
    };
    log(group._id, ': makeGroupAt', x, y, c, "'" + key + "'");
    util.fill3(x, y, c, function(x, y, c, hmm) {
      var c2, e, j, len, ref2, ref3, v, x2, y2;
      v = baseGrid.get(x, y);
      if (!v) {
        return;
      }
      if (v && (v !== 'positive' && v !== 'negative')) {
        group.useless = false;
      }
      if (fillKeys.getFillKey(x, y) !== key) {
        group.edges.add(x, y, c);
        edgeGrid.getDef(x, y).add(group);
        return;
      }
      log('fillCells', x, y, c, v);
      group.points.set(x, y, c, v);
      group.size++;
      assert(!groupGrid.has(x, y, c));
      groupGrid.set(x, y, c, group);
      assert(pendingCells.has(x, y, c));
      pendingCells["delete"](x, y, c);
      if (v === 'positive' || v === 'negative') {
        e = engineGrid.get(x, y);
        group.engines.add(e);
        groupsWithEngine.getDef(e).add(group);
      }
      ref2 = util.connectedCells(baseGrid, x, y, c);
      for (j = 0, len = ref2.length; j < len; j++) {
        ref3 = ref2[j], x2 = ref3[0], y2 = ref3[1], c2 = ref3[2];
        hmm(x2, y2, c2);
      }
    });
    groups.add(group);
    if (!group.useless) {
      log(group._id, ': made group', group.points);
    }
    assert(group.size);
    assert(group.used);
    addWatch.signal(group);
    return group;
  };
  return {
    addWatch: addWatch,
    deleteWatch: deleteWatch,
    get: function(x, y, c) {
      var g, v;
      g = groupGrid.get(x, y, c);
      if (!g) {
        v = baseGrid.get(x, y);
        assert((0 <= c && c < util.cellMax(v)));
        if (v != null) {
          g = makeGroupAt(x, y, c);
        }
      }
      if (!g.useless) {
        return g;
      }
    },
    getDir: function(x, y, dir) {
      var c, v;
      v = baseGrid.get(x, y);
      if (!v) {
        return;
      }
      if (v === 'ribbon' || v === 'ribbonbridge') {
        return;
      }
      c = (function() {
        switch (v) {
          case 'positive':
          case 'negative':
            return dir;
          case 'bridge':
            return dir % 2;
          default:
            return 0;
        }
      })();
      return this.get(x, y, c);
    },
    flush: function() {
      return pendingCells.forEach(function(x, y, c) {
        return makeGroupAt(x, y, c);
      });
    },
    forEach: function(fn) {
      this.flush();
      return groups.forEach(function(g) {
        if (!g.useless) {
          return fn(g);
        }
      });
    },
    check: check = function() {
      return groups.forEach(function(g) {
        return g.points.forEach(function(x, y, c) {
          return assert.equal(groupGrid.get(x, y, c), g);
        });
      });
    },
    checkEmpty: function() {
      assert.equal(0, groups.size);
      assert.equal(0, groupGrid.size);
      return assert.equal(0, pendingCells.size);
    }
  };
};

StateForce = function(grid, shuttleStates, shuttleGrid, groups) {
  var deleteForce, makeForce, stateForGroup, stateForce, watch;
  stateForce = new Map;
  stateForce["default"] = function(state) {
    return makeForce(state);
  };
  stateForGroup = new Map;
  stateForGroup["default"] = function() {
    return new Set;
  };
  watch = new Watcher;
  shuttleStates.deleteWatch.on(function(state0) {
    var dx, dy, j, len, ref2, results, state, states;
    deleteForce(state0);
    if ((states = shuttleStates.get(state0.shuttle))) {
      results = [];
      for (j = 0, len = DIRS.length; j < len; j++) {
        ref2 = DIRS[j], dx = ref2.dx, dy = ref2.dy;
        state = states.get(state0.dx + dx, state0.dy + dy);
        if (state) {
          results.push(deleteForce(state));
        } else {
          results.push(void 0);
        }
      }
      return results;
    }
  });
  grid.afterWatch.on(function(x, y, oldv, v) {
    var dx, dy, j, len, ref2, results, states;
    if (util.cellMax(oldv) === 0) {
      results = [];
      for (j = 0, len = DIRS.length; j < len; j++) {
        ref2 = DIRS[j], dx = ref2.dx, dy = ref2.dy;
        states = shuttleGrid.getStates(x + dx, y + dy);
        results.push(states != null ? states.forEach(deleteForce) : void 0);
      }
      return results;
    }
  });
  groups.deleteWatch.on(function(group) {
    var set;
    log('got group deleted', group._id);
    if ((set = stateForGroup.get(group))) {
      set.forEach(function(state) {
        return deleteForce(state);
      });
      return assert(!stateForGroup.has(group));
    }
  });
  deleteForce = function(state) {
    var delGroups, force, ref2, ref3;
    if ((force = stateForce.get(state))) {
      stateForce["delete"](state);
      log('deleteForce', state.shuttle.id, state.dx, state.dy);
      force.used = false;
      delGroups = function(pressure, group) {
        var set;
        if ((set = stateForGroup.get(group))) {
          set["delete"](state);
          if (set.size === 0) {
            return stateForGroup["delete"](group);
          }
        }
      };
      if ((ref2 = force.x) != null) {
        ref2.forEach(delGroups);
      }
      if ((ref3 = force.y) != null) {
        ref3.forEach(delGroups);
      }
      return watch.signal(state, force);
    }
  };
  makeForce = function(state) {
    var canMoveX, canMoveY, force, j, len, map, ref2, ref3, ref4;
    log('makeForce', state.shuttle.id, state.dx, state.dy);
    assert(state.shuttle.used);
    assert(state.valid);
    canMoveX = shuttleStates.getStateNear(state, LEFT) || shuttleStates.getStateNear(state, RIGHT);
    canMoveY = shuttleStates.getStateNear(state, UP) || shuttleStates.getStateNear(state, DOWN);
    force = {
      x: canMoveX ? new Map : void 0,
      y: canMoveY ? new Map : void 0,
      used: true
    };
    if ((ref2 = force.x) != null) {
      ref2["default"] = function() {
        return 0;
      };
    }
    if ((ref3 = force.y) != null) {
      ref3["default"] = function() {
        return 0;
      };
    }
    if (canMoveX || canMoveY) {
      state.shuttle.pushEdges.forEach(function(x, y, dir) {
        var dx, dy, f, group, map, ref4;
        x += state.dx;
        y += state.dy;
        if (dir === LEFT || dir === RIGHT) {
          if (!canMoveX) {
            return;
          }
          map = force.x;
          f = dir === LEFT ? -1 : 1;
        } else {
          if (!canMoveY) {
            return;
          }
          map = force.y;
          f = dir === UP ? -1 : 1;
        }
        ref4 = DIRS[dir], dx = ref4.dx, dy = ref4.dy;
        log('edge', x, y);
        log('looking in', x + dx, y + dy, util.oppositeDir(dir));
        group = groups.getDir(x + dx, y + dy, util.oppositeDir(dir));
        if (!group) {
          return;
        }
        return map.set(group, map.getDef(group) + f);
      });
    }
    ref4 = [force.x, force.y];
    for (j = 0, len = ref4.length; j < len; j++) {
      map = ref4[j];
      if (map) {
        map.forEach(function(pressure, group) {
          if (pressure === 0) {
            return map["delete"](group);
          } else {
            return stateForGroup.getDef(group).add(state);
          }
        });
      }
    }
    return force;
  };
  return {
    watch: watch,
    get: function(state) {
      var f;
      f = stateForce.getDef(state);
      assert(f.used);
      return f;
    }
  };
};

GroupConnections = function(groups) {
  var complete, connections, findConnections;
  connections = new SetOfPairs;
  complete = new WeakSet;
  groups.deleteWatch.on(function(group) {
    var gc;
    if ((gc = connections.getAll(group))) {
      gc.forEach(function(g2) {
        return complete["delete"](g2);
      });
    }
    return connections.deleteAll(group);
  });
  findConnections = function(group) {
    assert(group.used);
    group.edges.forEach(function(x, y, c) {
      var g2;
      g2 = groups.get(x, y, c);
      assert(g2.used);
      return connections.add(group, g2);
    });
    return complete.add(group);
  };
  return {
    get: function(group) {
      if (!complete.has(group)) {
        findConnections(group);
      }
      return connections.getAll(group);
    },
    check: function(invasive) {
      if (invasive) {
        groups.forEach((function(_this) {
          return function(g) {
            var set;
            set = _this.get(g);
            return assert(set);
          };
        })(this));
      }
      return connections.forEach(function(group1, group2) {
        var found;
        if (invasive) {
          assert(complete.has(group1));
          assert(complete.has(group2));
        }
        if (!complete.has(group1)) {
          return;
        }
        assert(group1.used);
        assert(group2.used);
        found = false;
        group1.edges.forEach(function(x, y, c) {
          if (group2.points.has(x, y, c)) {
            return found = true;
          }
        });
        return assert(found);
      });
    },
    checkEmpty: function() {
      return assert.equal(0, connections.size);
    }
  };
};

Regions = function(fillKeys, groups, groupConnections) {
  var Region, deleteRegion, makeRegion, regions, regionsForGroup, regionsTouchingGroup, watch;
  regionsForGroup = new Map;
  regionsForGroup["default"] = function(g) {
    return new util.ShuttleStateMap(g.shuttles);
  };
  regionsTouchingGroup = new Map;
  regionsTouchingGroup["default"] = function() {
    return new Set;
  };
  regions = new Set;
  watch = new Watcher;
  groups.deleteWatch.on(function(group) {
    var map, set;
    map = regionsForGroup.get(group);
    if (!map) {
      return;
    }
    regionsForGroup["delete"](group);
    map.forEachValue(function(region) {
      return deleteRegion(region);
    });
    set = regionsTouchingGroup.get(group);
    if (set) {
      set.forEach(function(region) {
        return deleteRegion(region);
      });
      return regionsTouchingGroup["delete"](group);
    }
  });
  deleteRegion = function(region) {
    log('delete region', region._id);
    assert(region.used);
    region.used = false;
    regions["delete"](region);
    region.groups.forEach(function(group) {
      var ref2;
      return (ref2 = regionsForGroup.get(group)) != null ? ref2["delete"](region.states) : void 0;
    });
    region.edges.forEach(function(group) {
      var set;
      if ((set = regionsTouchingGroup.get(group))) {
        set["delete"](region);
        if (set.size === 0) {
          return regionsTouchingGroup["delete"](group);
        }
      }
    });
    return watch.signal(region);
  };
  Region = function(group0, trimmedStates, shuttleStateMap) {
    var shuttleKey;
    assert(regionsForGroup.getDef(group0).isDefinedFor(shuttleStateMap));
    shuttleKey = group0.shuttleKey;
    this._id = makeId();
    this.used = true;
    this.size = 0;
    this.groups = new Set;
    this.states = trimmedStates;
    this.edges = new Set;
    this.engines = new Set;
    log(this._id, ': createRegion from group', group0._id);
    util.fillGraph(group0, (function(_this) {
      return function(group, hmm) {
        var filled, filledStates, ref2;
        if (group.shuttleKey !== shuttleKey) {
          _this.edges.add(group);
          regionsTouchingGroup.getDef(group).add(_this);
          return;
        }
        filledStates = fillKeys.getFilledStates(group.fillKey);
        filled = false;
        trimmedStates.forEach(function(state) {
          if (filledStates.has(state)) {
            return filled = true;
          }
        });
        if (filled) {
          return;
        }
        regionsForGroup.getDef(group).set(trimmedStates, _this);
        _this.size++;
        _this.groups.add(group);
        group.engines.forEach(function(e) {
          return _this.engines.add(e);
        });
        return (ref2 = groupConnections.get(group)) != null ? ref2.forEach(hmm) : void 0;
      };
    })(this));
    assert(this.size);
    regions.add(this);
    log(this._id, ': Made region with groups', this.groups.map(function(g) {
      return {
        id: g._id,
        points: g.points
      };
    }));
  };
  makeRegion = function(group, shuttleStateMap) {
    var filledStates, invalid, trimmedStates;
    trimmedStates = new Map;
    invalid = false;
    filledStates = fillKeys.getFilledStates(group.fillKey);
    group.shuttles.forEach(function(s) {
      var state;
      state = shuttleStateMap.get(s);
      trimmedStates.set(s, state);
      if (filledStates.has(state)) {
        return invalid = true;
      }
    });
    if (invalid) {
      regionsForGroup.getDef(group).set(shuttleStateMap, null);
      return null;
    }
    return new Region(group, trimmedStates, shuttleStateMap);
  };
  return {
    watch: watch,
    get: function(group, shuttleStateMap) {
      var map, region;
      map = regionsForGroup.getDef(group);
      region = map.get(shuttleStateMap);
      if (region === void 0) {
        region = makeRegion(group, shuttleStateMap);
      }
      if (region === null) {
        return null;
      }
      return region;
    },
    check: function() {
      return regions.forEach(function(r) {
        assert(r.used);
        assert(r.size);
        return r.groups.forEach(function(g) {
          return assert(g.used);
        });
      });
    },
    checkEmpty: function() {
      assert.equal(0, regionsForGroup.size);
      assert.equal(0, regionsTouchingGroup.size);
      return assert.equal(0, regions.size);
    }
  };
};

CurrentStates = function(shuttles, stateForce, shuttleStates) {
  var _flush, currentStates, watch;
  currentStates = new Map;
  watch = new Watcher;
  shuttles.addWatch.forward(function(s) {
    var state;
    state = shuttleStates.getInitialState(s);
    s.currentState = state;
    currentStates.set(s, state);
    return watch.signal(s, null, state);
  });
  shuttles.deleteWatch.on(function(s) {
    currentStates["delete"](s);
    return s.currentState = null;
  });
  _flush = function(shuttle) {};
  return {
    map: currentStates,
    watch: watch,
    set: function(shuttle, state) {
      var prevState;
      assert.strictEqual(state.shuttle, shuttle);
      if (shuttle.currentState === state) {
        return;
      }
      log("moving " + shuttle.id + " to " + state.dx + "," + state.dy);
      prevState = shuttle.currentState;
      shuttle.currentState = state;
      currentStates.set(shuttle, state);
      return watch.signal(shuttle, prevState, state);
    }
  };
};

CollapseDetector = function(grid, shuttleBuffer, shuttles, shuttleStates, shuttleGrid) {
  grid.beforeWatch.forward(function(x, y, oldv, v) {
    var newPassable, oldPassable, ref2, ref3;
    oldPassable = letsShuttleThrough(oldv);
    newPassable = letsShuttleThrough(v);
    if (!oldPassable && newPassable) {
      return (ref2 = shuttleGrid.stateGrid.get(x, y)) != null ? ref2.forEach(function(state) {
        if (!state.valid) {
          return shuttleStates["delete"](state);
        }
      }) : void 0;
    } else if (oldPassable && !newPassable) {
      return (ref3 = shuttleGrid.stateGrid.get(x, y)) != null ? ref3.forEach(function(state) {
        var shuttle;
        shuttle = state.shuttle;
        if (shuttle.currentState === state) {
          return shuttles["delete"](shuttle, state);
        } else {
          return shuttleStates.collapse(shuttle);
        }
      }) : void 0;
    }
  });
  return shuttleBuffer.watch.on(function(x, y, v) {
    var d, dx, dy, j, len, ref2, results, shuttle;
    shuttle = shuttleGrid.getShuttle(x, y);
    if (shuttle) {
      shuttles["delete"](shuttle, shuttle.currentState);
    }
    results = [];
    for (d = j = 0, len = DIRS.length; j < len; d = ++j) {
      ref2 = DIRS[d], dx = ref2.dx, dy = ref2.dy;
      if (shuttleConnects(v, d)) {
        if ((shuttle = shuttleGrid.getShuttle(x + dx, y + dy))) {
          results.push(shuttles["delete"](shuttle, shuttle.currentState));
        } else {
          results.push(void 0);
        }
      }
    }
    return results;
  });
};

Zones = function(shuttles, regions, currentStates) {
  var buffer, buffering, deleteZone, deleteZonesWithShuttle, makeZone, watch, zoneForRegion, zonesDependingOnShuttle;
  zoneForRegion = new Map;
  zonesDependingOnShuttle = new Map;
  zonesDependingOnShuttle["default"] = function() {
    return new Set;
  };
  watch = new Watcher;
  buffering = false;
  buffer = [];
  regions.watch.on(function(r) {
    deleteZone(zoneForRegion.get(r));
    return zoneForRegion["delete"](r);
  });
  deleteZonesWithShuttle = function(shuttle) {
    var ref2;
    log('deleteZonesWithShuttle', shuttle.id);
    if ((ref2 = zonesDependingOnShuttle.get(shuttle)) != null) {
      ref2.forEach(function(zone) {
        return deleteZone(zone);
      });
    }
    return zonesDependingOnShuttle["delete"](shuttle);
  };
  shuttles.deleteWatch.on(deleteZonesWithShuttle);
  currentStates.watch.on(deleteZonesWithShuttle);
  deleteZone = function(z) {
    if (!(z != null ? z.used : void 0)) {
      return;
    }
    log('deleting zone', z._id);
    z.used = false;
    if (buffering) {
      return buffer.push(z);
    } else {
      return watch.signal(z);
    }
  };
  makeZone = function(r0) {
    var engines, zone;
    zone = {
      _id: makeId(),
      used: true,
      pressure: 0,
      fixed: true,
      filled: false
    };
    log(zone._id, ': makezone from', r0 != null ? r0._id : void 0);
    engines = new Set;
    if (r0) {
      util.fillGraph(r0, function(r, hmm) {
        var ref2;
        log('zone fillGraph', r._id);
        assert(!((ref2 = zoneForRegion.get(r)) != null ? ref2.used : void 0));
        zoneForRegion.set(r, zone);
        if (r.states.size) {
          zone.fixed = false;
        }
        r.states.forEach(function(state) {
          return zonesDependingOnShuttle.getDef(state.shuttle).add(zone);
        });
        r.engines.forEach(function(e) {
          if (!engines.has(e)) {
            assert(e.used);
            engines.add(e);
            return zone.pressure += e.pressure;
          }
        });
        return r.edges.forEach(function(group) {
          var j, len, ref3, shuttle;
          assert(group.used);
          r = regions.get(group, currentStates.map);
          if (r === null) {
            ref3 = group.shuttles;
            for (j = 0, len = ref3.length; j < len; j++) {
              shuttle = ref3[j];
              zonesDependingOnShuttle.getDef(shuttle).add(zone);
            }
          }
          if (r) {
            return hmm(r);
          }
        });
      });
    }
    return zone;
  };
  return {
    startBuffer: function() {
      return buffering = true;
    },
    flushBuffer: function() {
      var j, len, z;
      for (j = 0, len = buffer.length; j < len; j++) {
        z = buffer[j];
        watch.signal(z);
      }
      buffer.length = 0;
      return buffering = false;
    },
    watch: watch,
    makeZoneUnderShuttle: function(shuttle) {
      var zone;
      zone = makeZone(null);
      zonesDependingOnShuttle.getDef(shuttle).add(zone);
      zone.filled = true;
      return zone;
    },
    getZoneForRegion: function(region) {
      var zone;
      assert(region);
      zone = zoneForRegion.get(region);
      if (!(zone != null ? zone.used : void 0)) {
        zone = makeZone(region);
      }
      return zone;
    },
    getZoneForGroup: function(group) {
      var r;
      r = regions.get(group, currentStates.map);
      if (r) {
        return this.getZoneForRegion(r);
      } else {
        return null;
      }
    },
    checkEmpty: function() {
      return assert.strictEqual(0, zoneForRegion.size);
    }
  };
};

AwakeShuttles = function(shuttles, shuttleStates, stateForce, currentStates, zones) {
  var awake, clearDeps, shuttlesForZone, wake;
  awake = new Set;
  shuttlesForZone = new Map;
  shuttlesForZone["default"] = function() {
    return new Set;
  };
  shuttles.deleteWatch.on(function(s) {
    log('s deletewatch', s);
    wake(s);
    return awake["delete"](s);
  });
  zones.watch.on(function(z) {
    var set;
    log('zw', z._id, z);
    if ((set = shuttlesForZone.get(z))) {
      log('zones watch', z._id);
      set.forEach(function(s) {
        return wake(s, 'adjacent zone killed');
      });
      return shuttlesForZone["delete"](z);
    }
  });
  stateForce.watch.on(function(state) {
    if (state.shuttle.currentState === state) {
      return wake(state.shuttle, 'force recalculated');
    }
  });
  currentStates.watch.on(function(shuttle) {
    return wake(shuttle, 'shuttle state changed');
  });
  shuttleStates.deleteWatch.on(function(state) {
    log('state deletewatch', state);
    return wake(state.shuttle, 'state was deleted');
  });
  clearDeps = function(shuttle) {
    zones = shuttle.zoneDeps;
    zones.forEach(function(z) {
      var ref2;
      return (ref2 = shuttlesForZone.get(z)) != null ? ref2["delete"](shuttle) : void 0;
    });
    zones.clear();
    shuttle.shuttleDeps.forEach(function(s2) {
      return s2.shuttleDeps["delete"](shuttle);
    });
    return shuttle.shuttleDeps.clear();
  };
  wake = function(shuttle, reason) {
    if (awake.has(shuttle)) {
      if (reason) {
        log('redundant wake', shuttle.id, reason);
      }
      return;
    }
    log("waking " + shuttle.id + " because " + reason);
    awake.add(shuttle);
    shuttle.shuttleDeps.forEach(function(s2) {
      log('-> depends on', s2.id);
      return wake(s2, 'shuttle dependancy moved');
    });
    return clearDeps(shuttle);
  };
  return {
    data: awake,
    sleep: function(shuttle) {
      var actuallyAsleep;
      if (!awake.has(shuttle)) {
        return;
      }
      awake["delete"](shuttle);
      zones = shuttle.zoneDeps;
      actuallyAsleep = true;
      zones.forEach(function(z) {
        if (!z.used) {
          return actuallyAsleep = false;
        }
      });
      zones.forEach(function(z) {
        return shuttlesForZone.getDef(z).add(shuttle);
      });
      return log('setAsleepDeps', shuttle.id);
    },
    forEach: function(fn) {
      shuttles.flush();
      return awake.forEach(fn);
    },
    isAwake: function(shuttle) {
      return awake.has(shuttle);
    },
    check: function() {
      awake.forEach(function(s) {
        assert.strictEqual(s.zoneDeps.size, 0);
        return assert.strictEqual(s.shuttleDeps.size, 0);
      });
      shuttlesForZone.forEach(function(shuttles, zone) {
        assert(zone.used);
        return shuttles.forEach(function(s) {
          assert(s.used);
          assert(!awake.has(s));
          return assert(s.zoneDeps.has(zone));
        });
      });
      return shuttles.forEach(function(s) {
        s.zoneDeps.forEach(function(z) {
          return assert(shuttlesForZone.get(z).has(s));
        });
        return s.shuttleDeps.forEach(function(s2) {
          return assert(s2.shuttleDeps.has(s));
        });
      });
    },
    checkEmpty: function() {
      return assert.strictEqual(awake.size, 0);
    },
    stats: function() {
      return console.log('shuttlesForZone.size:', shuttlesForZone.size);
    }
  };
};

ShuttleOverlap = function(shuttleStates, shuttleGrid) {
  var overlappingStates;
  overlappingStates = new SetOfPairs;
  shuttleStates.addWatch.forward(function(state1) {
    if (!state1.valid) {
      return;
    }
    return state1.shuttle.points.forEach(function(x, y) {
      var ref2;
      return (ref2 = shuttleGrid.stateGrid.get(x + state1.dx, y + state1.dy)) != null ? ref2.forEach(function(state2) {
        if (state2.shuttle === state1.shuttle) {
          return;
        }
        return overlappingStates.add(state1, state2);
      }) : void 0;
    });
  });
  shuttleStates.deleteWatch.on(function(state) {
    return overlappingStates.deleteAll(state);
  });
  return {
    forEach: function(state1, fn) {
      var ref2;
      return (ref2 = overlappingStates.getAll(state1)) != null ? ref2.forEach(function(state2) {
        return fn(state2, state2.shuttle);
      }) : void 0;
    },
    willOverlap: function(state1) {
      var overlap;
      overlap = false;
      this.forEach(state1, function(state2, s2) {
        if (s2.currentState === state2) {
          return overlap = true;
        }
      });
      return overlap;
    }
  };
};

Step = function(modules) {
  var awakeShuttles, calcImpulse, currentStates, fillKeys, shuttleOverlap, shuttleStates, shuttles, shuttlesX, shuttlesY, stateForce, step, tag, tryMove, zones;
  zones = modules.zones, shuttles = modules.shuttles, awakeShuttles = modules.awakeShuttles, shuttleStates = modules.shuttleStates, stateForce = modules.stateForce, currentStates = modules.currentStates, shuttleOverlap = modules.shuttleOverlap, fillKeys = modules.fillKeys;
  tag = 0;
  shuttlesX = [];
  shuttlesY = [];
  calcImpulse = function(shuttle, f) {
    var impulse;
    if (!f) {
      return 0;
    }
    impulse = 0;
    f.forEach(function(mult, group) {
      var blockingShuttle, filledStates, zone;
      assert(group.used);
      zone = zones.getZoneForGroup(group);
      if (zone) {
        assert(zone.used);
        if (zone.pressure) {
          log('pressure', zone.pressure);
        }
        impulse -= mult * zone.pressure;
      } else {
        filledStates = fillKeys.getFilledStates(group.fillKey);
        blockingShuttle = null;
        group.shuttles.forEach(function(s) {
          if (filledStates.has(s.currentState)) {
            assert.equal(blockingShuttle, null);
            return blockingShuttle = s;
          }
        });
        assert(blockingShuttle);
        zone = zones.makeZoneUnderShuttle(blockingShuttle);
      }
      return shuttle.zoneDeps.add(zone);
    });
    return impulse;
  };
  tryMove = function(shuttle, isTop) {
    var blocked, dir, i, im, im2, j, l, len, len1, len2, moved, mul, n, needSort, newTag, nextState, oppositingForce, s, s2, shuttleGlob, shuttleList, take;
    newTag = isTop ? tag : -tag;
    if (shuttle.stepTag === -newTag) {
      return false;
    }
    moved = false;
    im = isTop ? shuttle.imYRem : shuttle.imXRem;
    if (!im) {
      return false;
    }
    mul = 1;
    dir = im < 0 ? (im = -im, mul = -1, isTop ? UP : LEFT) : isTop ? DOWN : RIGHT;
    log('tryMove shuttle', shuttle.id, util.DN[dir], im);
    shuttleList = [shuttle];
    needSort = false;
    shuttleGlob = new Set;
    shuttleGlob.add(shuttle);
    while (im) {
      assert(im > 0);
      blocked = false;
      oppositingForce = 0;
      i = 0;
      while (i < shuttleList.length) {
        s = shuttleList[i];
        nextState = shuttleStates.getStateNear(s.currentState, dir);
        if (!nextState) {
          log('shuttle hit wall in dir', util.DN[dir], 'from state', s.currentState.dx, s.currentState.dy);
          blocked = true;
          if (s !== shuttle) {
            shuttle.shuttleDeps.add(s);
            s.shuttleDeps.add(shuttle);
          }
          break;
        }
        shuttleOverlap.forEach(nextState, function(state2, s2) {
          var im2;
          if (state2.stepTag === -newTag) {
            log('Blocked by shadow');
            return blocked = true;
          }
          if (s2.currentState !== state2) {
            return;
          }
          if (s2.stepTag === -newTag) {
            log('blocked by shuttle');
            return blocked = true;
          }
          if (!shuttleGlob.has(s2)) {
            shuttleGlob.add(s2);
            shuttleList.push(s2);
            needSort = true;
            im2 = -mul * (isTop ? s2.imYRem : s2.imXRem);
            if (im2 > 0) {
              return oppositingForce += im2;
            }
          }
        });
        i++;
      }
      if (blocked) {
        break;
      }
      if (oppositingForce > im) {
        log('Opposing force too great', oppositingForce, im);
        if (needSort) {
          shuttleList.sort(compareByPosition);
        }
        needSort = false;
        for (j = 0, len = shuttleList.length; j < len; j++) {
          s2 = shuttleList[j];
          if (!(s2 !== shuttle)) {
            continue;
          }
          im2 = -mul * (isTop ? s2.imYRem : s2.imXRem);
          if (im2 > 0) {
            take = Math.min(im, im2);
            assert(take > 0);
            assert(awakeShuttles.isAwake(s2));
            shuttle.shuttleDeps.add(s2);
            s2.shuttleDeps.add(shuttle);
            im2 -= take;
            im -= take;
            if (isTop) {
              s2.imYRem = -im2 * mul;
            } else {
              s2.imXRem = -im2 * mul;
            }
            if (im === 0) {
              break;
            }
          }
        }
      } else if (oppositingForce > 0) {
        log('Crushing resistance force of', oppositingForce);
        im -= oppositingForce;
        for (l = 0, len1 = shuttleList.length; l < len1; l++) {
          s2 = shuttleList[l];
          if (!(s2 !== shuttle)) {
            continue;
          }
          im2 = -mul * (isTop ? s2.imYRem : s2.imXRem);
          if (im2 > 0) {
            assert(awakeShuttles.isAwake(s2));
            shuttle.shuttleDeps.add(s2);
            s2.shuttleDeps.add(shuttle);
            if (isTop) {
              s2.imYRem = 0;
            } else {
              s2.imXRem = 0;
            }
          }
        }
      }
      if (im === 0) {
        break;
      }
      assert(im > 0);
      im--;
      for (n = 0, len2 = shuttleList.length; n < len2; n++) {
        s2 = shuttleList[n];
        nextState = shuttleStates.getStateNear(s2.currentState, dir);
        assert(nextState);
        s2.stepTag = newTag;
        s2.currentState.stepTag = newTag;
        log('Moving shuttle', s2.id, 'to state', nextState.dx, nextState.dy);
        currentStates.set(s2, nextState);
        moved = true;
        if (isTop) {
          s2.imXRem = 0;
        } else {
          s2.imYRem = 0;
        }
        im2 = mul * (isTop ? s2.imYRem : s2.imXRem);
        if (im2 > 0) {
          im2--;
          if (isTop) {
            s2.imYRem = im2 * mul;
          } else {
            s2.imXRem = im2 * mul;
          }
        }
      }
      moved = true;
    }
    if (isTop) {
      shuttle.imYRem = im * mul;
    } else {
      shuttle.imXRem = im * mul;
    }
    log('tryMove ->', moved);
    return moved;
  };
  return step = function() {
    var ix, iy, j, l, len, len1, numMoved, ref2, ref3, s, sx, sy;
    tag++;
    log("************** STEP " + tag + " **************");
    log('** phase 1) calculating pressure ***');
    zones.startBuffer();
    awakeShuttles.forEach(function(shuttle) {
      var force, fx, fy, im;
      assert.equal(shuttle.zoneDeps.size, 0);
      assert.equal(shuttle.shuttleDeps.size, 0);
      log('step() looking at shuttle', shuttle.id);
      Jit.stats.checks++;
      if (shuttle.held) {
        return;
      }
      assert(shuttle.used);
      force = stateForce.get(shuttle.currentState);
      fx = force.x, fy = force.y;
      if ((im = calcImpulse(shuttle, fx))) {
        shuttle.imXRem = shuttle.imX = im;
        shuttlesX.push(shuttle);
      }
      if ((im = calcImpulse(shuttle, fy))) {
        shuttle.imYRem = shuttle.imY = im;
        shuttlesY.push(shuttle);
      }
      return log('impulse', shuttle.imX, shuttle.imY);
    });
    shuttlesX.sort(function(a, b) {
      var impulseDiff;
      impulseDiff = abs(b.imX) - abs(a.imX);
      if (impulseDiff) {
        return impulseDiff;
      } else {
        return compareByPosition(a, b);
      }
    });
    shuttlesY.sort(function(a, b) {
      var impulseDiff;
      impulseDiff = abs(b.imY) - abs(a.imY);
      if (impulseDiff) {
        return impulseDiff;
      } else {
        return compareByPosition(a, b);
      }
    });
    log('***** phase 2) moving shuttles *****');
    log('Shuttles to move: ', shuttlesX.map(function(s) {
      return s.id;
    }), shuttlesY.map(function(s) {
      return s.id;
    }));
    numMoved = 0;
    ix = iy = 0;
    while (true) {
      if (ix === shuttlesX.length) {
        ref2 = shuttlesY.slice(iy);
        for (j = 0, len = ref2.length; j < len; j++) {
          s = ref2[j];
          numMoved += tryMove(s, true);
        }
        break;
      }
      if (iy === shuttlesY.length) {
        ref3 = shuttlesX.slice(ix);
        for (l = 0, len1 = ref3.length; l < len1; l++) {
          s = ref3[l];
          numMoved += tryMove(s, false);
        }
        break;
      }
      if (abs((sx = shuttlesX[ix]).imX) > abs((sy = shuttlesY[iy]).imY)) {
        ix++;
        numMoved += tryMove(sx, false);
      } else {
        iy++;
        numMoved += tryMove(sy, true);
      }
    }
    log('**** phase 3) cleanup ****');
    awakeShuttles.forEach(function(shuttle) {
      if (abs(shuttle.stepTag) === tag || shuttle.held) {
        Jit.stats.moves++;
        log('shuttle', shuttle.id, 'still awake - ', shuttle.stepTag);
        shuttle.zoneDeps.clear();
        shuttle.shuttleDeps.forEach(function(s2) {
          return s2.shuttleDeps["delete"](shuttle);
        });
        return shuttle.shuttleDeps.clear();
      } else {
        log('sleeping shuttle', shuttle.id, Array.from(shuttle.zoneDeps).map(function(z) {
          return z._id;
        }));
        return awakeShuttles.sleep(shuttle);
      }
    });
    zones.flushBuffer();
    log('moved', numMoved);
    shuttlesX.length = shuttlesY.length = 0;
    return !!numMoved;
    calcPressure();
    return update();
  };
};

module.exports = Jit = function(rawGrid) {
  var awakeShuttles, baseGrid, currentStates, engineBuffer, engineGrid, engines, fillKeys, groupConnections, groups, modules, regions, set, setGrid, shuttleBuffer, shuttleGrid, shuttleOverlap, shuttleStates, shuttles, stateForce, step, zones;
  baseGrid = BaseGrid();
  engineBuffer = BaseBuffer(baseGrid, ['positive', 'negative']);
  engines = BlobFiller('engine', engineBuffer);
  engineGrid = EngineGrid(baseGrid, engines);
  shuttleBuffer = ShuttleBuffer();
  shuttles = BlobFiller('shuttle', shuttleBuffer);
  shuttleStates = ShuttleStates(baseGrid, shuttles);
  shuttleGrid = ShuttleGrid(shuttleStates);
  CollapseDetector(baseGrid, shuttleBuffer, shuttles, shuttleStates, shuttleGrid);
  fillKeys = FillKeys(baseGrid, shuttleStates, shuttleGrid);
  groups = Groups(baseGrid, engines, engineGrid, shuttleGrid, fillKeys);
  stateForce = StateForce(baseGrid, shuttleStates, shuttleGrid, groups);
  currentStates = CurrentStates(shuttles, stateForce, shuttleStates);
  groupConnections = GroupConnections(groups);
  regions = Regions(fillKeys, groups, groupConnections);
  zones = Zones(shuttles, regions, currentStates);
  shuttleOverlap = ShuttleOverlap(shuttleStates, shuttleGrid, currentStates);
  awakeShuttles = AwakeShuttles(shuttles, shuttleStates, stateForce, currentStates, zones);
  modules = {
    baseGrid: baseGrid,
    engineBuffer: engineBuffer,
    engines: engines,
    engineGrid: engineGrid,
    shuttleBuffer: shuttleBuffer,
    shuttles: shuttles,
    shuttleStates: shuttleStates,
    shuttleGrid: shuttleGrid,
    fillKeys: fillKeys,
    groups: groups,
    stateForce: stateForce,
    groupConnections: groupConnections,
    regions: regions,
    currentStates: currentStates,
    zones: zones,
    awakeShuttles: awakeShuttles,
    shuttleOverlap: shuttleOverlap
  };
  step = Step(modules);
  set = function(x, y, bv, sv) {
    baseGrid.set(x, y, bv);
    return shuttleBuffer.set(x, y, sv);
  };
  setGrid = function(rawGrid) {
    return util.deserialize(rawGrid, false, set);
  };
  if (rawGrid) {
    setGrid(rawGrid);
  }
  return {
    baseGrid: baseGrid,
    modules: modules,
    getZoneContents: function(x, y, c) {
      var group, points, r0;
      group = modules.groups.get(x, y, c);
      if (!group) {
        return null;
      }
      points = new Set2;
      engines = new Set;
      r0 = modules.regions.get(group, modules.currentStates.map);
      if (r0) {
        util.fillGraph(r0, function(r, hmm) {
          r.groups.forEach(function(g) {
            return g.points.forEach(function(x, y, c, v) {
              return points.add(x, y);
            });
          });
          r.engines.forEach(function(e) {
            return engines.add(e);
          });
          return r.edges.forEach(function(group) {
            assert(group.used);
            if ((r = modules.regions.get(group, modules.currentStates.map))) {
              return hmm(r);
            }
          });
        });
      }
      return {
        points: points,
        engines: engines
      };
    },
    moveShuttle: function(shuttle, state) {
      var overlap;
      overlap = false;
      shuttleOverlap.forEach(state, function(state2, shuttle2) {
        if (shuttle2.currentState === state2) {
          return overlap = true;
        }
      });
      if (!overlap) {
        return currentStates.set(shuttle, state);
      }
    },
    step: function() {
      var result;
      result = step();
      return result;
    },
    check: function(invasive) {
      var k, m;
      for (k in modules) {
        m = modules[k];
        if (typeof m.check === "function") {
          m.check(invasive);
        }
      }
      return shuttles.forEach(function(shuttle) {
        return shuttle.eachCurrentPoint(function(x, y, v) {
          var baseV;
          baseV = baseGrid.get(x, y);
          return assert(baseV === 'nothing' || baseV === 'bridge' || baseV === 'ribbon' || baseV === 'ribbonbridge');
        });
      });
    },
    checkEmpty: function() {
      var k, m, results;
      results = [];
      for (k in modules) {
        m = modules[k];
        results.push(typeof m.checkEmpty === "function" ? m.checkEmpty() : void 0);
      }
      return results;
    },
    printGrid: function(stream) {
      var ids, overlay;
      if (stream == null) {
        stream = process.stdout;
      }
      overlay = new Map2;
      ids = new Map2;
      shuttles.forEach(function(s) {
        var dx, dy, state;
        state = s.currentState;
        if (!state) {
          return log('no state for', s);
        }
        dx = state.dx, dy = state.dy;
        return s.points.forEach(function(x, y, v) {
          overlay.set(x + dx, y + dy, v & SHUTTLE ? 'shuttle' : 'thinshuttle');
          return ids.set(x + dx, y + dy, s.id);
        });
      });
      return util.printCustomGrid(util.gridExtents(baseGrid), function(x, y) {
        return overlay.get(x, y) || baseGrid.get(x, y);
      }, ids.get.bind(ids), stream);
    },
    toJSON: function() {
      var json;
      json = {
        base: {},
        shuttles: {}
      };
      baseGrid.forEach(function(x, y, v) {
        assert(typeof v === 'string');
        if (v != null) {
          return json.base[x + "," + y] = v;
        }
      });
      shuttles.forEach(function(s) {
        var dx, dy, ref2, state;
        ref2 = state = s.currentState, dx = ref2.dx, dy = ref2.dy;
        return s.points.forEach(function(x, y, v) {
          return json.shuttles[(x + dx) + "," + (y + dy)] = v;
        });
      });
      return json;
    },
    set: set,
    get: function(layer, x, y) {
      switch (layer) {
        case 'shuttles':
          return shuttleBuffer.data.get(x, y) || shuttleGrid.getValue(x, y);
        case 'base':
          return baseGrid.get(x, y);
        default:
          throw Error("No such layer " + layer);
      }
    },
    stats: function() {
      var k, m;
      console.log(Jit.stats);
      for (k in modules) {
        m = modules[k];
        if (typeof m.stats === "function") {
          m.stats();
        }
      }
    },
    setQuiet: function(v) {
      if (v == null) {
        v = false;
      }
      return log.quiet = v;
    }
  };
};

Jit.stats = {
  moves: 0,
  checks: 0
};

parseFile = exports.parseFile = function(filename, opts) {
  var data, fs, j, j2, jit, json, moved, s;
  fs = require('fs');
  data = JSON.parse(fs.readFileSync(filename, 'utf8').split('\n')[0]);
  delete data.tw;
  delete data.th;
  jit = new Jit(data, opts);
  jit.modules.shuttles.forEach(function(s) {
    return console.log("Shuttle " + s.id + " has points", s.points);
  });
  jit.printGrid();
  for (s = j = 1; j <= 10; s = ++j) {
    moved = jit.step();
    console.log('Post step', s);
    jit.printGrid();
    console.log('# Awake shuttles:', Array.from(jit.modules.awakeShuttles.data).map(function(s) {
      return s.id;
    }));
    console.log();
    if (!moved) {
      log.quiet = true;
      json = jit.toJSON();
      j2 = new Jit(json);
      assert(!j2.step(), 'World erroneously stable');
      console.log('-> World stable.');
      break;
    }
  }
  return log('-----');
};

if (require.main === module) {
  filename = process.argv[2];
  if (!filename) {
    throw Error('Missing file argument');
  }
  log.quiet = process.argv[3] !== '-v';
  parseFile(filename);
  console.log(Jit.stats);
  console.log("(" + (Math.floor(100 * Jit.stats.moves / Jit.stats.checks)) + "% efficiency)");
}

}).call(this,require('_process'))
},{"./collections2":20,"./log":23,"./util":24,"./watch":25,"_process":7,"assert":1,"fs":5}],23:[function(require,module,exports){
(function (process){
// Generated by CoffeeScript 1.10.0
var log,
  slice = [].slice;

log = module.exports = process.env.NODE_ENV === 'production' ? function() {} : function() {
  var args, f, inspect;
  args = 1 <= arguments.length ? slice.call(arguments, 0) : [];
  if (log.quiet) {
    return;
  }
  if (typeof window === 'object') {
    return console.log.apply(console, args);
  } else {
    inspect = require('util').inspect;
    f = function(a) {
      if (typeof a === 'string') {
        return a;
      } else {
        return inspect(a, {
          depth: 5,
          colors: true
        });
      }
    };
    return console.log(args.map(f).join(' '));
  }
};

log.quiet = false;

}).call(this,require('_process'))
},{"_process":7,"util":9}],24:[function(require,module,exports){
(function (process){
// Generated by CoffeeScript 1.10.0
var DIRS, DN, DOWN, LEFT, Map2, Map3, NUMINS, RIGHT, SHUTTLE, Set2, Set3, ShuttleStateMap, THINSHUTTLE, UP, assert, cellAt, chalk, chars, connectedCells, deserialize, insLevelOf, insNum, jsonExtents, log, oppositeDir, parseXY, printCustomGrid, ref, shuttleStr;

ref = require('./collections2'), Map2 = ref.Map2, Set2 = ref.Set2, Map3 = ref.Map3, Set3 = ref.Set3;

log = require('./log');

assert = require('assert');

UP = 0;

RIGHT = 1;

DOWN = 2;

LEFT = 3;

DN = exports.DN = {
  0: 'UP',
  1: 'RIGHT',
  2: 'DOWN',
  3: 'LEFT'
};

DIRS = exports.DIRS = [
  {
    dx: 0,
    dy: -1
  }, {
    dx: 1,
    dy: 0
  }, {
    dx: 0,
    dy: 1
  }, {
    dx: -1,
    dy: 0
  }
];

NUMINS = exports.NUMINS = 16;

insNum = exports.insNum = (function() {
  var i, j, map;
  map = {};
  for (i = j = 1; j <= 16; i = ++j) {
    map["ins" + i] = i - 1;
  }
  return function(v) {
    var ref1;
    return (ref1 = map[v]) != null ? ref1 : -1;
  };
})();

SHUTTLE = 0x40;

THINSHUTTLE = 0x80;

shuttleStr = exports.shuttleStr = function(v) {
  if (typeof v === 'string') {
    return v;
  }
  if (v & SHUTTLE) {
    return 'shuttle';
  } else if (v & THINSHUTTLE) {
    return 'thinshuttle';
  } else {
    return null;
  }
};

parseXY = exports.parseXY = function(k) {
  var ref1, x, y;
  ref1 = k.split(','), x = ref1[0], y = ref1[1];
  return {
    x: x | 0,
    y: y | 0
  };
};

exports.fill = function(initialX, initialY, f) {
  var explore, hmm, visited, x, y;
  visited = new Set2([[initialX, initialY]]);
  explore = [initialX, initialY];
  hmm = function(x, y) {
    if (!visited.has(x, y)) {
      visited.add(x, y);
      explore.push(x);
      return explore.push(y);
    }
  };
  while (explore.length > 0) {
    x = explore.shift();
    y = explore.shift();
    if (f(x, y, hmm)) {
      hmm(x + 1, y);
      hmm(x - 1, y);
      hmm(x, y + 1);
      hmm(x, y - 1);
    }
  }
};

exports.fill3 = function(a0, b0, c0, f) {
  var a, b, c, explore, hmm, visited;
  visited = new Set3;
  visited.add(a0, b0, c0);
  explore = [a0, b0, c0];
  hmm = function(x, y, c) {
    if (!visited.has(x, y, c)) {
      visited.add(x, y, c);
      explore.push(x);
      explore.push(y);
      return explore.push(c);
    }
  };
  while (explore.length > 0) {
    a = explore.shift();
    b = explore.shift();
    c = explore.shift();
    f(a, b, c, hmm);
  }
};

oppositeDir = exports.oppositeDir = function(dir) {
  return (dir + 2) % 4;
};


/*

inum, inum2, result
0, 0, normal
0, x, normal

x, y, null
x, x, [x,y,0]
x, 0, [x,y,0]
 */

exports.cellMax = function(v) {
  switch (v) {
    case 'positive':
    case 'negative':
      return 4;
    case 'bridge':
      return 2;
    case 'ribbon':
      return NUMINS;
    case 'ribbonbridge':
      return NUMINS * 2;
    case null:
    case void 0:
      return 0;
    default:
      return 1;
  }
};

insLevelOf = function(v) {
  if (v === 'ribbon' || v === 'ribbonbridge') {
    return 0x2;
  } else if (insNum(v) !== -1) {
    return 0x3;
  } else {
    return 0x1;
  }
};

cellAt = function(grid, x, y, dir, insLevel, inum2) {
  var inum, v;
  v = grid.get(x, y);
  if (!(insLevel & insLevelOf(v))) {
    return null;
  }
  if ((inum = insNum(v)) !== -1) {
    if (inum2 === (-1) || inum2 === inum) {
      return [x, y, 0];
    } else {
      return null;
    }
  } else {
    switch (v) {
      case 'ribbon':
        assert(inum2 !== -1);
        return [x, y, inum2];
      case 'ribbonbridge':
        return [x, y, dir === UP || dir === DOWN ? inum2 : inum2 + NUMINS];
      case 'nothing':
      case 'thinsolid':
        return [x, y, 0];
      case 'bridge':
        return [x, y, dir === UP || dir === DOWN ? 0 : 1];
      case 'negative':
      case 'positive':
        return [x, y, dir];
      default:
        return null;
    }
  }
};

connectedCells = function(grid, x, y, c) {
  var cell, cells, dir, dirs, dx, dy, insLevel, inum, j, len, ref1, v;
  v = grid.get(x, y);
  inum = insNum(v);
  insLevel = 0x1;
  dirs = (function() {
    if (inum !== -1) {
      insLevel = 0x3;
      return [UP, RIGHT, DOWN, LEFT];
    } else {
      if (v === 'ribbon' || v === 'ribbonbridge') {
        inum = c % NUMINS;
        insLevel = 0x2;
      }
      switch (v) {
        case 'nothing':
        case 'thinsolid':
        case 'ribbon':
          return [UP, RIGHT, DOWN, LEFT];
        case 'bridge':
          if (c === 0) {
            return [UP, DOWN];
          } else {
            return [LEFT, RIGHT];
          }
          break;
        case 'ribbonbridge':
          if (c < NUMINS) {
            return [UP, DOWN];
          } else {
            return [LEFT, RIGHT];
          }
          break;
        case 'positive':
        case 'negative':
          return [c];
        default:
          return [];
      }
    }
  })();
  cells = [];
  for (j = 0, len = dirs.length; j < len; j++) {
    dir = dirs[j];
    ref1 = DIRS[dir], dx = ref1.dx, dy = ref1.dy;
    cell = cellAt(grid, x + dx, y + dy, oppositeDir(dir), insLevel, inum);
    if (cell) {
      cells.push(cell);
    }
  }
  return cells;
};

exports.connectedCells = function(grid, x, y, c) {
  var cells;
  cells = connectedCells(grid, x, y, c);
  return cells;
};

exports.uniqueShuttlesInStates = function(states) {
  var marked, shuttles;
  shuttles = [];
  marked = new WeakSet;
  states.forEach(function(arg) {
    var shuttle;
    shuttle = arg.shuttle;
    if (marked.has(shuttle)) {
      return;
    }
    marked.add(shuttle);
    return shuttles.push(shuttle);
  });
  shuttles.sort(function(a, b) {
    return a.id - b.id;
  });
  return shuttles;
};

exports.setToArray = function(set) {
  var arr;
  arr = [];
  set.forEach(function(x) {
    return arr.push(x);
  });
  return arr;
};

exports.ShuttleStateMap = ShuttleStateMap = (function() {
  var each;

  function ShuttleStateMap(shuttleSet) {
    this.shuttles = [];
    shuttleSet.forEach((function(_this) {
      return function(s) {
        assert(s.used);
        return _this.shuttles.push(s);
      };
    })(this));
    this.values = void 0;
  }

  each = function(list, depth, fn) {
    var item, j, len, results;
    if (depth === 0) {
      if (list != null) {
        fn(list);
      }
      return;
    }
    depth--;
    results = [];
    for (j = 0, len = list.length; j < len; j++) {
      item = list[j];
      if (item) {
        results.push(each(item, depth, fn));
      }
    }
    return results;
  };

  ShuttleStateMap.prototype.isDefinedFor = function(currentStates) {
    var j, len, ref1, s;
    ref1 = this.shuttles;
    for (j = 0, len = ref1.length; j < len; j++) {
      s = ref1[j];
      if (!currentStates.has(s)) {
        return false;
      }
    }
    return true;
  };

  ShuttleStateMap.prototype.get = function(currentStates) {
    var container, j, len, ref1, s, state;
    container = this.values;
    ref1 = this.shuttles;
    for (j = 0, len = ref1.length; j < len; j++) {
      s = ref1[j];
      if (!container) {
        return;
      }
      state = currentStates.get(s);
      assert(state);
      container = container[state.id];
    }
    return container;
  };

  ShuttleStateMap.prototype.set = function(currentStates, v) {
    var container, j, key, len, ref1, s, state;
    if (this.shuttles.length === 0) {
      return this.values = v;
    }
    key = 'values';
    container = this;
    ref1 = this.shuttles;
    for (j = 0, len = ref1.length; j < len; j++) {
      s = ref1[j];
      state = currentStates.get(s);
      if (!state) {
        throw Error('ShuttleStateMap.set on an unbound set');
      }
      if (!container[key]) {
        container = container[key] = [];
      } else {
        container = container[key];
      }
      key = state.id;
    }
    return container[key] = v;
  };

  ShuttleStateMap.prototype["delete"] = function(currentStates) {
    return this.set(currentStates, void 0);
  };

  ShuttleStateMap.prototype.forEachValue = function(fn) {
    return each(this.values, this.shuttles.length, fn);
  };

  return ShuttleStateMap;

})();

exports.fillGraph = function(initialNode, f) {
  var explore, hmm, node, visited;
  visited = new Set;
  explore = [];
  hmm = function(node) {
    if (!visited.has(node)) {
      visited.add(node);
      return explore.push(node);
    }
  };
  hmm(initialNode);
  while (explore.length > 0) {
    node = explore.shift();
    f(node, hmm);
  }
};

chalk = require('chalk');

(function() {
  var fn, j, len, ref1, results;
  if (!chalk.bgGreen) {
    chalk = function(x) {
      return x;
    };
    ref1 = ['bgGreen', 'bgRed', 'bgWhite', 'bgBlue', 'blue', 'yellow', 'grey', 'magenta'];
    results = [];
    for (j = 0, len = ref1.length; j < len; j++) {
      fn = ref1[j];
      results.push(chalk[fn] = chalk);
    }
    return results;
  }
})();

chars = {
  positive: function(id) {
    return chalk.bgGreen(id || '+');
  },
  negative: function(id) {
    return chalk.bgRed(id || '-');
  },
  nothing: function() {
    return chalk.bgWhite(' ');
  },
  thinsolid: function() {
    return chalk.bgWhite.grey('x');
  },
  shuttle: function(id) {
    return chalk.magenta(id || 'S');
  },
  thinshuttle: function(id) {
    return chalk.magenta.bgWhite(id || 's');
  },
  bridge: function() {
    return chalk.bgBlue('B');
  },
  thinbridge: function() {
    return chalk.blue('b');
  },
  ribbon: function() {
    return chalk.yellow('r');
  },
  ribbonbridge: function() {
    return chalk.yellow.bgBlue('r');
  }
};

exports.printCustomGrid = printCustomGrid = function(arg, getFn, getIdFn, stream) {
  var bottom, header, id, j, l, left, m, n, ref1, ref2, ref3, ref4, ref5, ref6, ref7, ref8, right, top, v, x, y;
  top = arg.top, left = arg.left, bottom = arg.bottom, right = arg.right;
  if (getIdFn == null) {
    getIdFn = (function() {});
  }
  if (stream == null) {
    stream = process.stdout;
  }
  top || (top = 0);
  left || (left = 0);
  header = chalk.bold;
  stream.write(header('+ '));
  for (x = j = ref1 = left, ref2 = right; ref1 <= ref2 ? j <= ref2 : j >= ref2; x = ref1 <= ref2 ? ++j : --j) {
    stream.write(header("" + (x % 10)));
  }
  stream.write('\n');
  for (y = l = ref3 = top, ref4 = bottom; ref3 <= ref4 ? l <= ref4 : l >= ref4; y = ref3 <= ref4 ? ++l : --l) {
    stream.write(header((y % 10) + " "));
    for (x = m = ref5 = left, ref6 = right; ref5 <= ref6 ? m <= ref6 : m >= ref6; x = ref5 <= ref6 ? ++m : --m) {
      v = getFn(x, y);
      if (typeof v === 'number') {
        v = shuttleStr(v);
      }
      id = getIdFn(x, y);
      if (typeof id === 'number') {
        id = id % 10;
      }
      stream.write((typeof chars[v] === "function" ? chars[v](id) : void 0) || (v != null ? ("" + v)[0] : ';'));
    }
    stream.write('\n');
  }
  stream.write(header('+ '));
  for (x = n = ref7 = left, ref8 = right; ref7 <= ref8 ? n <= ref8 : n >= ref8; x = ref7 <= ref8 ? ++n : --n) {
    stream.write(header("" + (x % 10)));
  }
  return stream.write('\n');
};

exports.gridExtents = function(grid) {
  var bottom, left, right, top;
  top = left = bottom = right = null;
  grid.forEach(function(x, y, v) {
    if (left === null || x < left) {
      left = x;
    }
    if (right === null || x > right) {
      right = x;
    }
    if (top === null || y < top) {
      top = y;
    }
    if (bottom === null || y > bottom) {
      return bottom = y;
    }
  });
  return {
    top: top,
    left: left,
    bottom: bottom,
    right: right
  };
};

jsonExtents = function(grid) {
  var bottom, left, right, scan, top;
  top = left = bottom = right = null;
  scan = function(g) {
    var k, ref1, results, v, x, y;
    results = [];
    for (k in g) {
      v = g[k];
      ref1 = parseXY(k), x = ref1.x, y = ref1.y;
      if (left === null || x < left) {
        left = x;
      }
      if (right === null || x > right) {
        right = x;
      }
      if (top === null || y < top) {
        top = y;
      }
      if (bottom === null || y > bottom) {
        results.push(bottom = y);
      } else {
        results.push(void 0);
      }
    }
    return results;
  };
  if (grid.base) {
    scan(grid.base);
  } else {
    scan(grid);
  }
  return {
    top: top,
    left: left,
    bottom: bottom,
    right: right
  };
};

exports.printJSONGrid = function(grid, stream) {
  var extents, fn;
  if (stream == null) {
    stream = process.stdout;
  }
  extents = jsonExtents(grid);
  fn = grid.base ? function(x, y) {
    return grid.shuttles[[x, y]] || grid.base[[x, y]];
  } : function(x, y) {
    return grid[[x, y]];
  };
  return printCustomGrid(extents, fn, (function() {}), stream);
};

exports.printGrid = function(extents, grid, stream) {
  if (stream == null) {
    stream = process.stdout;
  }
  return printCustomGrid(extents, (function(x, y) {
    return grid.get(x, y);
  }), (function() {}), stream);
};

exports.deserialize = deserialize = function(data, rebase, setCell) {
  var k, maxx, maxy, minx, miny, ref1, ref2, ref3, ref4, ref5, ref6, v, x, y;
  if (typeof data === 'string') {
    data = JSON.parse(data);
  }
  maxx = maxy = -Infinity;
  if (rebase) {
    if (data.tw != null) {
      minx = miny = 0;
      maxx = data.tw;
      maxy = data.th;
    } else {
      minx = miny = Infinity;
      ref2 = (ref1 = data.base) != null ? ref1 : data;
      for (k in ref2) {
        v = ref2[k];
        ref3 = parseXY(k), x = ref3.x, y = ref3.y;
        if (x < minx) {
          minx = x;
        }
        if (y < miny) {
          miny = y;
        }
        if (x > maxx) {
          maxx = x;
        }
        if (y > maxy) {
          maxy = y;
        }
      }
      minx--;
      miny--;
      maxx += 2;
      maxy += 2;
    }
  } else {
    minx = miny = 0;
  }
  if (data.base) {
    ref4 = data.base;
    for (k in ref4) {
      v = ref4[k];
      ref5 = parseXY(k), x = ref5.x, y = ref5.y;
      if (v === 'thinbridge') {
        v = 'bridge';
      }
      setCell(x - minx, y - miny, v, data.shuttles[k]);
    }
  } else {
    console.log('Loading from old style data');
    for (k in data) {
      v = data[k];
      if (!(k !== 'tw' && k !== 'th')) {
        continue;
      }
      ref6 = parseXY(k), x = ref6.x, y = ref6.y;
      x -= minx;
      y -= miny;
      if (v === 'shuttle' || v === 'thinshuttle') {
        setCell(x, y, 'nothing', v);
      } else {
        setCell(x, y, v, null);
      }
    }
  }
  if (rebase) {
    return {
      tw: maxx - minx,
      th: maxy - miny
    };
  }
};

exports.deserializeRegion = function(data) {
  var ref1, selection, th, tw;
  selection = {
    base: new Map2,
    shuttles: new Map2
  };
  ref1 = deserialize(data, true, (function(_this) {
    return function(x, y, bv, sv) {
      selection.base.set(x, y, bv);
      if (sv != null) {
        return selection.shuttles.set(x, y, sv);
      }
    };
  })(this)), tw = ref1.tw, th = ref1.th;
  selection.tw = tw;
  selection.th = th;
  return selection;
};

}).call(this,require('_process'))
},{"./collections2":20,"./log":23,"_process":7,"assert":1,"chalk":5}],25:[function(require,module,exports){
// Generated by CoffeeScript 1.10.0
var Watcher,
  slice = [].slice;

module.exports = Watcher = (function() {
  function Watcher(forEach) {
    var container;
    this.forEach = forEach;
    if (typeof this.forEach !== 'function') {
      container = this.forEach;
      this.forEach = function(fn) {
        return container.forEach(fn);
      };
    }
    this.observers = [];
  }

  Watcher.prototype.forward = function(fn) {
    this.forEach(fn);
    return this.observers.push(fn);
  };

  Watcher.prototype.on = function(fn) {
    return this.observers.push(fn);
  };

  Watcher.prototype.signal = function() {
    var args, i, len, o, ref;
    args = 1 <= arguments.length ? slice.call(arguments, 0) : [];
    ref = this.observers;
    for (i = 0, len = ref.length; i < len; i++) {
      o = ref[i];
      o.apply(null, args);
    }
  };

  return Watcher;

})();

},{}],26:[function(require,module,exports){
module.exports = function(strings) {
  if (typeof strings === 'string') strings = [strings]
  var exprs = [].slice.call(arguments,1)
  var parts = []
  for (var i = 0; i < strings.length-1; i++) {
    parts.push(strings[i], exprs[i] || '')
  }
  parts.push(strings[i])
  return parts.join('')
}

},{}],27:[function(require,module,exports){
// the whatwg-fetch polyfill installs the fetch() function
// on the global object (window or self)
//
// Return that as the export for use in Webpack, Browserify etc.
require('whatwg-fetch');
module.exports = self.fetch.bind(self);

},{"whatwg-fetch":30}],28:[function(require,module,exports){
module.exports = Map2;

// Create a new Map2. The constructor takes in an iterable of data values in
// the form of [[k1, k2, v], [k1, k2, v], ...].
function Map2(data) {
  this.map = new Map;
  this.size = 0;
  if (data) {
    for (var i = 0; i < data.length; i++) {
      var d = data[i];
      this.set(d[0], d[1], d[2]);
    }
  }
}

// Get k1, k2. Returns value or undefined.
Map2.prototype.get = function(k1, k2) {
  var inner;
  if ((inner = this.map.get(k1))) {
    return inner.get(k2);
  }
};

// Does the map have k1, k2. Returns true / false.
Map2.prototype.has = function(k1, k2) {
  var inner = this.map.get(k1);
  return inner ? inner.has(k2) : false;
};

// Set (k1, k2) -> v. Chainable - returns the set.
Map2.prototype.set = function(k1, k2, v) {
  var inner = this.map.get(k1);
  if (!inner) {
    inner = new Map;
    this.map.set(k1, inner);
  }
  this.size -= inner.size;
  inner.set(k2, v);
  this.size += inner.size;
  return this;
};

// Deletes the value for (k1, k2). Returns true if an element was removed,
// false otherwise.
Map2.prototype.delete = function(k1, k2) {
  var inner = this.map.get(k1);
  if (inner) {
    var deleted = inner.delete(k2);
    if (deleted) {
      this.size--;
    }
    return deleted;
  } else {
    return false;
  }
};

// Remove all items in the map.
Map2.prototype.clear = function() {
  this.map.clear();
  this.size = 0;
};


// Iterates through all values in the set via the passed function. Note the
// order of arguments - your function is called with (v, k1, k2). This is to
// match the semantics of Map.forEach which passes (v, k).
Map2.prototype.forEach = function(fn) {
  this.map.forEach(function(inner, k1) {
    inner.forEach(function(v, k2) {
      fn(v, k1, k2);
    });
  });
};

if (typeof Symbol !== 'undefined') {
  function iterWithNext(next) {
    var iter = {};
    iter.next = next;
    iter[Symbol.iterator] = function() { return iter; };
    return iter;
  }

  // Iterator to support for..of loops
  Map2.prototype[Symbol.iterator] = Map2.prototype.entries = function() {
    var outer = this.map.entries();

    var k1;
    var inner = null;

    return iterWithNext(function() {
      var innerV;
      while (inner == null || (innerV = inner.next()).done) {
        // Go to the next outer map.
        var outerV = outer.next();
        // We need to return {done:true} - but this has the object we want.
        if (outerV.done) return outerV;

        k1 = outerV.value[0];
        inner = outerV.value[1].entries();
      }

      // Ok, innerV should now contain [k2, v].
      var k2 = innerV.value[0];
      var v = innerV.value[1];

      return {value:[k1, k2, v], done: false};
    });
  };

  // Iterate through all keys pairwise
  Map2.prototype.keys = function() {
    var iter = this.entries();
    return iterWithNext(function() {
      var v = iter.next();
      if (v.done) {
        return v;
      } else {
        return {value:[v.value[0], v.value[1]], done:false};
      }
    });
  };

  // Iterate through all values
  Map2.prototype.values = function() {
    var iter = this.entries();
    return iterWithNext(function() {
      var v = iter.next();
      if (v.done) {
        return v;
      } else {
        return {value:v.value[2], done:false};
      }
    });
  };
}

// Helper for node / iojs so you can see the map in the repl.
Map2.prototype.inspect = function(depth, options) {
  // This is a dirty hack to confuse browserify so it won't pull in node's util
  // library just to give us inspect.
  var inspect = require('' + 'util').inspect;
  if (depth < 0) {
    return '[Map2]';
  }
  if (this.size === 0) {
    return '{[Map2]}';
  }
  var entries = [];
  this.forEach(function(k1, k2, v) {
    entries.push("(" + (inspect(k1, options)) + "," + (inspect(k2, options)) + ") : " + (inspect(v, options)));
  });
  //assert(entries.length === this.size);
  return "{[Map2] " + (entries.join(', ')) + " }";
};


},{}],29:[function(require,module,exports){
module.exports = Set2;

// Create a new Set2. The constructor takes optional data of the form [[a1,b1],
// [a2,b2], ...].
function Set2(data) {
  this.map = new Map;
  this.size = 0;
  if (data) {
    for (var i = 0; i < data.length; i++) {
      this.add(data[i][0], data[i][1]);
    }
  }
}

// Subset of the set. Returns a set with all entries with first value a.
Set2.prototype.subset = function(v1) {
  return this.map.get(v1);
};

// Does the set have (v1,v2)? Returns a bool.
Set2.prototype.has = function(v1, v2) {
  var inner = this.map.get(v1);
  return inner ? inner.has(v2) : false;
};

// Add (v1,v2) to the set. Chainable.
Set2.prototype.add = function(v1, v2) {
  var inner = this.map.get(v1);
  if (!inner) {
    inner = new Set;
    this.map.set(v1, inner);
  }
  this.size -= inner.size;
  inner.add(v2);
  this.size += inner.size;
  return this;
};

// Delete (v1,v2). Returns true if an item was removed.
Set2.prototype.delete = function(v1, v2) {
  var inner = this.map.get(v1);
  if (!inner) return false;

  var deleted = inner.delete(v2);
  if (!deleted) return false;

  this.size--;
  if (inner.size === 0) {
    this.map.delete(v1);
  }
  return true;
};

// Delete all entries with first value v1. Returns true if anything was
// removed. Otherwise returns false.
Set2.prototype.deleteAll = function(v1) {
  var set;
  if ((set = this.map.get(v1))) {
    this.size -= set.size;
    this.map.delete(v1);
    return true;
  }
  return false;
};

// Removes everything from the set.
Set2.prototype.clear = function() {
  this.map.clear();
  this.size = 0;
};


// ** Iteration

// Iterate through all items. fn(v1, v2).
Set2.prototype.forEach = function(fn) {
  this.map.forEach(function(inner, v1) {
    inner.forEach(function(v2) {
      fn(v1, v2);
    });
  });
};

// Iterator to support for..of loops. Its kind of weird that we register the
// same method under 3 different names, but both Map and Set have a .entries()
// method which lets you iterate over pairs of [k,v] or [v,v] in the case of
// set. 
//
// So I'll make the API more or less compatible - but in reality, you probably
// want .values() or to use for..of (which uses [Symbol.iterator]).
Set2.prototype[Symbol.iterator] = Set2.prototype.values = Set2.prototype.entries = function() {
  var outer = this.map.entries(); // Iterator over outer map

  var v1;
  var inner = null; // Iterator over inner set

  var iterator = {
    next: function() {
      var innerV;
      while (inner == null || (innerV = inner.next()).done) {
        // Go to the next outer map.
        var outerV = outer.next();
        // We need to return {done:true} - but this has the object we want.
        if (outerV.done) return outerV;

        v1 = outerV.value[0];
        inner = outerV.value[1].values();
      }

      // Ok, innerV should now contain [k2, v].
      var v2 = innerV.value;

      return {value:[v1, v2], done: false};

    }
  };

  iterator[Symbol.iterator] = function() { return iterator; };
  return iterator;
};


Set2.prototype.inspect = function(depth, options) {
  // This is a dirty hack to confuse browserify so it won't pull in node's util
  // library just to give us inspect.
  var inspect = require('' + 'util').inspect;

  if (depth < 0) {
    return '[Set2]';
  }
  var entries = [];
  this.forEach(function(v1, v2) {
    entries.push("(" + inspect(v1, options) + "," + inspect(v2, options) + ")");
  });
  assert.equal(entries.length, this.size);
  return "{[Set2] " + (entries.join(', ')) + " }";
};


},{}],30:[function(require,module,exports){
(function(self) {
  'use strict';

  if (self.fetch) {
    return
  }

  var support = {
    searchParams: 'URLSearchParams' in self,
    iterable: 'Symbol' in self && 'iterator' in Symbol,
    blob: 'FileReader' in self && 'Blob' in self && (function() {
      try {
        new Blob()
        return true
      } catch(e) {
        return false
      }
    })(),
    formData: 'FormData' in self,
    arrayBuffer: 'ArrayBuffer' in self
  }

  if (support.arrayBuffer) {
    var viewClasses = [
      '[object Int8Array]',
      '[object Uint8Array]',
      '[object Uint8ClampedArray]',
      '[object Int16Array]',
      '[object Uint16Array]',
      '[object Int32Array]',
      '[object Uint32Array]',
      '[object Float32Array]',
      '[object Float64Array]'
    ]

    var isDataView = function(obj) {
      return obj && DataView.prototype.isPrototypeOf(obj)
    }

    var isArrayBufferView = ArrayBuffer.isView || function(obj) {
      return obj && viewClasses.indexOf(Object.prototype.toString.call(obj)) > -1
    }
  }

  function normalizeName(name) {
    if (typeof name !== 'string') {
      name = String(name)
    }
    if (/[^a-z0-9\-#$%&'*+.\^_`|~]/i.test(name)) {
      throw new TypeError('Invalid character in header field name')
    }
    return name.toLowerCase()
  }

  function normalizeValue(value) {
    if (typeof value !== 'string') {
      value = String(value)
    }
    return value
  }

  // Build a destructive iterator for the value list
  function iteratorFor(items) {
    var iterator = {
      next: function() {
        var value = items.shift()
        return {done: value === undefined, value: value}
      }
    }

    if (support.iterable) {
      iterator[Symbol.iterator] = function() {
        return iterator
      }
    }

    return iterator
  }

  function Headers(headers) {
    this.map = {}

    if (headers instanceof Headers) {
      headers.forEach(function(value, name) {
        this.append(name, value)
      }, this)
    } else if (Array.isArray(headers)) {
      headers.forEach(function(header) {
        this.append(header[0], header[1])
      }, this)
    } else if (headers) {
      Object.getOwnPropertyNames(headers).forEach(function(name) {
        this.append(name, headers[name])
      }, this)
    }
  }

  Headers.prototype.append = function(name, value) {
    name = normalizeName(name)
    value = normalizeValue(value)
    var oldValue = this.map[name]
    this.map[name] = oldValue ? oldValue+','+value : value
  }

  Headers.prototype['delete'] = function(name) {
    delete this.map[normalizeName(name)]
  }

  Headers.prototype.get = function(name) {
    name = normalizeName(name)
    return this.has(name) ? this.map[name] : null
  }

  Headers.prototype.has = function(name) {
    return this.map.hasOwnProperty(normalizeName(name))
  }

  Headers.prototype.set = function(name, value) {
    this.map[normalizeName(name)] = normalizeValue(value)
  }

  Headers.prototype.forEach = function(callback, thisArg) {
    for (var name in this.map) {
      if (this.map.hasOwnProperty(name)) {
        callback.call(thisArg, this.map[name], name, this)
      }
    }
  }

  Headers.prototype.keys = function() {
    var items = []
    this.forEach(function(value, name) { items.push(name) })
    return iteratorFor(items)
  }

  Headers.prototype.values = function() {
    var items = []
    this.forEach(function(value) { items.push(value) })
    return iteratorFor(items)
  }

  Headers.prototype.entries = function() {
    var items = []
    this.forEach(function(value, name) { items.push([name, value]) })
    return iteratorFor(items)
  }

  if (support.iterable) {
    Headers.prototype[Symbol.iterator] = Headers.prototype.entries
  }

  function consumed(body) {
    if (body.bodyUsed) {
      return Promise.reject(new TypeError('Already read'))
    }
    body.bodyUsed = true
  }

  function fileReaderReady(reader) {
    return new Promise(function(resolve, reject) {
      reader.onload = function() {
        resolve(reader.result)
      }
      reader.onerror = function() {
        reject(reader.error)
      }
    })
  }

  function readBlobAsArrayBuffer(blob) {
    var reader = new FileReader()
    var promise = fileReaderReady(reader)
    reader.readAsArrayBuffer(blob)
    return promise
  }

  function readBlobAsText(blob) {
    var reader = new FileReader()
    var promise = fileReaderReady(reader)
    reader.readAsText(blob)
    return promise
  }

  function readArrayBufferAsText(buf) {
    var view = new Uint8Array(buf)
    var chars = new Array(view.length)

    for (var i = 0; i < view.length; i++) {
      chars[i] = String.fromCharCode(view[i])
    }
    return chars.join('')
  }

  function bufferClone(buf) {
    if (buf.slice) {
      return buf.slice(0)
    } else {
      var view = new Uint8Array(buf.byteLength)
      view.set(new Uint8Array(buf))
      return view.buffer
    }
  }

  function Body() {
    this.bodyUsed = false

    this._initBody = function(body) {
      this._bodyInit = body
      if (!body) {
        this._bodyText = ''
      } else if (typeof body === 'string') {
        this._bodyText = body
      } else if (support.blob && Blob.prototype.isPrototypeOf(body)) {
        this._bodyBlob = body
      } else if (support.formData && FormData.prototype.isPrototypeOf(body)) {
        this._bodyFormData = body
      } else if (support.searchParams && URLSearchParams.prototype.isPrototypeOf(body)) {
        this._bodyText = body.toString()
      } else if (support.arrayBuffer && support.blob && isDataView(body)) {
        this._bodyArrayBuffer = bufferClone(body.buffer)
        // IE 10-11 can't handle a DataView body.
        this._bodyInit = new Blob([this._bodyArrayBuffer])
      } else if (support.arrayBuffer && (ArrayBuffer.prototype.isPrototypeOf(body) || isArrayBufferView(body))) {
        this._bodyArrayBuffer = bufferClone(body)
      } else {
        throw new Error('unsupported BodyInit type')
      }

      if (!this.headers.get('content-type')) {
        if (typeof body === 'string') {
          this.headers.set('content-type', 'text/plain;charset=UTF-8')
        } else if (this._bodyBlob && this._bodyBlob.type) {
          this.headers.set('content-type', this._bodyBlob.type)
        } else if (support.searchParams && URLSearchParams.prototype.isPrototypeOf(body)) {
          this.headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8')
        }
      }
    }

    if (support.blob) {
      this.blob = function() {
        var rejected = consumed(this)
        if (rejected) {
          return rejected
        }

        if (this._bodyBlob) {
          return Promise.resolve(this._bodyBlob)
        } else if (this._bodyArrayBuffer) {
          return Promise.resolve(new Blob([this._bodyArrayBuffer]))
        } else if (this._bodyFormData) {
          throw new Error('could not read FormData body as blob')
        } else {
          return Promise.resolve(new Blob([this._bodyText]))
        }
      }

      this.arrayBuffer = function() {
        if (this._bodyArrayBuffer) {
          return consumed(this) || Promise.resolve(this._bodyArrayBuffer)
        } else {
          return this.blob().then(readBlobAsArrayBuffer)
        }
      }
    }

    this.text = function() {
      var rejected = consumed(this)
      if (rejected) {
        return rejected
      }

      if (this._bodyBlob) {
        return readBlobAsText(this._bodyBlob)
      } else if (this._bodyArrayBuffer) {
        return Promise.resolve(readArrayBufferAsText(this._bodyArrayBuffer))
      } else if (this._bodyFormData) {
        throw new Error('could not read FormData body as text')
      } else {
        return Promise.resolve(this._bodyText)
      }
    }

    if (support.formData) {
      this.formData = function() {
        return this.text().then(decode)
      }
    }

    this.json = function() {
      return this.text().then(JSON.parse)
    }

    return this
  }

  // HTTP methods whose capitalization should be normalized
  var methods = ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT']

  function normalizeMethod(method) {
    var upcased = method.toUpperCase()
    return (methods.indexOf(upcased) > -1) ? upcased : method
  }

  function Request(input, options) {
    options = options || {}
    var body = options.body

    if (input instanceof Request) {
      if (input.bodyUsed) {
        throw new TypeError('Already read')
      }
      this.url = input.url
      this.credentials = input.credentials
      if (!options.headers) {
        this.headers = new Headers(input.headers)
      }
      this.method = input.method
      this.mode = input.mode
      if (!body && input._bodyInit != null) {
        body = input._bodyInit
        input.bodyUsed = true
      }
    } else {
      this.url = String(input)
    }

    this.credentials = options.credentials || this.credentials || 'omit'
    if (options.headers || !this.headers) {
      this.headers = new Headers(options.headers)
    }
    this.method = normalizeMethod(options.method || this.method || 'GET')
    this.mode = options.mode || this.mode || null
    this.referrer = null

    if ((this.method === 'GET' || this.method === 'HEAD') && body) {
      throw new TypeError('Body not allowed for GET or HEAD requests')
    }
    this._initBody(body)
  }

  Request.prototype.clone = function() {
    return new Request(this, { body: this._bodyInit })
  }

  function decode(body) {
    var form = new FormData()
    body.trim().split('&').forEach(function(bytes) {
      if (bytes) {
        var split = bytes.split('=')
        var name = split.shift().replace(/\+/g, ' ')
        var value = split.join('=').replace(/\+/g, ' ')
        form.append(decodeURIComponent(name), decodeURIComponent(value))
      }
    })
    return form
  }

  function parseHeaders(rawHeaders) {
    var headers = new Headers()
    rawHeaders.split(/\r?\n/).forEach(function(line) {
      var parts = line.split(':')
      var key = parts.shift().trim()
      if (key) {
        var value = parts.join(':').trim()
        headers.append(key, value)
      }
    })
    return headers
  }

  Body.call(Request.prototype)

  function Response(bodyInit, options) {
    if (!options) {
      options = {}
    }

    this.type = 'default'
    this.status = 'status' in options ? options.status : 200
    this.ok = this.status >= 200 && this.status < 300
    this.statusText = 'statusText' in options ? options.statusText : 'OK'
    this.headers = new Headers(options.headers)
    this.url = options.url || ''
    this._initBody(bodyInit)
  }

  Body.call(Response.prototype)

  Response.prototype.clone = function() {
    return new Response(this._bodyInit, {
      status: this.status,
      statusText: this.statusText,
      headers: new Headers(this.headers),
      url: this.url
    })
  }

  Response.error = function() {
    var response = new Response(null, {status: 0, statusText: ''})
    response.type = 'error'
    return response
  }

  var redirectStatuses = [301, 302, 303, 307, 308]

  Response.redirect = function(url, status) {
    if (redirectStatuses.indexOf(status) === -1) {
      throw new RangeError('Invalid status code')
    }

    return new Response(null, {status: status, headers: {location: url}})
  }

  self.Headers = Headers
  self.Request = Request
  self.Response = Response

  self.fetch = function(input, init) {
    return new Promise(function(resolve, reject) {
      var request = new Request(input, init)
      var xhr = new XMLHttpRequest()

      xhr.onload = function() {
        var options = {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: parseHeaders(xhr.getAllResponseHeaders() || '')
        }
        options.url = 'responseURL' in xhr ? xhr.responseURL : options.headers.get('X-Request-URL')
        var body = 'response' in xhr ? xhr.response : xhr.responseText
        resolve(new Response(body, options))
      }

      xhr.onerror = function() {
        reject(new TypeError('Network request failed'))
      }

      xhr.ontimeout = function() {
        reject(new TypeError('Network request failed'))
      }

      xhr.open(request.method, request.url, true)

      if (request.credentials === 'include') {
        xhr.withCredentials = true
      }

      if ('responseType' in xhr && support.blob) {
        xhr.responseType = 'blob'
      }

      request.headers.forEach(function(value, name) {
        xhr.setRequestHeader(name, value)
      })

      xhr.send(typeof request._bodyInit === 'undefined' ? null : request._bodyInit)
    })
  }
  self.fetch.polyfill = true
})(typeof self !== 'undefined' ? self : this);

},{}]},{},[12]);
