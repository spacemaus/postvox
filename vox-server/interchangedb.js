/**
 * Interface to the server's database.
 *
 * By default, it's an on-disk SQLite database.
 */

var debug = require('debug')('vox:interchangedb');
var debugSql = require('debug')('vox:interchangedb:sql');
var errors = require('vox-common/errors');
var eyes = require('vox-common/eyes');
var LevelChain = require('vox-common/level-chain');
var LevelIndex = require('vox-common/level-index');
var levelup = require('level');
var lruCache = require('lru-cache');
var P = require('bluebird');
var S = require('sequelize');
var TargetSessionCache = require('./target-session-cache');
var util = require('util');
var voxurl = require('vox-common/voxurl');


var sqlLogging = function(v) {
  debugSql(v);
}


/**
 * Sets the `syncedAt` and `createdAt` timestamps, if they are not set.
 */
function ensureTimestamps(columns, allowSyncedAt) {
  var now = Date.now();
  if (!allowSyncedAt || !columns.syncedAt) {
    columns.syncedAt = now;
  }
  if (!columns.createdAt) {
    // Take the value from the client, if present:
    columns.createdAt = columns.updatedAt;
  }
}


var DEFAULT_MIN_TARGET_SESSION_CACHE_REFRESH_MS = 10 * 1e3; // Refresh at most every 10 seconds.


/**
 * Opens or creates a database for the given dbTag.
 *
 * @param {Object} config
 * @param {String} config.dbFile The path to the local database file.
 * @param {String} config.streamDbDir The path to the local message database
 *     directory.
 * @param {int} [config.minTargetCacheRefreshMs] The minimum number of
 *     milliseconds between refreshes of the target-to-sessionId cache.
 *     Defaults to 10 seconds.
 *
 * @returns {Promise<Object>} a Promise for a database object.
 */
