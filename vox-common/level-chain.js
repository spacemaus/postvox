var Chain = require('./chain');
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
  this._chain = new Chain(this._loadCounter.bind(this));
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

  return this._chain.next(key, function(oldSeq) {
    return new P(function(resolve, reject) {
      var seq = oldSeq + 1;
      var batch = self.leveldb.batch();
      batch.put(self.counterKeyPrefix + key, seq);
      batchFn(batch, seq);
      batch.write(function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(seq);
        }
      });
    });
  })
}


/**
 * Loads the counter from the database.
 */
LevelChain.prototype._loadCounter = function(key) {
  var self = this;
  return self.leveldb.getAsync(self.counterKeyPrefix + key)
    .catch(function(err) {
      if (err.notFound) {
        return 0;
      } else {
        throw err;
      }
    })
}
