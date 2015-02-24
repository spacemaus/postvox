#!/usr/bin/env node

/**
 * This is the main script for a Postvox command-line client.  It illustrates
 * how a single-user client may be implemented.
 *
 * Run it like so:
 *
 *     $ node ./vox.js
 *
 * The first time it is run, it will prompt you to create an account on the Hub.
 * It will create a private encryption key for you, and store it in your config
 * file.
 *
 * By default, it stores its config and database files in "$HOME/.voxprofiles".
 * If you'd like to customize that path:
 *
 *     $ node ./vox.js --profilesDir path/to/dir
 *
 * If you'd like to see what the client is sending and receiving, set the DEBUG
 * environment variable:
 *
 *     $ DEBUG='vox:connection-manager' node ./vox.js
 */

var argv = require('./argv');
var authentication = require('vox-common/authentication');
var clientdb = require('./clientdb');
var colors = require('colors');
var configs = require('./configs');
var debug = require('debug')('vox:vox');
var errors = require('vox-common/errors');
var fancyview = require('./fancyview');
var hubClient = require('vox-common/hubclient');
var mkdirp = require('mkdirp');
var P = require('bluebird');
var path = require('path');
var termview = require('./termview');
var urlparse = require('url');
var ursa = require('ursa');
var util = require('util');
var voxcommon = require('vox-common');
var VoxClient = require('./vox-client');


var AGENT_STRING = 'Vox.js 0.0.8';


function Main() {
  if (!argv.nick) {
    console.error('Please specify --nick (6 to 64 characters, letters and numbers only)');
    process.exit(1);
  }

  process.on('unhandledRejection', function(err, promise) {
    console.error('Unhandled promise rejection', err, err.stack);
    process.exit(1);
  });

  var profileFilenames = VoxClient.prepareProfile(argv.profilesDir, argv.nick);
  var config = configs.parse(profileFilenames.configFile);
  if (!config.nick) {
    config.nick = argv.nick;
  }

  // The command that the user entered on the command line:
  var cmdName = argv._[0] || 'interactive';
  if (argv.help || argv.h) {
    cmdName = 'help';
  }

  var handler = COMMANDS[cmdName];
  if (!handler) {
    console.error('Unknown command: %s', cmdName);
    process.exit(1);
  }

  var view;
  if (cmdName == 'interactive' && config.isRegistered) {
    if (!(process.stdout.isTTY && process.stdin.isTTY && !argv.noTTY)) {
      console.error('Erm, sorry, interactive mode does not work without a TTY.');
      process.exit(1);
    }
    view = fancyview.FancyView();
    view.attach();
  } else if (cmdName != 'stream') {
    view = termview.TermView();
  }

  var context = RootContext(argv, profileFilenames, view);

  // Open our local database and initialize our client stubs.
  return context.initWithConfig(config)
    .then(function() {
      var args = argv._.slice(1);

      // Now, run the user's command.
      if (cmdName == 'interactive' && !config.isRegistered) {
        // If the config is missing or invalid, then run `init` instead.
        return COMMANDS['init'](context, [])
          .then(function() {
            view.log('===========================================================')
            view.log('Identity created!  Run vox again to enter interactive mode.');
            process.exit(0);
          })
      } else {
        if (!config.isRegistered && cmdName != 'init') {
          console.error('Config file invalid: %s', argv.configFile);
          console.error('Please run `vox init` before any other command.');
          process.exit(1);
        }
        return handler(context, args, argv);
      }
    })
    .finally(function() {
      context.close();
    })
    .then(function() {
      process.exit(0);
    })
    .catch(function(err) {
      console.error('Error!', err, err.stack);
      view.log('Error', err, err.stack)
      // TODO
      // process.exit(err.status ? err.status : 1);
    });
}


/**
 * Creates a context object that can be passed to command handlers.
 */
function RootContext(argv, profileFilenames, view) {
  var self = {
      commands: COMMANDS, // Overwritten when interactive
      profileFilenames: profileFilenames,
      interactive: false,
      argv: argv,
      view: view,
      config: null,
      nick: null,
      privkey: null,
      hubClient: null,
      voxClient: null,
  };

  self.initWithConfig = function(config) {
    if (self.voxClient) {
      throw new Error('Already initialized!');
    }

    self.config = config;
    self.nick = config.nick;

    self.voxClient = new VoxClient({
        config: config,
        agentString: AGENT_STRING,
    });
    return self.voxClient.connect();
  }

  self.reinitWithConfig = function(config) {
    self.close();
    return self.initWithConfig(config);
  }

  self.close = function() {
    if (self.voxClient) {
      self.voxClient.close();
      self.voxClient = null;
    }
  }

  /**
   * Logs connection status events.
   */
  self.listenForConnectionStatusEvents = function() {
    self.voxClient.on('connect', function(info) {
      self.view.log(colors.cyan.dim('Connected: ' + info.interchangeUrl));
    });
    self.voxClient.on('disconnect', function(info) {
      self.view.log(colors.red.dim('Disconnected: ' + info.interchangeUrl));
    });
    self.voxClient.on('error', function(info) {
      self.view.log(colors.red.dim('Connection error: ' + info.interchangeUrl));
    });
    self.voxClient.on('reconnect_failed', function(info) {
      self.view.log(colors.red.dim('Reconnection failed: ' + info.interchangeUrl));
    });
  }

  self.printJson = function(obj_or_name, obj) {
    if (obj !== undefined) {
      self.view.log('%s %s', obj_or_name, JSON.stringify(obj));
    } else {
      self.view.log(JSON.stringify(obj_or_name));
    }
  }

  return self;
}


/**
 * The set of commands that can be invoked in non-interactive mode.
 */
var COMMANDS = {
  help: require('./command-help'),
  init: require('./command-init'),
  interactive: require('./command-interactive'),
  stream: require('./command-stream')
}


Main();
