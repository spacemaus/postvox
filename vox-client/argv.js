/**
 * Command line arguments and their defaults.
 */

var commandLineArgs = require('minimist')(process.argv.slice(2));
var path = require('path');
var urlparse = require('url')

module.exports = exports = commandLineArgs;

/**
 * The Hub is like the root DNS server for Postvox nicknames.  Setting --hubUrl
 * lets you point to a different Hub authority.
 */
exports.hubUrl = urlparse.parse(commandLineArgs.hubUrl || 'http://localhost:9090');

var homeDir = process.env.HOME || process.env.HOMEPATH || process.env.HOMEDIR || process.cwd();

/**
 * The config file stores the user's identity and private encryption keys.
 */
exports.configFile = commandLineArgs.configFile || path.join(homeDir, '.voxconfig.json');

/**
 * The database file stores the user's subscriptions, received messages, etc.
 */
exports.dbDir = commandLineArgs.dbDir || path.join(homeDir, '.voxhistory');

if (process.env.NODE_ENV == 'development') {
  /**
   * The Hub is like the root DNS server for Postvox nicknames.  Setting --hubUrl
   * lets you point to a different Hub authority.
   */
  exports.hubUrl = urlparse.parse(commandLineArgs.hubUrl || 'http://localhost:9090');

  /**
   * The default interchange URL is used during the `init` command.
   */
  exports.defaultInterchangeUrl = commandLineArgs.defaultInterchangeUrl || 'http://localhost:9454'

} else {
  exports.hubUrl = urlparse.parse(commandLineArgs.hubUrl || 'http://hub.postvox.net');
  exports.defaultInterchangeUrl = commandLineArgs.defaultInterchangeUrl || 'http://vanilla.postvox.net';
}
