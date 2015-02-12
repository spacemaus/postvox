var fs = require('fs');
var jsonFormat = require('json-format');


/**
 * Parses a config file from a file.
 */
exports.parse = function(filename) {
  try {
    var s = fs.readFileSync(filename, 'utf8');
    if (!s) {
      return {};
    }
    return JSON.parse(s);
  } catch (e) {
    if (e.code != 'ENOENT') {
      throw e;
    }
    return {};
  }
}


/**
 * Writes a config file to a file.
 */
exports.write = function(filename, config) {
  var s = jsonFormat(config);
  fs.writeFileSync(filename, s, {
      mode: 0600,
      flag: 'w'
  });
}
