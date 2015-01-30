var debug = require('debug')('vox:level-chain');
var P = require('bluebird');


/**
 * Serializes LevelDB operations by key.  This class guarantees that for any
 * given key, all operations on that key will be committed before the next
 * operation is started.
 *
 * Additionally, it provides an autoincrementing counter per key.  The counter
 * is stored in the database.
 *
 * IMPORTANT: There should only be one LevelChain instance in a process, per
 * active LevelDB connection.
 *
 * @params {LevelDB} leveldb The LevelDB object.
 * @params {Object} options
 * @params {String} [options.counterKeyPrefix] The LevelDB key prefix for the
 *     counter.  Each counter will be stored at "<counterKeyPrefix>\x00<key>".
 *     Defaults to "~seq".
 */
var LevelChain = module.exports = function(leveldb, options) {
  this.leveldb = leveldb;
  this.counterKeyPrefix = (options && options.counterKeyPrefix) ?
      options.counterKeyPrefix : '~seq';
  this.counterKeyPrefix += '\x00';
  this.counters = {};  // In-memory counters.
  this.operations = {};  // Pending operations.
}


/**
 * Creates and commits a batch operation.  Calls to this method with the same
 * `key` will be executed in serial.
 *
 * @params {String} key The key to serialize the operation on.
 * @params {function(batch, seq)} batchFn A function that will be called with a
 *     LevelDB batch and the sequence counter.  The sequence counter increments
 *     with each successful commit to the database.  It starts from 1.  If the
 *     operation fails, the sequence number may be re-used for the next
 *     operation.
 */
LevelChain.prototype.batch = function(key, batchFn) {
  var self = this;

  // Returns a function that returns a promise that calls `batchFn()`.
  function runOp() {
    return new P(function(resolve, reject) {
      var seq = ++self.counters[key];
      var batch = self.leveldb.batch();
      batch.put(self.counterKeyPrefix + key, seq);
      batchFn(batch, seq);
      batch.write(function(err) {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  // See if we have any pending operations on the key.
  var op = self.operations[key];
  if (!op) {
    // If we do, then the counter has already been loaded.  If not, then the
    // first thing we need to do is ensure that the counter has been loaded.
    op = self._loadCounter(key);
  }

  // We return the clientOp so that callers can chain off of just the promise
  // they care about.  But we store the chainedOp so that operations happen in
  // the correct order.
  var clientOp;

  // If an operation is pending (either a _loadCounter() or a caller's op), then
  // we need to chain the new operation behind the current one.
  if (op && op.isPending()) {
    clientOp = op.then(runOp);
  } else {
    // No pending operation means that we don't have to wait.
    clientOp = runOp();
  }

  var chainedOp = clientOp
    .catch(function(err) {
      debug('Error in chained op', err);
      // The operation failed, so roll back the counter.
      self.counters[key]--;
    })
    .finally(function() {
      // If no operation has chained off of this one, then we may delete it
      // from the set of pending ops.
      if (chainedOp == self.operations[key]) {
        delete self.operations[key];
      }
    });
  self.operations[key] = chainedOp;
  return clientOp;
}


/**
 * Loads the counter from the database.  If the counter is already in memory,
 * then returns null.  Otherwise, returns a Promise that will be fulfilled when
 * the counter is in memory.
 */
LevelChain.prototype._loadCounter = function(key) {
  var self = this;
  var seq = self.counters[key];
  if (seq !== undefined) {
    return null;
  }
  return self.leveldb.getAsync(self.counterKeyPrefix + key)
    .then(function(v) {
      self.counters[key] = v;
    })
    .catch(function(err) {
      if (err.notFound) {
        self.counters[key] = 0;
      } else {
        throw err;
      }
    })
}