exports.openDb = function(config) {
  if (!config.dbFile) {
    throw new Error('Must specify config.dbFile');
  }
  if (!config.streamDbDir) {
    throw new Error('Must specify config.streamDbDir');
  }

  var self = {};
  self.dbFile = config.dbFile;
  self.streamDbDir = config.streamDbDir;
  self.minTargetCacheRefreshMs = config.minTargetCacheRefreshMs === undefined ? DEFAULT_MIN_TARGET_SESSION_CACHE_REFRESH_MS : config.minTargetCacheRefreshMs;

  debug('Using dbFile', self.dbFile);
  debug('Using streamDbDir', self.streamDbDir);

  var db = new S(null, null, null, {
      dialect: 'sqlite',
      storage: self.dbFile,
      logging: sqlLogging
  });

  var leveldb = levelup(self.streamDbDir, { valueEncoding: 'json' });
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

  self.getUserProfile = function(nick, opt_updatedBefore) {
    eyes.mark('interchangedb.getUserProfile');
    var where = { nick: nick };
    if (opt_updatedBefore) {
      where.updatedAt = { lt: opt_updatedBefore };
    }
    return UserProfile.findOne({
        where: where,
        order: 'updatedAt DESC'
    });
  }

  self.saveUserProfile = function(columns) {
    eyes.mark('interchangedb.saveUserProfile');
    ensureTimestamps(columns);
    return UserProfile.create(columns)
      .catch(S.UniqueConstraintError, function(err) {
        // Ignore.
        debug('Ignoring duplicate insert for UserProfile: %s', columns.nick);
        eyes.mark('interchangedb.saveUserProfile.duplicate');
        return self.getUserProfile(columns.nick);
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

  self.findSession = function(sessionId) {
    return Session.find({ where: { sessionId: sessionId } });
  }

  var targetSessionCache = new TargetSessionCache(1e5) // 1e5 * 36 bytes per UUID ~= 3.6MB

  self.createSession = function(columns) {
    eyes.mark('interchangedb.createSession');
    if (columns.isConnected) {
      // Not portable, but we just need any number that is strictly increasing
      // from the DB's point of view, so we can (a) tell given two query result
      // sets which is most recent, and (b) scan for just the sessions that have
      // connected since a previous query.
      columns.connectedAtDbSeq = S.fn('total_changes');
    }
    return Session.create(columns);
  }

  self.setSessionConnected = function(columns) {
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
  self.forTargetSessionIds = function(url, callback, opt_forceRefresh) {
    eyes.mark('interchangedb.forTargetSessionIds');

    var cached = targetSessionCache.get(url);
    var stopTimer;
    var originalDbSeq;

    // Check if the session ID list is cached:
    if (cached) {
      eyes.mark('interchangedb.forTargetSessionIds.cached');

      // It is cached, so start calling those callbacks.
      cached.cooperativeForEach(callback);

      // See if we need to refresh the cache entry.  If there's a pending
      // promise, we'll chain off of it.  Otherwise, we check to see if it's
      // been long enough since the last refresh.
      var canRefresh = opt_forceRefresh || ((Date.now() - cached.lastRefreshTime) > self.minTargetCacheRefreshMs);
      if ((!cached.promise || !cached.promise.isPending()) && canRefresh) {
        var stopTimer = eyes.start('interchangedb.forTargetSessionIds.refresh_cache');
        debug('Refreshing cache for %s', url);
        // We query for any sessions that have connected since the cache was
        // last populated.
        cached.promise = _queryForTargetSessions(url, cached.dbSeq);
        originalDbSeq = cached.dbSeq;
      }
    } else {
      // It's not cached, so we need to initiate a full fetch.
      debug('Populating cache for %s', url);
      cached = targetSessionCache.set(url, [], 0);
      var stopTimer = eyes.start('interchangedb.forTargetSessionIds.uncached');
      cached.promise = _queryForTargetSessions(url);
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
          eyes.mark('interchangedb.forTargetSessionIds.cache_preempted_during_refresh');
        }
      } else {
        eyes.mark('interchangedb.forTargetSessionIds.cache_chained');
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
  function _queryForTargetSessions(url, minDbSeq) {
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
  self.uncacheTargetSessionId = function(url, sessionId) {
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

  self.insertRoute = function(columns) {
    ensureTimestamps(columns);
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


  /////////////
  // Streams //
  /////////////

  /*
   * Stream keys/indexes:
   *
   * Since LevelDB is essentially just a sorted hashtable, we need to implement
   * our own indexing for fast scans.
   */
   self._stanzaIndex = new LevelIndex(
      voxurl.getStanzaUrl,
      [['stream', 's'], ['seq', 'seq', LevelIndex.toAsc]],
      [['stream', 's'], ['nick', 'n'], ['seq', 'seq', LevelIndex.toAsc]],
      [['stream', 's'], ['thread', 't'], ['seq', 'seq', LevelIndex.toAsc]],
      [['stream', 's'], ['replyTo', 'rt'], ['seq', 'seq', LevelIndex.toAsc]],
      [['stream', 's'], ['opSeq', 'opSeq'], ['seq', 'seq', LevelIndex.toAsc]])

  self.appendStanza = function(stanza, opt_allowSyncedAt) {
    var stopTimer = eyes.start('interchangedb.appendStanza');
    return levelChain.batch(stanza.stream, function(batch, seq) {
        ensureTimestamps(stanza, opt_allowSyncedAt);
        stanza.seq = seq;
        self._stanzaIndex.put(batch, stanza);
      })
      .then(stopTimer)
      .return(stanza);
  }

  self.getStanza = function(stanzaUrl) {
    var stopTimer = eyes.start('interchangedb.getStanza');
    return leveldb.getAsync(stanzaUrl).finally(stopTimer);
  }

  /**
   * Lists stanzas in sequential order.
   *
   * @param {Object} options
   * @param {String} options.stream Filter by stanza stream.  Required.
   * @param {int} options.limit The max number of stanzas to return.
   * @param {String} [options.nick] Filter by stanza author.
   * @param {String} [options.thread] Filter by stanza thread.
   * @param {String} [options.replyTo] Filter by stanza replyTo.
   * @param {String} [options.opSeq] Filter by stanza opSeq.
   * @param {int} [options.seqStart] Fetch stanzas starting from this seq value.
   * @param {int} [options.seqLimit] Fetch stanzas up to this seq value.
   * @param {bool} [options.reverse] Fetch in reverse order.
   */
  self.listStanzas = function(options) {
    var stopTimer = eyes.start('interchangedb.listStanzas');
    return self._stanzaIndex.scan(leveldb, options)
      .then(function(messages) {
        stopTimer(messages.length)
        return messages;
      });
  }


  ///////////////////////
  // Database Triggers //
  ///////////////////////

  function matchPrimaryKeys(model) {
    return model.primaryKeyAttributes.map(
        function(name) { return util.format('%s = NEW.%s', name, name)})
        .join(' AND ');
  }

  function createDeleteOlderRowsTrigger(model) {
    var tableName = model.tableName;
    var triggerName = 'deleteOlderRowsBeforeInsert_' + tableName;
    return P.all([
      db.query(util.format('DROP TRIGGER IF EXISTS %s', triggerName)),
      db.query(util.format(
            'CREATE TRIGGER %s BEFORE INSERT ON %s ' +
            'FOR EACH ROW BEGIN ' +
                'DELETE FROM %s WHERE %s AND updatedAt <= NEW.updatedAt;' +
            'END',
            triggerName, tableName, tableName, matchPrimaryKeys(model)))
    ]);
  }

  //////////
  // Misc //
  //////////

  self.close = function() {
    db.close();
    leveldb.close();
  }

  return db.sync()
    .then(function() {
      return P.all([
          createDeleteOlderRowsTrigger(Route),
          Session.update({ isConnected: false }, { where: {} })
      ]);
    })
    .return(self);
}

