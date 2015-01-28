/**
 * Command line arguments and their defaults.
 */

var commandLineArgs = require('minimist')(process.argv.slice(2));
var url = require('url')

module.exports = exports = commandLineArgs;

exports.port = commandLineArgs.port || 9001;
exports.metricsPort = commandLineArgs.metricsPort || exports.port + 1;

if (process.env == 'production') {
  exports.hubUrl = url.parse(commandLineArgs.hubUrl || 'http://hub.postvox.net');
  exports.dbDir = commandLineArgs.dbDir;
} else {
  exports.hubUrl = url.parse(commandLineArgs.hubUrl || 'http://localhost:9090');
  exports.dbDir = commandLineArgs.dbDir || '/tmp/interchange_db';
}
