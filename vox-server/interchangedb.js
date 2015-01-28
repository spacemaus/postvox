/**
 * Interface to the server's database.
 *
 * By default, it's an on-disk SQLite database.
 */

var debug = require('debug')('vox:interchangedb');
var errors = require('vox-common/errors');
var eyes = require('vox-common/eyes');
var levelup = require('level');
var lruCache = require('lru-cache');
var P = require('bluebird');
var S = require('sequelize');
var util = require('util');


var logging = function(v) {
  debug(v);
}


/**
 * Sets the `syncedAt` timestamp, and `updatedAt` and `createdAt`, if they are
 * not set.
 */
function EnsureTimestamps(columns) {
  var now = new Date().getTime();
  columns.syncedAt = now;
  if (!columns.updatedAt) {
    columns.updatedAt = now;
  }
  if (!columns.createdAt) {
    // Take the value from the client, if present:
    columns.createdAt = columns.updatedAt;
  }
}


/**
 * Opens or creates a database for the given dbTag.
 *
 * @param {Object} config
 * @param {String} config.dbFile The path to the local database file.
 * @param {String} config.messageDbDir The path to the local message database
 *     directory.
 *
 * @returns {Promise<Object>} a Promise for a database object.
 */
exports.OpenDb = function(config) {
  if (!config.dbFile) {
    throw new Error('Must specify config.dbFile');
  }
  if (!config.messageDbDir) {
    throw new Error('Must specify config.messageDbDir');
  }

  var self = {};
  self.dbFile = config.dbFile;
  self.messageDbDir = config.messageDbDir;

  debug('Using dbFile', self.dbFile);
  debug('Using messageDbDir', self.messageDbDir);

  var db = new S(null, null, null, {
      dialect: 'sqlite',
      storage: self.dbFile,
      logging: logging
  });

  var leveldb = levelup(self.messageDbDir, { valueEncoding: 'json' });
  P.promisifyAll(leveldb);

  self.sequelize = db;
  self.leveldb = leveldb;

  //////////////
  // Entities //
  //////////////

  // Local cache of data from the Hub.  When we look up a user profile in the
  // Hub, we stash its data here.

  var UserProfile = db.define('UserProfile', {
      'nick'          : { type: S.STRING, primaryKey: true },
      'interchangeUrl': S.STRING,
      'pubkey'        : S.TEXT,
      'about'         : S.TEXT,
      'createdAt'     : S.BIGINT,
      'updatedAt'     : { type: S.BIGINT, primaryKey: true },
      'deletedAt'     : S.BIGINT,
      'hubCreatedAt'  : S.BIGINT,
      'hubSyncedAt'   : S.BIGINT,
      'syncedAt'      : S.BIGINT,
      'sig'           : S.TEXT,
      'hubSig'        : S.TEXT
  }, {
      timestamps: false,
      paranoid: true // include deletedAt column
  });

  self.GetUserProfile = function(nick, opt_updatedBefore) {
    eyes.mark('interchangedb.GetUserProfile');
    var where = { nick: nick };
    if (opt_updatedBefore) {
      where.updatedAt = { lt: opt_updatedBefore };
    }
    return UserProfile.findOne({
        where: where,
        order: 'updatedAt DESC'
    });
  }

  self.SetUserProfile = function(columns) {
    eyes.mark('interchangedb.SetUserProfile');
    EnsureTimestamps(columns);
    return UserProfile.create(columns)
      .catch(S.UniqueConstraintError, function(err) {
        // Ignore.
        debug('Ignoring duplicate insert for UserProfile: %s', columns.nick);
        eyes.mark('interchangedb.SetUserProfile.duplicate');
        return self.GetUserProfile(columns.nick);
      });
  }


  //////////////
  // Sessions //
  //////////////

  var Session = db.define('Session', {
      'sessionId': {
          type: S.STRING,
          primaryKey: true
      },
      'version'      : S.STRING,
      'agent'        : S.STRING,
      'webhook'      : S.STRING,
      'isConnected'  : S.BOOLEAN,
      'remoteAddress': S.STRING,
      'createdAt'    : S.BIGINT,
      'lastSeenAt'   : S.BIGINT
  });

  self.FindSession = function(sessionId) {
    return Session.find({ where: { sessionId: sessionId } });
  }

  /**
   * Maps from routeUrl to { maxSyncedAt: int, sessionIds: String[] }.
   */
  var targetListCache = lruCache({
      max: 100000,  // 100000 * 36 bytes per UUID ~= 3.6MB
      length: function(v) { return v.sessionIds.length  || 1 }
  });

  self.NewSession = function(columns) {
    eyes.mark('interchangedb.NewSession');
    return Session.create(columns);
  }

  self.SetSessionConnected = function(columns) {
    return Session.update(columns,
        { where: { sessionId: columns.sessionId } });
  }

  /**
   * Gets the list of session IDs of connected sessions that have an active
   * route for the given URL.
   */
  self.GetTargetSessionIds = function(url) {
    eyes.mark('interchangedb.GetTargetSessionIds');
    var cached = targetListCache.get(url);
    if (cached) {
      eyes.mark('interchangedb.GetTargetSessionIds.cached');
      return P.resolve(cached.sessionIds);
    }
    eyes.mark('interchangedb.GetTargetSessionIds.uncached');
    var stopTimer = eyes.start('interchangedb.GetTargetSessionIds.uncached.latency');
    return Session.findAll({
          where: { isConnected: true },
          attributes: [
              'sessionId',
              [S.fn('MAX', S.col('Routes.syncedAt')), 'maxSyncedAt']
          ],
          include: [{
              model: Route,
              where: { routeUrl: url }
          }],
          group: '`Session`.`sessionId`',
      }, { raw: true })
      .then(function(sessions) {
        var sessionIds = [];
        var maxSyncedAt = -1;
        for (var i = 0; i < sessions.length; i++) {
          var session = sessions[i];
          sessionIds.push(session['sessionId']);
          maxSyncedAt = Math.max(session['maxSyncedAt'], maxSyncedAt);
        }
        var cached = targetListCache.get(url);
        // Prevent race conditions:
        if (!cached || cached.maxSyncedAt < maxSyncedAt) {
          targetListCache.set(url, {
              maxSyncedAt: maxSyncedAt,
              sessionIds: sessionIds
          });
        }
        stopTimer(sessionIds.length);
        return sessionIds;
      });
  }

  /**
   * Removes the sessionId from the list for the given URL.
   */
  self.UncacheTargetSessionId = function(url, sessionId) {
    var cached = targetListCache.peek(url);
    if (!cached) {
      return;
    }
    var i = cached.sessionIds.indexOf(sessionId);
    if (i == -1) {
      return;
    }
    cached.sessionIds.splice(i, 1);
    targetListCache.set(url, cached); // Updates last-usedness.  Needed?
  }


  ////////////
  // Routes //
  ////////////

  // Outgoing routes requested by peer interchange servers.
  var Route = db.define('Route', {
      'routeUrl': {
          type: S.STRING(510),
          primaryKey: true
      },
      'sessionId': {
          type: S.STRING,
          references: Session,
          referencesKey: 'sessionId',
          primaryKey: true
      },
      'weight'   : S.INTEGER,
      'createdAt': S.BIGINT,
      'updatedAt': S.BIGINT,
      'deletedAt': S.BIGINT,
      'syncedAt' : S.BIGINT
  }, {
      timestamps: false,
      paranoid: true // include deletedAt column
  });

  Route.belongsTo(Session, { foreignKey: 'sessionId' });
  Session.hasMany(Route, { foreignKey: 'sessionId' });

  self.InsertRoute = function(columns) {
    EnsureTimestamps(columns);
    var sessionId = columns.sessionId;
    var url = columns.routeUrl;
    var cached = targetListCache.get(url);
    if (columns.weight) {
      if (cached && cached.sessionIds.indexOf(sessionId) == -1) { // O(N^2)!
        cached.sessionIds.push(sessionId);
        cached.maxSyncedAt = Math.max(cached.maxSyncedAt, columns.syncedAt);
        targetListCache.set(url, cached);
      }
    } else if (cached) {
      var i = cached.sessionIds.indexOf(sessionId);
      if (cached && i != -1) {
        cached.sessionIds.splice(i, 1);
        // TODO race cond since maxSyncedAt does not get updated?
        targetListCache.set(url, cached);
      }
    }
    return Route.create(columns);
  }


  //////////////
  // Messages //
  //////////////

  // User-generated messages.
  //
  // Unlike the other objects, Messages are stored in LevelDB.

  self.InsertMessage = function(columns) {
    EnsureTimestamps(columns);
    var stopTimer = eyes.start('interchangedb.InsertMessage');
    // TODO Prevent overwrites.
    return new P(function(resolve, reject) {
      var messageUrl = columns.messageUrl;
      var desc = ToDesc(columns.syncedAt);
      var prefix = 's\x00' + columns.source + '\x00';
      var descSuffix = '\x00' + desc + '\x00' + messageUrl;
      var b = leveldb.batch()
        .put(messageUrl, columns)
        .put(prefix + '-' + descSuffix, '')
        .put(prefix + 'a\x00' + columns.author + descSuffix, '');
      if (columns.thread) {
        b.put(prefix + 't\x00' + columns.thread + descSuffix, '')
      }
      if (columns.replyTo) {
        b.put(prefix + 'rt\x00' + columns.replyTo + descSuffix, '')
      }
      b.write(function(err) {
        stopTimer();
        if (err) {
          debug('LevelDB error',err);
          reject(err);
        } else {
          resolve(columns);
        }
      });
    });
  }

  self.GetMessage = function(messageUrl) {
    var stopTimer = eyes.start('interchangedb.GetMessage');
    return leveldb.getAsync(messageUrl).finally(stopTimer);
  }

  /**
   * Lists messages in reverse chronological order.
   *
   * @param {Object} options
   * @param {String} options.source Filter by message source.
   * @param {String} [options.author] Filter by message author.
   * @param {String} [options.thread] Filter by message thread.
   * @param {String} [options.replyTo] Filter by message replyTo.
   * @param {int} options.limit The max number of messages to return.
   * @param {int} [options.syncedBefore] Fetch messages synced at or before this
   *     timestamp (in millis).
   * @param {int} [options.syncedAfter] Fetch messages synced at or after this
   *     timestamp (in millis).
   */
  self.ListMessages = function(options) {
    var stopTimer = eyes.start('interchangedb.ListMessages');
    var prefix = 's\x00' + options.source + '\x00';
    if (options.author) {
      prefix += 'a\x00' + options.author;
    } else if (options.thread) {
      prefix += 't\x00' + options.thread;
    } else if (options.replyTo) {
      prefix += 'rt\x00' + options.replyTo;
    } else {
      prefix += '-'
    }
    var startKey = prefix + '\x00';
    if (options.syncedBefore) {
      startKey += ToDesc(options.syncedBefore) + '\x00';
    }
    var endKey;
    if (options.syncedAfter) {
      endKey = prefix + '\x00' + ToDesc(options.syncedAfter) + '\xff';
    } else {
      endKey = prefix + '\xff';
    }
    return ScanIndex(leveldb, {
        gte: startKey,
        lte: endKey,
        limit: options.limit
    })
    .then(function(messages) {
      stopTimer(messages.length)
      return messages;
    });
  }


  ////////////////////////
  // User subscriptions //
  ////////////////////////

  // This stores the subscriptions we know about.

  var Subscription = db.define('Subscription', {
      'nick': {
          type: S.STRING,
          primaryKey: true,
      },
      'subscriptionUrl': {
          type: S.STRING(510),
          primaryKey: true,
      },
      'weight'   : S.INTEGER,
      'createdAt': S.BIGINT,
      'updatedAt': S.BIGINT,
      'deletedAt': S.BIGINT,
      'syncedAt' : S.BIGINT,
      'sig'      : S.STRING
  }, {
      timestamps: false,
      paranoid: true // include deletedAt column
  });

  self.InsertSubscription = function(columns) {
    eyes.mark('interchangedb.InsertSubscription');
    EnsureTimestamps(columns);
    return Subscription.create(columns)
      .catch(S.UniqueConstraintError, function(err) {
        throw new errors.ConstraintError(columns.nick + ':' + columns.updatedAt);
      });
  }

  self.ListSubscriptions = function(options) {
    var stopTimer = eyes.start('interchangedb.ListSubscriptions');
    var spec = MakeListSpec(options);
    spec.where.nick = options.nick;
    spec.where.weight = { gt: 0 };
    return Subscription.findAll(spec).finally(stopTimer);
  }

  self.ListSubscribersByUrl = function(options) {
    var stopTimer = eyes.start('interchangedb.ListSubscribersByUrl');
    var spec = MakeListSpec(options);
    spec.where.subscriptionUrl = options.subscriptionUrl;
    spec.where.weight = { gt: 0 };
    return Subscription.findAll(spec).finally(stopTimer);
  }

  self.CountSubscribersByUrl = function(subscriptionUrl) {
    var stopTimer = eyes.start('interchangedb.CountSubscribersByUrl');
    return Subscription.count({ where: {
        subscriptionUrl: subscriptionUrl,
        weight: { gt: 0 }
    }})
    .finally(stopTimer);
  }


  ///////////////////
  // User statuses //
  ///////////////////

  var UserStatus = db.define('UserStatus', {
      'nick': {
          type: S.STRING,
          primaryKey: true
      },
      'statusText': S.STRING,
      'createdAt' : S.BIGINT,
      'updatedAt' : S.BIGINT,
      'deletedAt' : S.BIGINT,
      'syncedAt'  : S.BIGINT,
      'sig'       : S.STRING
  }, {
      timestamps: false,
      paranoid: true // include deletedAt column
  });

  Subscription.hasOne(UserStatus, { foreignKey: 'nick' });

  self.SetUserStatus = function(columns) {
    EnsureTimestamps(columns);
    return UserStatus.create(columns)
      .catch(S.UniqueConstraintError, function(err) {
        throw new errors.ConstraintError(columns.nick + ':' + columns.updatedAt);
      });
  }

  self.GetUserStatus = function(nick) {
    return UserStatus.find({ where: { nick: nick } });
  }


  ///////////////////////
  // Database Triggers //
  ///////////////////////

  function MatchPrimaryKeys(model) {
    return model.primaryKeyAttributes.map(
        function(name) { return util.format('%s = NEW.%s', name, name)})
        .join(' AND ');
  }

  function CreateDeleteOlderRowsTrigger(model) {
    var tableName = model.tableName;
    var triggerName = 'deleteOlderRowsBeforeInsert_' + tableName;
    return P.all([
      db.query(util.format('DROP TRIGGER IF EXISTS %s', triggerName)),
      db.query(util.format(
            'CREATE TRIGGER %s BEFORE INSERT ON %s ' +
            'FOR EACH ROW BEGIN ' +
                'DELETE FROM %s WHERE %s AND updatedAt <= NEW.updatedAt;' +
            'END',
            triggerName, tableName, tableName, MatchPrimaryKeys(model)))
    ]);
  }

  return db.sync()
    .then(function() {
      return P.all([
          CreateDeleteOlderRowsTrigger(Route),
          CreateDeleteOlderRowsTrigger(Subscription),
          CreateDeleteOlderRowsTrigger(UserStatus)
      ]);
    })
    .return(self);
}


