/**
 * Interface to the server's database.
 *
 * By default, it's an on-disk SQLite database.
 */

var debug = require('debug')('vox:interchangedb');
var debugSql = require('debug')('vox:interchangedb:sql');
var errors = require('vox-common/errors');
var eyes = require('vox-common/eyes');
var LevelChain = require('./level-chain');
var levelup = require('level');
var lruCache = require('lru-cache');
var P = require('bluebird');
var S = require('sequelize');
var TargetSessionCache = require('./target-session-cache');
var util = require('util');


var sqlLogging = function(v) {
  debugSql(v);
}


/**
 * Sets the `syncedAt` timestamp, and `updatedAt` and `createdAt`, if they are
 * not set.
 */
function EnsureTimestamps(columns, allowSyncedAt) {
  var now = new Date().getTime();
  if (!allowSyncedAt || !columns.syncedAt) {
    columns.syncedAt = now;
  }
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
      logging: sqlLogging
  });

  var leveldb = levelup(self.messageDbDir, { valueEncoding: 'json' });
  P.promisifyAll(leveldb);

  self.sequelize = db;
  self.leveldb = leveldb;
  var levelChain = new LevelChain(leveldb);

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
      'version'         : S.STRING,
      'agent'           : S.STRING,
      'webhook'         : S.STRING,
      'isConnected'     : S.BOOLEAN,
      'remoteAddress'   : S.STRING,
      'createdAt'       : S.BIGINT,
      'lastSeenAt'      : S.BIGINT,
      'connectedAtDbSeq': S.BIGINT
  });

  self.FindSession = function(sessionId) {
    return Session.find({ where: { sessionId: sessionId } });
  }

  var targetSessionCache = new TargetSessionCache(1e5) // 1e5 * 36 bytes per UUID ~= 3.6MB
  var MIN_TARGET_SESSION_CACHE_REFRESH_MS = 10 * 1e3; // Refresh at most every 10 seconds.

  self.NewSession = function(columns) {
    eyes.mark('interchangedb.NewSession');
    if (columns.isConnected) {
      // Not portable, but we just need any number that is strictly increasing
      // from the DB's point of view, so we can (a) tell given two query result
      // sets which is most recent, and (b) scan for just the sessions that have
      // connected since a previous query.
      columns.connectedAtDbSeq = S.fn('total_changes');
    }
    return Session.create(columns);
  }

  self.SetSessionConnected = function(columns) {
    if (columns.isConnected) {
      columns.connectedAtDbSeq = S.fn('total_changes');
    }
    return Session.update(columns,
        { where: { sessionId: columns.sessionId } });
  }

  /**
   * Calls callback(id) for each session ID that is connected and has an active
   * route for the given URL.
   */
  self.ForTargetSessionIds = function(url, callback, opt_forceRefresh) {
    eyes.mark('interchangedb.ForTargetSessionIds');

    var cached = targetSessionCache.get(url);
    var stopTimer;
    var originalDbSeq;

    // Check if the session ID list is cached:
    if (cached) {
      eyes.mark('interchangedb.ForTargetSessionIds.cached');

      // It is cached, so start calling those callbacks.
      cached.cooperativeForEach(callback);

      // See if we need to refresh the cache entry.  If there's a pending
      // promise, we'll chain off of it.  Otherwise, we check to see if it's
      // been long enough since the last refresh.
      var canRefresh = opt_forceRefresh || ((Date.now() - cached.lastRefreshTime) > MIN_TARGET_SESSION_CACHE_REFRESH_MS);
      if ((!cached.promise || !cached.promise.isPending()) && canRefresh) {
        var stopTimer = eyes.start('interchangedb.ForTargetSessionIds.refresh_cache');
        debug('Refreshing cache for %s', url);
        // We query for any sessions that have connected since the cache was
        // last populated.
        cached.promise = queryForTargetSessions(url, cached.dbSeq);
        originalDbSeq = cached.dbSeq;
      }
    } else {
      // It's not cached, so we need to initiate a full fetch.
      debug('Populating cache for %s', url);
      cached = targetSessionCache.set(url, [], 0);
      var stopTimer = eyes.start('interchangedb.ForTargetSessionIds.uncached');
      cached.promise = queryForTargetSessions(url);
      originalDbSeq = cached.dbSeq;
    }

    // If no promise is pending, we can just return.
    if (!cached.promise || !cached.promise.isPending()) {
      return P.resolve(cached.ids);
    }

    // Wait for the pending fetch, then call the callback with the remaining
    // results.
    return cached.promise.then(function(results) {
      // If stopTimer is set, then this context "owns" the promise.
      if (stopTimer) {
        stopTimer();
        var cached = targetSessionCache.peek(url);
        // Only update the cache if it hasn't been touched since the fetch started.
        if (cached && cached.dbSeq == originalDbSeq) {
          cached.lastRefreshTime = Date.now();
          cached.ids.push.apply(cached.ids, results.sessionIds);
          cached.dbSeq = Math.max(cached.dbSeq, results.dbSeq);
          cached.promise = null;
        } else {
          eyes.mark('interchangedb.ForTargetSessionIds.cache_preempted_during_refresh');
        }
      } else {
        eyes.mark('interchangedb.ForTargetSessionIds.cache_chained');
      }
      if (results.sessionIds.length) {
        debug('Adding %d IDs to cached list for %s', results.sessionIds.length, url);
      }
      TargetSessionCache.cooperativeForEach(results.sessionIds, callback);
      return cached ? cached.ids : results.sessionIds;
    });
  }

  /**
   * Queries for sessions that are connected and also have an active route for
   * the given URL.
   *
   * @param {String} url The routeUrl to query for.
   * @param {Number} [minDbSeq] The minimum connectedAtDbSeq to query for.
   */
  function queryForTargetSessions(url, minDbSeq) {
    var where = { isConnected: true };
    if (minDbSeq) {
      where.connectedAtDbSeq = { gt: minDbSeq };
    }
    return Session.findAll({
        where: where,
        attributes: [
            'sessionId',
            'connectedAtDbSeq',
        ],
        include: [{
            model: Route,
            where: { routeUrl: url, weight: { gt: 0 } },
            attributes: []
        }],
        group: '`Session`.`sessionId`',
    }, { raw: true })
    .then(function(sessions) {
      var sessionIds = [];
      var dbSeq = -1;
      for (var i = 0; i < sessions.length; i++) {
        var session = sessions[i];
        var sessionId = session['sessionId'];
        sessionIds.push(sessionId);
        dbSeq = Math.max(session['connectedAtDbSeq'], dbSeq);
      }
      return { sessionIds: sessionIds, dbSeq: dbSeq };
    })
  }

  /**
   * Removes the sessionId from the cached list for the given URL.
   */
  self.UncacheTargetSessionId = function(url, sessionId) {
    var cached = targetSessionCache.peek(url);
    if (!cached) {
      return;
    }
    var i = cached.ids.indexOf(sessionId);
    if (i == -1) {
      return;
    }
    // Copy-on-write so that we don't disturb any iterations in progress.
    var ids = cached.ids.slice(0, i);
    ids.push.apply(ids, cached.ids.slice(i + 1));
    cached.ids = ids;
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
    var cached = targetSessionCache.get(url);
    if (columns.weight) {
      if (cached && cached.ids.indexOf(sessionId) == -1) { // O(N^2)!
        cached.ids.push(sessionId);
        // cached.maxSyncedAt = Math.max(cached.maxSyncedAt, columns.syncedAt);
      }
    } else if (cached) {
      var i = cached.ids.indexOf(sessionId);
      if (cached && i != -1) {
        cached.ids.splice(i, 1);
        // TODO race cond since maxSyncedAt does not get updated?
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

  /*
   * Message keys/indexes
   *
   * Since LevelDB is essentially just a sorted hashtable, we need to implement
   * our own indexing for fast scans.
   *
   * Each message can write to the following keys in LevelDB.  ('/' stands for
   * the path separator '\x00').
   *
   * - Message:
   *     <messageUrl>
   *
   * - By source:
   *     s/<source>/-/<syncedAt DESC>/<messageUrl>
   *
   * - By sequence number:
   *     s/<source>/seq/<seq ASC>/<messageUrl>
   *
   * - By author:
   *     s/<source>/a/<author>/<syncedAt DESC>/<messageUrl>
   *
   * - By thread:
   *     s/<source>/t/<thread>/<syncedAt DESC>/<messageUrl>
   *
   * - By replyTo:
   *     s/<source>/rt/<replyTo>/<syncedAt DESC>/<messageUrl>
   *
   * To scan for all the messages from a source/author, we just set the start
   * and end keys to:
   *
   *     start = s/spacemaus/a/landcatt/
   *     end = s/spacemaus/a/landcatt/\xff
   *
   * To scan for messages between `syncedBefore` and `syncedAfter`, we set the
   * start and end keys to:
   *
   *     start = s/spacemaus/a/landcatt/<syncedBefore DESC>/
   *     end = s/spacemaus/a/landcatt/<syncedAfter DESC>/\xff
   *
   * Note that in all cases, the end key's terminator '\xff' comes _after_ the
   * separator '\x00'.
   */
  self.InsertMessage = function(columns, opt_allowSyncedAt) {
    // TODO Prevent overwrites.
    var stopTimer = eyes.start('interchangedb.InsertMessage');
    var messageUrl = columns.messageUrl;
    return levelChain.batch(columns.source, function(batch, seq) {
        EnsureTimestamps(columns, opt_allowSyncedAt);
        columns.seq = seq;
        var prefix = 's\x00' + columns.source + '\x00';
        var descSuffix = '\x00' + ToDesc(columns.syncedAt) + '\x00' + messageUrl;
        batch
          .put(messageUrl, columns)
          .put(prefix + '-' + descSuffix, '')
          .put(prefix + 'seq\x00' + ToAsc(seq) + '\x00' + messageUrl, '')
          .put(prefix + 'a\x00' + columns.author + descSuffix, '');
        if (columns.thread) {
          batch.put(prefix + 't\x00' + columns.thread + descSuffix, '')
        }
        if (columns.replyTo) {
          batch.put(prefix + 'rt\x00' + columns.replyTo + descSuffix, '')
        }
      })
      .then(stopTimer)
      .return(columns);
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
    } else if (options.seqAfter) {
      prefix += 'seq'
    } else {
      prefix += '-';
    }
    prefix += '\x00';
    var startKey = prefix;
    if (options.seqAfter) {
      startKey += ToAsc(options.seqAfter);
    } else if (options.syncedBefore) {
      startKey += ToDesc(options.syncedBefore) + '\x00';
    }
    var endKey;
    if (options.syncedAfter) {
      endKey = prefix + ToDesc(options.syncedAfter) + '\x00\xff';
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

  //////////
  // Misc //
  //////////

  self.Close = function() {
    db.close();
    leveldb.close();
  }

  return db.sync()
    .then(function() {
      return P.all([
          CreateDeleteOlderRowsTrigger(Route),
          CreateDeleteOlderRowsTrigger(Subscription),
          CreateDeleteOlderRowsTrigger(UserStatus),
          Session.update({ isConnected: false }, { where: {} })
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
function ToAsc(n) {
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
