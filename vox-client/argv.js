/**
 * Command line arguments and their defaults.
 */

var commandLineArgs = require('minimist')(process.argv.slice(2));
var path = require('path');
var urlparse = require('url')

module.exports = exports = commandLineArgs;

exports.nick = commandLineArgs.nick;

var homeDir = exports.homeDir = process.env.HOME || process.env.HOMEPATH || process.env.HOMEDIR || process.cwd();

/**
 * The Hub is like the root DNS server for Postvox nicknames.  Setting --hubUrl
 * lets you point to a different Hub authority.
 */
exports.hubUrl;

/**
 * The default interchange URL is used during the `init` command.
 */
exports.defaultInterchangeUrl;

/**
 * The directory where profiles are stored.
 */
exports.profilesDir;


if (process.env.NODE_ENV == 'development') {
  exports.hubUrl = urlparse.parse(commandLineArgs.hubUrl || 'http://localhost:9090');
  exports.defaultInterchangeUrl = commandLineArgs.defaultInterchangeUrl || 'http://localhost:9454'
  exports.profilesDir = commandLineArgs.profilesDir || path.join(homeDir, '.voxprofiles-dev');
} else {
  exports.hubUrl = urlparse.parse(commandLineArgs.hubUrl || 'http://hub.postvox.net');
  exports.defaultInterchangeUrl = commandLineArgs.defaultInterchangeUrl || 'http://vanilla.postvox.net';
  exports.profilesDir = commandLineArgs.profilesDir || path.join(homeDir, '.voxprofiles');
}

exports.stderrLogsPath = path.join(exports.profilesDir, 'vox.stderr');

exports.noTTY = commandLineArgs.noTTY;
