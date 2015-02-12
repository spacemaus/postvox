var P = require('bluebird');

/**
 * A Chain is a hashtable that forces operations to execute serially for each
 * key:value pair.
 *
 * @param {function(key)} init The initializer to call when a key's value is
 *     undefined.  It may return a value for the key or a Promise for the value.
 */
function Chain(init) {
  this._values = {};
  this._operations = {};
  this._init = init ? P.method(init) : null;
}


/**
 * Runs (or queues) the next operation on key.  Operations are run in the order
 * that they are queued.  Operations wait for the previous operation to complete
 * before executing.
 *
 * If an operation fails, then the value remains unchanged and the next
 * operation in the queue is run.
 *
 * @param {String} key The key associated with a value and a chain of operations
 *     on that value.
 * @param {function(value)} The operation to run.  It will be called after any
 *     previous operations on the key have been run.  It can return a value or a
 *     Promise for a value.  The return value will replace the existing value
 *     associated with the given key.  The operation immediately following this
 *     operation will see its returned value.
 * @return A Promise for the result of calling `operation()`.
 */
Chain.prototype.next = function(key, operation) {
  var val = this._values[key];
  if (val === undefined && this._init) {
    val = this._init(key)
      .catch(function(err) {
        console.error('Unhandled error in Chain init', err, err.stack);
        throw err;
      });
  }

  if (isPromise(val) && val.isFulfilled()) {
    // The value is no longer pending, so unchain the value.

    // TODO Might not be necessary if the Promise library is good about
    // recovering memory from completed promise chains.
    val = val.value();
  }

  var newVal = P.resolve(val).then(function(valResult) {
    return P.resolve(operation(valResult))
      .catch(function(err) {
        // If the operation errors out, pass over it.
        console.error('Unhandled error in Chain', err, err.stack);
        return valResult;
      });
  })

  // Replace the current value with our new Promise so that subsequent
  // operations will wait for this one to complete.
  this._values[key] = newVal;
  return newVal;
}


/**
 * Gets the value for a key.  If the key has not been initialized yet, the
 * initializer will be called and its value returned.
 */
Chain.prototype.get = function(key) {
  var val = this._values[key];
  if (val === undefined && this._init) {
    val = this._init(key)
      .catch(function(err) {
        console.error('Unhandled error in Chain init', err, err.stack);
        throw err;
      })
    this._values[key] = val;
  }
  return val;
}


Chain.prototype.peek = function(key) {
  var val = this._values[key];
  if (!isPromise(val)) {
    return val;
  }
  if (val.isFulfilled()) {
    return val.value();
  }
  return undefined;
}


// instanceof doesn't seem to work across modules.
function isPromise(v) {
  return v && v.isFulfilled && v.then && v.catch && v.value;
}

module.exports = Chain;
