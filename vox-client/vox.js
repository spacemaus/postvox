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
 * By default, it stores its config and database files in $HOME/.voxconfig.json
 * and $HOME/.voxhistory/vox-<nickname>.db, respectively.  If you'd like to
 * customize those paths:
 *
 *     $ node ./vox.js --configFile path/to/config.json --dbDir path/to/my/dir
 *
 * If you'd like to see what the client is sending and receiving, set the DEBUG
 * environment variable:
 *
 *     $ DEBUG='vox:interchangeclient' node ./vox.js
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
var interchangeClient = require('vox-common/interchangeclient');
var lockfile = require('lockfile');
var mkdirp = require('mkdirp');
var P = require('bluebird');
var path = require('path');
var termview = require('./termview');
var urlparse = require('url');
var ursa = require('ursa');
var util = require('util');
var voxcommon = require('vox-common');


P.promisifyAll(lockfile);


var PROTOCOL_VERSION = '0.0.0';
var AGENT_STRING = 'Vox.js 0.0.5';


function Main() {
  // The config stores the user's info: their nickname, public and private keys,
  // their home interchange server address, and any "about" text.
  //
  // The configSet stores a dictionary of such configs.
  var config = configs.getUserConfig(argv.configFile, argv.nick);
  _RunCommand(config);
}


/** Runs the actual command. */
function _RunCommand(config) {
  // The command that the user entered on the command line:
  var cmdName = argv._[0] || 'interactive';
  if (cmdName[0] == '/') {
    cmdName = cmdName.substr(1);
  }
  if (argv.help || argv.h) {
    cmdName = 'help';
  }

  var handler = COMMANDS[cmdName];
  if (!handler) {
    console.error('Unknown command: %s', cmdName);
    process.exit(1);
  }

  var view;
  if (cmdName == 'interactive' && config.privkey && process.stdout.isTTY && process.stdin.isTTY && !argv.noTTY) {
    view = fancyview.FancyView();
    view.Attach();
  } else {
    view = termview.TermView();
  }

  var context = RootContext(argv, view);

  // Open our local database and initialize our client stubs.
  return context.OpenDatabaseForConfig(config)
    .then(function() {
      var args = argv._.slice(1);

      // We listen for session updates globally.  This ensures that we save any
      // new session IDs, and lets us know when we need to re-establish routes
      // when a server has "forgotten" one of our sessions.
      context.ListenForSessionUpdates();

      // Similarly, we listen for updates to other users' profiles, so we know
      // which servers to connect to.
      context.ListenForUserProfileUpdates();

      // Now, run the user's command.
      if (cmdName == 'interactive' && !config.privkey) {
        // If the config is missing or invalid, then run `init` instead.
        return COMMANDS['init'](context, [])
          .then(function() {
            view.log('===========================================================')
            view.log('Identity created!  Run vox again to enter interactive mode.');
            process.exit(0);
          })
      } else {
        if (!config.privkey && cmdName != 'init') {
          console.error('Config file invalid: %s', argv.configFile);
          console.error('Please run `vox init` before any other command.');
          process.exit(1);
        }
        return handler(context, args);
      }
    })
    .finally(function() {
      context.Close();
    })
    .then(function() {
      process.exit(0);
    })
    .catch(function(err) {
      console.error('Error!', err, err.stack);
      process.exit(err.status ? err.status : 1);
    });
}


/**
 * Creates a context object that can be passed to command handlers.
 */