/**
 * For queries that have the typical limit, offset, syncedAfter options.
 */
function MakeListSpec(options) {
  var where = {};
  var order;
  if (options.syncedAfter) {
    where.syncedAt = { gt: options.syncedAfter };
    order = 'syncedAt';
  } else {
    order = 'syncedAt DESC';
  }
  return {
      where: where,
      order: order,
      limit: options.limit,
      offset: options.offset
  };
}


/**
 * Starts a LevelDB scan and returns a Promise for the list of results.
 *
 * @param {LevelDB} leveldb The DB to scan.
 * @param {Object} options An options object passed verbatim to
 *     leveldb.createReadStream().
 * @return {Promise<Object[]>} The scan results.
 */
function Scan(leveldb, options) {
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
function ScanIndex(leveldb, options) {
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
      .on('data', function(data) {
        var i = data.lastIndexOf('\x00');
        var key = data.substr(i + 1);
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
function ToHex(n) {
  _toHexBuffer.writeDoubleBE(n, 0)
  return _toHexBuffer.toString('hex');
}
var _toHexBuffer = new Buffer(8); // Good thing we're single-threaded.


/**
 * For leveldb keys, translates a Number into a string that can be
 * lexicographically ordered from highest to lowest (positive numbers only).
 */
function ToDesc(n) {
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
