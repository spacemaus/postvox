var lruCache = require('lru-cache');
var timers = require('timers');


/**
 * A mild wrapper around lru-cache.
 */
var TargetCache = module.exports = function(maxSize) {
  /**
   * Maps from key to TargetCacheEntry.
   */
  this.cache = lruCache({
      max: maxSize,
      length: function(entry) { return entry.ids.length  || 1 }
  });
}


TargetCache.prototype.get = function(key) {
  return this.cache.get(key);
}


TargetCache.prototype.set = function(key, ids, dbSeq) {
  var entry = new TargetCacheEntry(ids, dbSeq);
  this.cache.set(key, entry);
  return entry;
}


TargetCache.prototype.peek = function(key) {
  return this.cache.peek(key);
}


function TargetCacheEntry(ids, dbSeq) {
  this.ids = ids;
  this.dbSeq = dbSeq;
  this.promise = null;
  this.lastRefreshTime = 0;
  // TODO this.promiseStartTime = 0;
}


TargetCacheEntry.prototype.cooperativeForEach = function(callback) {
  module.exports.cooperativeForEach(this.ids, callback);
}


/**
 * Like list.forEach(), but yields the main thread every 16 items.
 */
var cooperativeForEach = module.exports.cooperativeForEach = function(list, callback, start) {
  for (var i = 0, j = start || 0; i < 16 && j < list.length; i++, j++) {
    callback(list[j]);
  }
  if (j >= list.length) {
    return;
  }
  // Unblock the main thread every 16 callbacks.  Hooray for cooperative
  // multitasking!
  timers.setImmediate(cooperativeForEach, list, callback, j);
}