function RootContext(argv, view) {
  var self = {
      commands: COMMANDS, // Overwritten when interactive
      interactive: false,
      argv: argv,
      view: view,
      config: null,
      nick: null,
      privkey: null,
      db: null,
      hubClient: null,
      connectionManager: null,
      lockfileName: null,
      hasLock: false
  };

  self.OpenDatabaseForConfig = function(config) {
    if (self.db) {
      throw new Error('A database is already open!');
    }

    self.config = config;
    self.nick = config.nick;
    self.SetPrivkey(config.privkey);

    var dbConfig = {
        dbFile: PrepareDbFile(argv.dbDir, self.nick)
    }

    self.lockfileName = dbConfig.dbFile + '.vox-lock';

    return TakeDatabaseLock()
      .then(function() {
        return clientdb.OpenDb(dbConfig);
      })
      .then(function(db) {
        self.db = db;
        self.hubClient = hubClient.HubClient(argv.hubUrl, db);
        self.connectionManager = interchangeClient.ConnectionManager(
            self.hubClient,
            PROTOCOL_VERSION,
            AGENT_STRING);
      });
  }

  self.SetPrivkey = function(privkey) {
    self.privkey = privkey ? ursa.createPrivateKey(privkey) : null
  }

  self.ReopenDatabaseForConfig = function(config) {
    if (self.db) {
      self.CloseDatabase();
    }
    return self.OpenDatabaseForConfig(config);
  }

  self.CloseDatabase = function() {
    if (self.db) {
      self.db.Close();
      self.db = null;
      self.hubClient = null;
      self.connectionManager = null;
    }
    if (self.hasLock) {
      ReleaseDatabaseLock();
    }
  }

  self.Close = function() {
    self.CloseDatabase();
  }

  function TakeDatabaseLock() {
    if (!self.lockfileName) {
      throw new Error('Lockfile name not set!');
    }
    return lockfile.lockAsync(self.lockfileName, { wait: 2000 })
      .then(function() {
        self.hasLock = true;
      })
      .catch(function(err) {
        console.error('Database is locked/in use by another vox command. %s', self.lockfileName, err);
        process.exit(1);
      });
  }

  function ReleaseDatabaseLock() {
    if (!self.hasLock) {
      return;
    }
    lockfile.unlockSync(self.lockfileName);
    self.hasLock = false;
  }

  /**
   * Sends a /routes request to the interchange server registered for `source`.
   * This tells the server to send us any stanzas published to the given
   * `routeUrl`.
   *
   * @param {String} routeUrl The URL to request push messages for.
   * @param {String} source The nickname of the user whose interchange server
   *     we're connecting to.
   * @param {int} weight The weight of the route, 0 or 1.
   * @returns {Promise<InterchangeConnection>}
   */
  self.SendRouteRequest = function(routeUrl, source, weight) {
    return self.EnsureInterchangeSession(source)
      .then(function(conn) {
        var reqUrl = 'vox://' + source + '/session/' + conn.sessionId + '/routes';
        return conn.POST(reqUrl, {
            routeUrl: routeUrl,
            weight: weight,
            updatedAt: new Date().getTime()
        })
        .then(function() {
          return self.db.InsertRoute({
              routeUrl: routeUrl,
              source: source,
              sessionId: conn.sessionId,
              interchangeUrl: conn.interchangeUrl,
              weight: weight
          });
        })
        .return(conn);
      });
  }

  /**
   * Listens for new session IDs.  If an interchange has issued us a new session
   * ID, we attempt to restore any routes we had previously established with
   * that interchange.
   */
  self.ListenForSessionUpdates = function() {
    self.connectionManager.on('SESSION', function(session) {
      if (!session.newSessionId) {
        return;
      }
      var sessionId = session.newSessionId;

      debug('Saving new sessionId: %s', sessionId);
      self.db.SetInterchangeSessionId({
          interchangeUrl: session.interchangeUrl,
          sessionId: sessionId
      });

      // Since the server has assigned us a new session ID, we need to
      // reestablish the routes we had previously set up during a different
      // session.  Ideally, servers won't reassign new session IDs very often,
      // so this should mostly be called for new connections with no previous
      // routes.

      // TODO This is a little iffy.  If the session bounces while we are
      // reestablishing the routes, then things might go sideways.

      self.db.FindRoutes(session.interchangeUrl)
        .then(function(routes) {
          debug('Reestablishing %d routes to %s', routes.length, session.interchangeUrl);
          return P.all(routes.map(function(route) {
            if (route.sessionId == sessionId) {
              return;
            }
            return self.SendRouteRequest(route.routeUrl, route.source, route.weight);
          }));
        })
        .catch(function(err) {
          debug('Error reestablishing routes to %s', session.interchangeUrl, err.stack);
        });
    });
  }

  /**
   * Listens for user profile updates.  If a user we are following has switched
   * their interchangeUrl, then we need to connect to that new server and re-
   * establish any routes we had for the old server.
   */
  self.ListenForUserProfileUpdates = function() {
    self.connectionManager.on('USER_PROFILE', function(userProfile) {
      authentication.CheckUserProfileStanza(self.hubClient, userProfile)
        .then(function() {
          return self.db.SetUserProfile({
              nick: userProfile.nick,
              interchangeUrl: userProfile.interchangeUrl,
              pubkey: userProfile.pubkey,
              about: userProfile.about,
              createdAt: userProfile.createdAt,
              updatedAt: userProfile.updatedAt,
              sig: userProfile.sig,
              hubCreatedAt: userProfile.hubCreatedAt,
              hubSyncedAt: userProfile.hubSyncedAt,
              hubSig: userProfile.hubSig,
          });
        })
        .then(function() {
          var newInterchangeUrl = userProfile.interchangeUrl;
          return self.db.FindRoutesBySource(userProfile.nick)
            .then(function(routes) {
              debug('Checking %d routes for user %s to %s', routes.length, userProfile.nick, newInterchangeUrl)
              return P.all(routes.map(function(route) {
                if (route.interchangeUrl == newInterchangeUrl) {
                  return;
                }
                return self.SendRouteRequest(route.routeUrl, route.source, route.weight);
              }));
            });
        })
        .catch(errors.AuthenticationError, function(err) {
          debug('Received invalid USER_PROFILE stanza, ignoring');
        })
        .catch(function(err) {
          debug('Error while processing a USER_PROFILE stanza', err.stack);
        })
    });
  }

  /**
   * Logs connection status events.
   */
  self.ListenForConnectionStatusEvents = function() {
    self.connectionManager.on('connect', function(info) {
      self.view.log(colors.cyan.dim('Connected: ' + info.interchangeUrl));
    });
    self.connectionManager.on('disconnect', function(info) {
      self.view.log(colors.red.dim('Disconnected: ' + info.interchangeUrl));
    });
    self.connectionManager.on('error', function(info) {
      self.view.log(colors.red.dim('Connection error: ' + info.interchangeUrl));
    });
    self.connectionManager.on('reconnect_failed', function(info) {
      self.view.log(colors.red.dim('Reconnection failed: ' + info.interchangeUrl));
    });
  }

  /**
   * Opens a socket connection to the interchange server for the given source,
   * then sends a POST to /session to create or restore a previous session.
   *
   * If the connection is already open and has a session, we just return it
   * without sending anything to the server.
   *
   * @param {String} source The user's nickname.
   * @returns {Promise<InterchangeConnection>}
   */
  self.EnsureInterchangeSession = function(source) {
    return self.connectionManager.Connect(source, self.nick)
      .then(function(interchangeConnection) {
        if (interchangeConnection.sessionId) {
          // We already have an open connection, so we can reuse it.
          return interchangeConnection;
        }
        var interchangeUrl = interchangeConnection.interchangeUrl;

        // Reuse a previous sessionId, or request a new session.
        return self.db.GetInterchangeSessionId(interchangeUrl)
          .then(function(session) {
            return interchangeConnection.SESSION(
                source, session ? session.sessionId : undefined);
          })
          .then(function(reply) {
            self.view.log(colors.cyan.dim('Server version: %s; %s'), reply.version, reply.agent);
          })
          .return(interchangeConnection);
      });
  }

  /**
   * Reads saved subscriptions for the user, then calls
   * `EnsureInterchangeSession()` for each.
   *
   * @returns {Array<Promise<InterchangeConnection>>}
   */
  self.EnsureSessionsForSubscriptions = function() {
    return self.db.ListSubscriptions(self.nick)
      .then(function(subscriptions) {
        return P.settle(subscriptions.map(function(subscription) {
          var url = urlparse.parse(subscription.subscriptionUrl);
          return self.EnsureInterchangeSession(url.hostname);
        }))
      });
  }

  self.PrintJson = function(obj_or_name, obj) {
    if (obj !== undefined) {
      self.view.log('%s %s', obj_or_name, JSON.stringify(obj));
    } else {
      self.view.log(JSON.stringify(obj_or_name));
    }
  }

  return self;
}


/**
 * Ensures that config.dbDir exists and formats an appropriate name for the DB
 * file.
 *
 * @return {String} DB file path.
 */
function PrepareDbFile(dbDir, nick) {
  var nick = nick || '.tmp';
  // Just in case `nick` has any funny business...
  nick = nick.replace(/[^\w\d.]/g, '-').replace('..', '-');
  debug('Ensuring directory at %s', dbDir);
  mkdirp.sync(dbDir, 0700);
  return path.join(dbDir, util.format('vox-%s.db', nick));
}


/**
 * The set of commands that can be invoked in non-interactive mode.
 */
var COMMANDS = {
  help: require('./command-help'),
  init: require('./command-init'),
  post: require('./command-post'),
  follow: require('./command-follow'),
  unfollow: require('./command-unfollow'),
  read: require('./command-read'),
  tail: require('./command-tail'),
  interactive: require('./command-interactive'),
  me: require('./command-setstatus'),
  status: require('./command-getstatus'),
}


Main();
