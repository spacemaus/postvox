var debug = require('debug')('vox:clientdb');
var voxcommon = require('vox-common');
var S = require('sequelize');
var P = require('bluebird');
var util = require('util');


var logging = function(v) {
  debug(v);
}


function EnsureTimestamps(columns) {
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


exports.OpenDb = function(config) {
    if (!config.dbFile) {
    throw new Error('Must specify config.dbFile');
  }

  var self = {};
  self.dbFile = config.dbFile;

  var db = new S(null, null, null, {
      dialect: 'sqlite',
      storage: self.dbFile,
      logging: logging
  });

  self.sequelize = db;

  /////////////////
  // UserProfile //
  /////////////////

  // Local cache of data from the Hub.  When we look up an user profile in the
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
    EnsureTimestamps(columns);
    return UserProfile.create(columns);
  }

  self.GetUserWithSubscriptions = function(nick) {
    return UserProfile.findOne({
        where: { nick: nick }, order: 'updatedAt DESC',
        include: [Subscription]
    });
  }


  ///////////////////
  // Subscriptions //
  ///////////////////

  var Subscription = db.define('Subscription', {
      'nick': {
          type: S.STRING,
          primaryKey: true,
      },
      'subscriptionUrl': {
          type: S.STRING(510),
          primaryKey: true,
      },
      'source'   : S.STRING,
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

  UserProfile.hasMany(Subscription, { foreignKey: 'source' });

  self.InsertSubscription = function(columns) {
    EnsureTimestamps(columns);
    return Subscription.create(columns);
  }

  self.ListSubscriptions = function(nick) {
    return Subscription.findAll({ where: { nick: nick, weight: { gt: 0 } } });
  }

  self.ListSubscriptionsBySource = function(nick) {
    return Subscription.findAll({ where: { nick: nick, weight: { gt: 0 } } });
  }


  //////////////////////
  // Requested routes //
  //////////////////////

  var Route = db.define('Route', {
      'routeUrl': {
          type: S.STRING(510),
          primaryKey: true
      },
      'source'        : S.STRING,
      'sessionId'     : S.STRING,
      'interchangeUrl': S.STRING,
      'weight'        : S.INTEGER,
      'createdAt'     : S.BIGINT,
      'updatedAt'     : S.BIGINT,
      'deletedAt'     : S.BIGINT,
      'syncedAt'      : S.BIGINT
  }, {
      timestamps: false,
      paranoid: true // include deletedAt column
  });

  self.InsertRoute = function(columns) {
    EnsureTimestamps(columns);
    return Route.create(columns);
  }

  self.FindRoutes = function(interchangeUrl) {
    return Route.findAll({
        where: {
            interchangeUrl: interchangeUrl,
            weight: { gt: 0 }
        }
    });
  }

  self.FindRoutesBySource = function(source) {
    return Route.findAll({ where: { source: source } });
  }


  /////////////////////////////
  // Interchange Session IDs //
  /////////////////////////////

  var InterchangeSessionId = db.define('InterchangeSessionId', {
      'interchangeUrl': { type: S.STRING, primaryKey: true },
      'sessionId'     : S.TEXT
  });

  self.SetInterchangeSessionId = function(columns) {
    return InterchangeSessionId.create(columns);
  }

  self.GetInterchangeSessionId = function(interchangeUrl) {
    return InterchangeSessionId.find({ where: { interchangeUrl: interchangeUrl } });
  }


  //////////////
  // Triggers //
  //////////////

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
  }

  return db.sync()
    .then(function() {
      return P.all([
          CreateDeleteOlderRowsTrigger(Route),
          CreateDeleteOlderRowsTrigger(UserProfile),
          CreateDeleteOlderRowsTrigger(Subscription),
          CreateDeleteOlderRowsTrigger(InterchangeSessionId),
      ]);
    })
    .return(self);
}
