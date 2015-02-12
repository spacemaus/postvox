var debug = require('debug')('vox:clientdb');
var LevelIndex = require('vox-common/level-index')
var levelup = require('level');
var P = require('bluebird');
var S = require('sequelize');
var util = require('util');
var voxcommon = require('vox-common');
var voxurl = require('vox-common/voxurl');


var logging = function(v) {
  debug(v);
}


function ensureTimestamps(columns) {
  var now = Date.now();
  if (!columns.updatedAt) {
    columns.updatedAt = now;
  }
  if (!columns.createdAt) {
    columns.createdAt = now;
  }
  if (!columns.syncedAt) {
    columns.syncedAt = now;
  }
}


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

  var db = new S(null, null, null, {
      dialect: 'sqlite',
      storage: self.dbFile,
      logging: logging
  });

  var leveldb = levelup(config.streamDbDir, { valueEncoding: 'json' });
  P.promisifyAll(leveldb);

  self.sequelize = db;
  self.leveldb = leveldb;

  /////////////////////////////////
  // Generic-ish key:value table //
  /////////////////////////////////

  var Row = db.define('Row', {
      'kind': { type: S.STRING, primaryKey: true },
      'key': { type: S.STRING, primaryKey: true },
      'value': S.TEXT,
      'createdAt': S.BIGINT,
      'updatedAt': S.BIGINT,
      'deletedAt': S.BIGINT,
      'seq': S.BIGINT,
      'ts': S.BIGINT,
      'stream': S.TEXT,
      'a': S.TEXT,
      'b': S.TEXT,
      'c': S.TEXT,
      'd': S.TEXT
  });

  self.insertRow = function(kind, row) {
    row.kind = kind;
    var originalValue = row.value;
    row.value = JSON.stringify(originalValue);
    return Row.create(row)
      .return(originalValue);
  }

  self.deleteRow = function(kind, key) {
    return Row.destroy({
        where: { kind: kind, key: key }
    });
  }

  self.getRow = function(kind, key) {
    return Row.find({ where: { kind: kind, key: key } })
      .then(function(row) {
        return row ? JSON.parse(row.value) : null;
      });
  }

  self.listRows = function(kind, where, options) {
    options = options || {};
    where = where || {};
    where.kind = kind;
    options.where = where;
    return Row.findAll(options)
      .then(function(rows) {
        return rows.map(function(row) {
          return JSON.parse(row.value);
        })
      })
  }

  self.countRows = function(kind, where) {
    where = where || {};
    where.kind = kind;
    return Row.count({ where: where });
  }


  /////////////////
  // UserProfile //
  /////////////////

  // Local cache of data from the Hub.  When we look up a user profile in the
  // Hub, we stash its data here.

  self.saveUserProfile = function(columns) {
    ensureTimestamps(columns);
    return self.insertRow(
        'UserProfile',
        {
            key: columns.nick + ':' + columns.updatedAt,
            value: columns,
            a: columns.nick,
            ts: columns.updatedAt
        });
  }

  self.getUserProfile = function(nick, opt_updatedBefore) {
    return self.listRows(
        'UserProfile',
        {
            a: nick,
            ts: { lt: opt_updatedBefore }
        },
        {
            order: 'ts DESC',
            limit: 1
        })
      .then(function(values) {
        return values.length ? values[0] : null;
      })
  }


  ///////////////////
  // Subscriptions //
  ///////////////////

  self.saveSubscription = function(columns) {
    ensureTimestamps(columns);
    return self.insertRow(
        'Subscription',
        {
            key: columns.url,
            value: columns,
            a: columns.interchangeUrl,
            b: columns.source
        });
  }

  self.deleteSubscription = function(url) {
    self.deleteRow('Subscription', url);
  }

  self.listSubscriptions = function() {
    return self.listRows('Subscription');
  }

  self.listSubscriptionsByInterchangeUrl = function(interchangeUrl) {
    return self.listRows('Subscription', { a: interchangeUrl });
  }

  self.listSubscriptionsBySource = function(source) {
    return self.listRows('Subscription', { b: source });
  }


  /////////////////////////////
  // Interchange Session IDs //
  /////////////////////////////

  self.setInterchangeSessionId = function(session) {
    return self.insertRow('InterchangeSessionId', {
       key: session.interchangeUrl,
       value: session
    });
  }

  self.getInterchangeSessionId = function(interchangeUrl) {
    return self.getRow('InterchangeSessionId', interchangeUrl)
      .then(function(session) {
        return session ? session.sessionId : undefined;
      });
  }


  /////////////
  // Streams //
  /////////////

  self._stanzaIndex = new LevelIndex(voxurl.getStanzaUrl,
    [['stream', 's'], ['seq', 'seq', LevelIndex.toAsc]],
    [['thread', 't'], ['seq', 'seq', LevelIndex.toAsc]])

  self.insertStanza = function(stanza) {
    var batch = leveldb.batch();
    self._stanzaIndex.put(batch, stanza);
    return P.fromNode(batch.write.bind(batch));
  }

  self.getStanza = function(stanzaUrl) {
    return leveldb.getAsync(stanzaUrl);
  }

  self.listStanzas = function(options) {
    return self._stanzaIndex.scan(leveldb, options);
  }

  self.setSyncCheckpoint = function(url, seq) {
    return self.insertRow(
        'SyncCheckpoint',
        {
            key: url,
            value: { seq: seq }
        });
  }

  self.getSyncCheckpoint = function(url) {
    return self.getRow('SyncCheckpoint', url)
      .then(function(v) {
        return v ? v.seq : 0;
      });
  }

  self.setSyncHorizon = function(url, seq) {
    return self.insertRow(
        'SyncHorizon',
        {
            key: url,
            value: { seq: seq }
        });
  }

  self.getSyncHorizon = function(url) {
    return self.getRow('SyncHorizon', url)
      .then(function(v) {
        return v ? v.seq : 0;
      });
  }

  ////////////////////////
  // Client checkpoints //
  ////////////////////////

  self.setClientCheckpoint = function(clientKey, stream, seq) {
    return self.insertRow(
        'ClientCheckpoint',
        {
            key: clientKey + ':' + stream,
            value: { seq: seq }
        });
  }

  self.getClientCheckpoint = function(clientKey, stream) {
    return self.getRow('ClientCheckpoint', clientKey + ':' + stream)
      .then(function(v) {
        return v ? v.seq : 0;
      });
  }


  //////////////
  // Triggers //
  //////////////

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
          createDeleteOlderRowsTrigger(Row),
      ]);
    })
    .return(self);
}
