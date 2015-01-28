/**
 * Tracks approximate, decaying counters for each key.  Records up to `maxSize`
 * unique entries.  After that, it starts forgetting low-count entries in an
 * efficient-ish way.
 *
 * Counters may decay more rapidly than the given decayRate if `inc()` is called
 * with many unique keys relative to `maxSize`.  In that case, the additional
 * decay rate will be about (N / maxSize) units per second, where N is the
 * number of calls to `inc(uniqueKey)` per second.
 *
 * @param {Number} maxSize The maximum number of unique entries to store.
 * @param {Number} decayRate The rate at which counters decay, in units/second.
 */
var ForgetfulCounter = module.exports = function(maxSize, decayRate) {
  this.maxSize = maxSize;
  this.decayRate = decayRate;
  this.entries = [];
  this.keys = {};
  this.index = 0;
}


ForgetfulCounter.prototype.clear = function() {
  this.entries = [];
  this.keys = {};
  this.index = 0;
}


/**
 * Increments the count for `key` and returns the value.
 *
 * @params {String} key The key to increment.
 * @return {Number} The current count.
 */
ForgetfulCounter.prototype.inc = function(key) {
  var now = new Date().getTime() / 1e3;
  var decayRate = this.decayRate;

  var entry = this.keys[key];
  if (entry !== undefined) {
    // If the key is in the map, then update the existing count for the item.
    var count = entry.count;
    count += -decayRate * (now - entry.time) + 1;
    entry.count = Math.max(1, count);
    entry.time = now;
    return entry.count;

  } else {
    // If the key is not in the map, then we see if we can boot out the next
    // entry.  We decay its counter, then check if it's near zero.  If it is,
    // then we can boot it out.  If not, we store the decayed, decremented
    // value.

    var i = this.index;
    this.index = (i + 1) % this.maxSize;

    var entry = this.entries[i];
    if (!entry) {
      // It's an empty spot, so take it:
      var entry = new Entry(key, 1, now);
      this.entries[i] = entry;
      this.keys[key] = entry;
      return 1;
    }

    var count = entry.count;
    count += -decayRate * (now - entry.time) - 1;
    if (count < 1) {
      // It's old.  Boot it out and replace it with the new key.
      delete this.keys[entry.key];
      entry.key = key;
      entry.count = 1;
      entry.time = now;
      this.keys[key] = entry;
    } else {
      // It's not old enough.  Just decay and decrement its count by 1.
      entry.count = count;
      entry.time = now;
    }

    // "Eh, it's probably about one."
    return 1;
  }
}


function Entry(key, count, time) {
  this.key = key;
  this.count = count;
  this.time = time;
}

