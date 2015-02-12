var debug = require('debug')('vox:level-index');
var P = require('bluebird');
var util = require('util');


// TODO Implement update/delete.


/**
 * This class implements indexed properties for JSON objects in LevelDB.
 *
 * An index row key looks something like this:
 *
 * <separator-A>\x00<value-A>\x00<separator-B>\x00<value-B>pk\x00<primary-key>
 *
 * E.g.:
 *
 *   author\x00spacemaus\x00stream\x00private\x00pk\x00http://somekey
 *
 * @param {function(Object): String} getPrimaryKey Takes an object and returns
 *     the object's primary key.
 * @param {[['field-name', 'db-separator', function(v): String], ...]} arguments
 *     Index specs.  Each spec is an array of two or three items.  The first is
 *     the name of the object's field to index.  The second is the name to use
 *     when encoding it in the database index.  The optional third argument is
 *     an encoder for the value to index.  Use `LevelIndex.toAsc` or
 *     `LevelIndex.toDesc` to encode Numbers in ascending or descending order,
 *     respectively.
 */
function LevelIndex(getPrimaryKey, var_args) {
  // TODO Validate indexSpecs.
  this._getPrimaryKey = getPrimaryKey;
  this._indexSpecs = Array.prototype.slice.call(arguments, 1);
}
module.exports = LevelIndex;


/**
 * Puts an entry into the database.
 */
LevelIndex.prototype.put = function(batch, obj) {
  var pk = this._getPrimaryKey(obj);
  debug('Putting %s', pk);
  batch.put(pk, obj);
  var parts = [];
  for (var i = 0; i < this._indexSpecs.length; i++) {
    var spec = this._indexSpecs[i];
    if (encodePartialIndex(spec, obj, parts) == spec.length) {
      parts.push('pk');
      parts.push(pk);
      debug('Index %s', parts);
      batch.put(parts.join('\x00'), '');
    }
    parts.splice(0);
  }
}


/**
 * Scans for entries by index.
 *
 * @param {LevelDb} leveldb The database to scan.
 * @param {Object} options The index values to scan.
 * @param {String|Number} [options.<field-name>] Match this field.
 * @param {String|Number} [options.<field-name>Start] Match entries with values
 *     greater than or equal to this field value.
 * @param {String|Number} [options.<field-name>Limit] Match entries with values
 *     less than this field value.
 * @param {Number} [options.limit] Return at most this many entries.
 * @param {bool} [options.reverse] Scan in reverse.
*/
LevelIndex.prototype.scan = function(leveldb, options) {
  var spec = findMatchingIndex(this._indexSpecs, options);
  if (!spec) {
    throw new Error('No matching index!')
  }
  var parts = [];
  var scanOptions = {
      limit: options.limit,
      reverse: options.reverse
  };
  var nextField = encodePartialIndex(spec, options, parts);
  var prefix = parts.join('\x00') + '\x00';
  var field = spec[nextField];
  scanOptions.gte = prefix + encodeStartField(field, options);
  scanOptions.lt = prefix + encodeLimitField(field, options);
  debug('Scanning index %s to %s', scanOptions.gte, scanOptions.lt);
  return scanIndex(leveldb, scanOptions);
}


function encodePartialIndex(spec, obj, parts) {
  var j;
  for (j = 0; j < spec.length; j++) {
    var field = spec[j];
    var val = obj[field[0]];
    if (val === undefined) {
      break;
    }
    if (field.length == 3) {
      val = field[2](val);
    }
    parts.push(field[1], val);
  }
  return j;
}


function encodeStartField(field, options) {
  if (!field) {
    return 'pk\x00';
  }
  return encodeRangeField('', 'Start', field, options);
}


function encodeLimitField(field, options) {
  if (!field) {
    return 'pk\xff';
  }
  return encodeRangeField('\xff', 'Limit', field, options);
}


function encodeRangeField(emptyTerminator, fieldNameSuffix, field, options) {
  if (!field) {
    return emptyTerminator;
  }
  var val = options[field[0] + fieldNameSuffix];
  if (val === undefined) {
    return field[1] + '\x00' + emptyTerminator;
  }
  if (field.length == 3) {
    val = field[2](val);
  }
  return field[1] + '\x00' + val + '\x00';
}


function findMatchingIndex(indexSpecs, options) {
  var longestMatch = 0;
  var match;
  for (var i = 0; i < indexSpecs.length; i++) {
    var spec = indexSpecs[i];
    var matchLength = indexMatchLength(spec, options);
    if (matchLength > longestMatch) {
      longestMatch = matchLength;
      match = spec;
    }
  }
  if (!match) {
    throw new Error(util.format('No index matches query! %j', options));
  }
  return match;
}


function indexMatchLength(spec, options) {
  for (var j = 0; j < spec.length; j++) {
    var field = spec[j];
    if (options[field[0]] === undefined) {
      return j;
    }
  }
  return spec.length;
}


/**
 * Starts a LevelDB scan and returns a Promise for the list of results.
 *
 * @param {LevelDB} leveldb The DB to scan.
 * @param {Object} options An options object passed verbatim to
 *     leveldb.createReadStream().
 * @return {Promise<Object[]>} The scan results.
 */
function scan(leveldb, options) {
  return new P(function(resolve, reject) {
    var datas = [];
    var resolved = false;
    function fin() {
      if (resolved) {
        return;
      }
      resolve(P.all(datas));
      resolved = true;
    }
    leveldb.createReadStream(options)
      .on('data', function(data) {
        datas.push(data);
      })
      .on('close', fin)
      .on('end', fin)
      .on('error', function(err) {
        reject(err);
      })
  });
}


/**
 * Starts a LevelDB index scan and returns a Promise for the list of results.
 *
 * @param {LevelDB} leveldb The DB to scan.
 * @param {Object} options An options object passed verbatim to
 *     leveldb.createKeyStream().
 * @return {Promise<Object[]>} The scan results.
 */
function scanIndex(leveldb, options) {
  return new P(function(resolve, reject) {
    var datas = [];
    var resolved = false;
    function fin() {
      if (resolved) {
        return;
      }
      resolve(P.all(datas));
      resolved = true;
    }
    leveldb.createKeyStream(options)
      .on('data', function(key) {
        var i = key.lastIndexOf('\x00');
        var key = key.substr(i + 1);
        datas.push(leveldb.getAsync(key));
      })
      .on('close', fin)
      .on('end', fin)
      .on('error', function(err) {
        reject(err);
      })
  });
}


/**
 * For leveldb keys, translates a Number into a string that can be
 * lexicographically ordered from lowest to highest (positive numbers only).
 */
LevelIndex.toAsc = function(n) {
  _toHexBuffer.writeDoubleBE(n, 0)
  return _toHexBuffer.toString('hex');
}
var _toHexBuffer = new Buffer(8); // Good thing we're single-threaded.


/**
 * For leveldb keys, translates a Number into a string that can be
 * lexicographically ordered from highest to lowest (positive numbers only).
 */
LevelIndex.toDesc = function(n) {
  var b = _toHexBuffer;
  b.writeDoubleBE(n, 0);
  b[0] = 255 - b[0];
  b[1] = 255 - b[1];
  b[2] = 255 - b[2];
  b[3] = 255 - b[3];
  b[4] = 255 - b[4];
  b[5] = 255 - b[5];
  b[6] = 255 - b[6];
  b[7] = 255 - b[7];
  return b.toString('hex');
}
