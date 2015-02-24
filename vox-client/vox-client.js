var _ = require('lodash');
var argv = require('./argv');
var authentication = require('vox-common/authentication');
var Chain = require('vox-common/chain');
var CheckpointStream = require('./checkpoint-stream');
var clientdb = require('./clientdb');
var configs = require('./configs');
var ConnectionManager = require('vox-common/connection-manager');
var debug = require('debug')('vox:client');
var errors = require('vox-common/errors');
var events = require('events');
var HubClient = require('vox-common/hubclient').HubClient;
var MergeStream = require('./merge-stream');
var mkdirp = require('mkdirp');
var P = require('bluebird');
var path = require('path');
var StanzaFetcher = require('./stanza-fetcher');
var StanzaStream = require('./stanza-stream');
var ursa = require('ursa');
var util = require('util');
var voxurl = require('vox-common/voxurl');


var PROTOCOL_VERSION = '0.0.1';


/**
 * An easy(?)-to-use client class for interacting with Postvox interchange
 * servers.  Supports the basic operations: following and unfollowing, receiving
 * stanzas, posting stanzas.
 *
 * @param {String} options.nick The nickname to connect as.  Defaults to --nick.
 * @param {String} [options.profilesDir] If set, then read profile configs and
 *     store the local databases in this directory.  Defaults to --profilesDir.
 * @param {String} [options.db] If set, then use this database handler instead
 *     of opening the database in `options.profilesDir`.
 * @param {String} [options.config] If set, then use this config instead of
 *     reading it from disk in `options.profilesDir`.
 * @param {String} [options.config.nick] The nickname to connect as.  Required
 *     if `config` is given.
 * @param {String} [options.config.privkey] The user's private key in RSA PEM
 *     format.  Required if `config` is given.
 * @param {String} [options.config.interchangeUrl] The URL to the user's
 *     home interchange server.  Required if `config` is given.
 * @param {String} [options.hubUrl] The Hub url to use.  Defaults to
 *     http://hub.postvox.net.
 * @param {String} [options.agentString] The agent string to send to servers.
 *     Defaults to 'voxbot :)'.
 * @param {HubClient} [options.hubClient] The HubClient to use.  If not set,
 *     uses the default HubClient.
 * @param {ConnectionManager} [options.connectionManager] The connection manager
 *     to use.  If not set, uses the default ConnectionManager.
 */
var VoxClient = module.exports = function(options) {
  var self = this;

  events.EventEmitter.call(this);

  self.nick = nick = options.nick || argv.nick;
  if (!self.nick) {
    throw new Error('nick must be set!');
  }

  var profilesDir = options.profilesDir || argv.profilesDir;
  self.profileFilenames = VoxClient.prepareProfile(profilesDir, self.nick);

  if (options.config) {
    self.config = options.config;
  } else {
    self.config = configs.parse(self.profileFilenames.configFile);
  }

  if (self.config.privkey) {
    self.setPrivkey(self.config.privkey);
  }

  self.db = options.db || null;
  self.hubClient = options.hubClient;
  self.connectionManager = options.connectionManager;
  self.hubUrl = options.hubUrl || argv.hubUrl;
  self.agentString = options.agentString || 'voxbot :)';

  self._interchangeSessions = null; // Keyed by source nickname.
  self._stanzaFetcher = null;
  self._mergeStreams = null;
}
util.inherits(VoxClient, events.EventEmitter);


VoxClient.prototype.setPrivkey = function(privkey) {
  this.privkey = ursa.createPrivateKey(privkey);
}


/**
 * Initializes this client and connects to saved interchange routes.
 */
VoxClient.prototype.connect = function() {
  var self = this;
  if (self.db) {
    return self._connect(self.db);
  }
  debug('Opening local DB', self.profileFilenames);
  return clientdb.openDb(self.profileFilenames)
    .then(self._connect.bind(self));
}


VoxClient.prototype._connect = function(db) {
  var self = this;
  self.db = db;
  if (!self.hubClient) {
    self.hubClient = HubClient(self.hubUrl, db);
  }
  if (!self.connectionManager) {
    self.connectionManager = ConnectionManager(
        self.hubClient, PROTOCOL_VERSION, self.agentString);
  }
  self._mergeStreams = [];
  self._interchangeSessions = new Chain(self._openInterchangeSession.bind(self));
  self._stanzaFetcher = new StanzaFetcher(self.db, self.getInterchangeSession.bind(self));
  self._attachConnectionListeners();
  self._attachSessionListener();
  self._attachStanzaListener(self._stanzaFetcher);
  self._stanzaFetcher.attachListener(self.connectionManager, self.hubClient);
  return self.connectAllSubscriptions();
}

/**
 * Ensures that we have an open interchange connection to the given source, and
 * an active session.  If there is already a connection open or in the process
 * of opening, we reuse that connection.
 *
 * @return {Promise<InterchangeConnection>}
 */
VoxClient.prototype.getInterchangeSession = function(source) {
  var self = this;
  debug('Opening session for %s', source);
  return self.connectionManager.connect(source, self.nick)
    .then(function(conn) {
      return self._interchangeSessions.get(conn.interchangeUrl);
    });
}


VoxClient.prototype._openInterchangeSession = function(interchangeUrl) {
  var self = this;
  return self.connectionManager.connectByUrl(interchangeUrl)
    .then(function(conn) {
      if (conn.sessionId) {
        return conn;
      }
      return self.db.getInterchangeSessionId(interchangeUrl)
        .then(function(sessionId) {
          return conn.SESSION(sessionId);
        })
        .then(function(reply) {
          debug('Connected to %s', interchangeUrl);
          if (reply.newSessionId) {
            return self.db.setInterchangeSessionId({
                interchangeUrl: conn.interchangeUrl,
                sessionId: reply.newSessionId
            });
          }
        })
        .return(conn);
    });
}


/**
 * Ensures that we have an open connection to all saved subscriptions.
 */
VoxClient.prototype.connectAllSubscriptions = function() {
  var self = this;
  debug('Opening connections to all saved subscriptions');
  return self.db.listSubscriptions()
    .then(function(subscriptions) {
      return P.settle(subscriptions.map(function(subscription) {
        return self.getInterchangeSession(voxurl.toSource(subscription.url));
      }))
      .catch(function(err) {
        debug('Error', err, err.stack);
        self.emit('error', new VoxClientError('Error connecting to subscription', err));
      });
    })
}


VoxClient.prototype._attachConnectionListeners = function() {
  var self = this;
  self.connectionManager.on('connect', function(info) {
    self.emit('connect', info);
  });
  self.connectionManager.on('disconnect', function(info) {
    self.emit('disconnect', info);
  });
  self.connectionManager.on('error', function(info) {
    self.emit('error', new VoxClientError('Connection error', info));
  });
  self.connectionManager.on('reconnect', function(info) {
    self.emit('reconnect', info);
  });
  self.connectionManager.on('reconnect_failed', function(info) {
    self.emit('reconnect_failed', info);
  });
}


/**
 * Listens for new session IDs.  If an interchange has issued us a new session
 * ID, we attempt to restore any subscriptions we had previously established
 * with that interchange.
 */
VoxClient.prototype._attachSessionListener = function() {
  var self = this;
  self.connectionManager.on('SESSION', function(session) {
    if (!session.newSessionId) {
      return;
    }
    var sessionId = session.newSessionId;

    debug('Saving new sessionId: %s', sessionId);
    self.db.setInterchangeSessionId({
        interchangeUrl: session.interchangeUrl,
        sessionId: sessionId
    });

    // Since the server has assigned us a new session ID, we need to
    // reestablish the subscriptions we had previously set up during a different
    // session.  Ideally, servers won't reassign new session IDs very often,
    // so this should mostly be called for new connections with no previous
    // subscriptions.

    // TODO This is a little iffy.  If the session bounces while we are
    // reestablishing the subscriptions, then things might go sideways.

    self.db.listSubscriptionsByInterchangeUrl(session.interchangeUrl)
      .then(function(subscriptions) {
        debug('Reestablishing %d subscriptions to %s', subscriptions.length, session.interchangeUrl);
        return P.all(subscriptions.map(function(subscription) {
          if (subscription.sessionId == sessionId) {
            return;
          }
          return self.subscribe(subscription.url);
        }));
      })
      .catch(function(err) {
        self.emit('error', new VoxClientError(
            util.format('Error reestablishing subscriptions to %s', session.interchangeUrl), err));
      });
  })
}


VoxClient.prototype._attachStanzaListener = function(emitter) {
  var self = this;
  emitter.on('STANZA', function(stanza) {
    self.emit('STANZA', stanza);
    if (stanza.type != 'USER_PROFILE') {
      return;
    }
    // TODO Ensure that this is the newest USER_PROFILE for the user
    // before changing the location.
    self._updateUserInterchangeLocation(stanza);
  })
}


/**
 * If a user we are following has switched their interchangeUrl, then we need to
 * connect to that new server and re- establish any subscriptions we had for the
 * old server.
 */
VoxClient.prototype._updateUserInterchangeLocation = function(userProfile) {
  var self = this;
  return self.db.saveUserProfile(userProfile)
    .then(function() {
    var newInterchangeUrl = userProfile.interchangeUrl;
    return self.db.listSubscriptionsBySource(userProfile.nick)
      .then(function(subscriptions) {
        debug('Checking %d subscriptions for user %s to %s', subscriptions.length, userProfile.nick, newInterchangeUrl)
        return P.all(subscriptions.map(function(subscription) {
          if (subscription.interchangeUrl == newInterchangeUrl) {
            return;
          }
          return self.subscribe(subscription.url);
        }));
      });
    })
    .catch(function(err) {
      self.emit('error', new VoxClientError(
          util.format('Error handling a USER_PROFILE stanza for %s', userProfile.nick), err));
    })
}


VoxClient.prototype.fetchStanzas = function(url, seqStart, limit) {
  return this._stanzaFetcher.fetchStanzas(url, seqStart, limit);
}


VoxClient.prototype.getHighWaterMark = function(url) {
  return this._stanzaFetcher.getHighWaterMark(url);
}


VoxClient.prototype.queueWithHighWaterMark = function(url, fn) {
  return this._stanzaFetcher.queueWithHighWaterMark(url, fn);
}


/**
 * Subscribes to stanzas published to a given stream.
 *
 * @param stream {String} The stream to subscribe to.  Can be a full vox URL
 *     (e.g., "vox:spacemaus/friends"), the abbreviated version (e.g.,
 *     "spacemaus/friends"), or the text version ("@spacemaus/friends").
 */
VoxClient.prototype.subscribe = function(stream) {
  var self = this;
  var source = voxurl.toSource(stream);
  var url = voxurl.toCanonicalUrl(stream);
  return self.getInterchangeSession(source)
    .then(function(conn) {
      return conn.SUBSCRIBE(url, {
          sessionId: conn.sessionId,
          updatedAt: Date.now()
      })
      .then(function() {
        return self.db.saveSubscription({
            url: url,
            sessionId: conn.sessionId,
            interchangeUrl: conn.interchangeUrl,
            source: source
        })
        .then(function(subscription) {
          self._addToMergeStreams(stream);
          return subscription;
        })
      })
    })
}


/**
 * Unsubscribes from stanzas published to a given stream.
 */
VoxClient.prototype.unsubscribe = function(stream) {
  var self = this;
  var source = voxurl.toSource(stream);
  var url = voxurl.toCanonicalUrl(stream);
  return self.getInterchangeSession(source)
    .then(function(conn) {
      return conn.UNSUBSCRIBE(url, {
          sessionId: conn.sessionId,
          updatedAt: Date.now()
      })
      .then(function() {
        return self.db.deleteSubscription(url);
      })
      .then(function() {
        self._removeFromMergeStreams(stream);
      })
    })
}


VoxClient.prototype.listSubscriptions = function() {
  return this.db.listSubscriptions();
}


/**
 * Posts a MESSAGE to a stream.
 *
 * The message will be published to:
 *
 * - The user's stream.
 * - The streams of any users @mentioned in `text` if `options.cloneToMentions`
 *   is true.
 * - The streams of the users in `options.cloneTo`.
 * - The stream of the `replyTo` URL, if present.
 * - The stream of the `thread` URL, if present.
 *
 * @param {Object} message The message to post.
 * @param {String} [message.stream] The stream to post the message to.  Defaults
 *     to the user's public stream.  The format is "<nickname>[/<stream-name>]".
 *     If `<stream-name>` is omitted, it means the user's public stream.
 * @param {String} [message.text] The text of the message.
 * @param {String} [message.title] A title for the message, like an email
 *     subject or newspost title.
 * @param {String} [message.userUrl] A URL to publish with the message.
 * @param {Object} [message.etc] Miscellaneous payload.  Will be JSON encoded, if present.
 * @param {String} [message.thread] The message URL of the first message in a thread.
 * @param {String} [message.replyTo] The message URL of the message to reply to.
 *
 * @param {Object} options Optional options.
 * @param {bool} [options.cloneToMentions] If true, the message will be cloned
 *     to the servers of any nicknames that were "@mentioned" in the message's
 *     text.  Defaults to true.
 * @param {String[]} [options.cloneTo] The nicknames to clone the message to.
 *     The message will be cloned to their interchange servers.
 * @return {Promise<Object>} The posted message.
 */
VoxClient.prototype.post = function(message, options) {
  var self = this;
  if (!message.stream) {
    message.stream = self.nick;
  }
  var source = voxurl.toSource(message.stream)
  var url = voxurl.toCanonicalUrl(message.stream);
  message.updatedAt = message.updatedAt || Date.now();
  return self.connectionManager.connect(source, self.nick)
    .then(function(conn) {
      var stanza = {
          type: 'MESSAGE',
          nick: self.nick,
          stream: message.stream || self.nick,
          text: message.text,
          title: message.title,
          userUrl: message.userUrl,
          thread: message.thread,
          replyTo: message.replyTo,
          etc: message.etc,
          updatedAt: message.updatedAt
      };
      debug('Sending', stanza);
      authentication.signStanza(stanza, self.privkey);
      return conn.POST(url, { stanza: stanza })
        .then(function(reply) {
          stanza = reply.stanza;
          var targets = [];
          if (!(options && options.cloneToMentions === false)) {
            targets.push.apply(targets, getAtMentions(stanza.text));
          }
          if (options && options.cloneTo) {
            targets.push.apply(targets, options.cloneTo);
          }
          if (stanza.replyTo) {
            targets.push(voxurl.toStream(stanza.replyTo));
          }
          if (stanza.thread) {
            targets.push(voxurl.toStream(stanza.thread));
          }
          if (!targets.length) {
            return stanza;
          }
          var messageUrl = voxurl.getStanzaUrl(stanza);
          targets = _.uniq(targets);
          return P.settle(targets.map(function(target) {
            if (target == stanza.stream) {
              return;
            }
            return self.connectionManager.connect(voxurl.toSource(target), nick)
              .then(function(conn) {
                var clone = JSON.parse(JSON.stringify(stanza));
                clone.stream = target;
                clone.clone = messageUrl;
                delete clone.sig;
                authentication.signStanza(clone, self.privkey);
                return conn.POST(voxurl.toCanonicalUrl(target), { stanza: clone });
              })
              .catch(function(err) {
                debug('Error', err, err.stack);
                // TODO
              });
          }))
          .return(stanza);
        })
    });
}


/**
 * Posts a VOTE to a stream.
 *
 * @param {Object} stanza The stanza to post.
 */
VoxClient.prototype.postVote = function(stanza) {
  var self = this;
  var source = voxurl.toSource(stanza.stream);
  var url = voxurl.toCanonicalUrl(stanza.stream);
  stanza.updatedAt = stanza.updatedAt || Date.now();
  stanza.type = 'VOTE';
  authentication.signStanza(stanza, self.privkey);
  return self.getInterchangeSession(source)
    .then(function(conn) {
      return conn.POST(url, { stanza: stanza })
    })
    .return(stanza);
}


/**
 * Posts a USER_STATUS to a stream.
 *
 * @param {Object} stanza The stanza to post.
 */
VoxClient.prototype.postUserStatus = function(stanza) {
  var self = this;
  stanza.type = 'USER_STATUS';
  stanza.updatedAt = stanza.updatedAt || Date.now();
  var url = voxurl.toCanonicalUrl(stanza.stream);
  authentication.signStanza(stanza, self.privkey);
  var source = voxurl.toSource(stanza.stream);
  return self.getInterchangeSession(source)
    .then(function(conn) {
      return conn.POST(url, { stanza: stanza })
    })
    .return(stanza);
}


/**
 * Registers or updates the user's profile with the Hub, then posts it to the
 * user's public stream.
 *
 * If the profile updates the user's interchangeUrl, then the profile is posted
 * to both the old and new servers.
 *
 * If the profile updates the user's private key, then the new key must be given
 * in `privkey`.
 *
 * @param {Object} stanza The stanza to post.
 * @param {String} [privkey] If the user's privkey is changing, you must specify
 *     it here.  All future stanzas sent via this client will be signed with
 *     this new key.
 */
VoxClient.prototype.postUserProfile = function(stanza, privkey) {
  var self = this;
  stanza.type = 'USER_PROFILE';
  stanza.updatedAt = stanza.updatedAt || Date.now();
  stanza.stream = stanza.nick;
  return self.hubClient.getUserProfileFromHub(stanza.nick)
    .then(function(userProfile) {
      return userProfile.interchangeUrl;
    }, function(err) {
      return null;
    })
    .then(function(oldInterchangeUrl) {
      // We sign the stanza with the existing key.
      var oldKey = self.privkey || privkey;
      self.privkey = privkey || self.privkey;
      return self.hubClient.registerUserProfile(stanza, oldKey)
        .then(function(userProfile) {
          var url = voxurl.toCanonicalUrl(userProfile.nick);
          function sendUserProfile(interchangeUrl) {
            return self.connectionManager.connectByUrl(interchangeUrl)
              .then(function(conn) {
                return conn.POST(url, { stanza: userProfile });
              });
          }
          // TODO self._updateUserInterchangeLocation(userProfile);
          if (oldInterchangeUrl) {
            return P.join(
                sendUserProfile(userProfile.interchangeUrl),
                sendUserProfile(oldInterchangeUrl));
          } else {
            return sendUserProfile(userProfile.interchangeUrl);
          }
        });
    });
}


/**
 * Creates a read stream for stanzas. Stanzas will be read in `seq` order.
 *
 * If you do not specify `options.stream`, then this method will return a stream
 * that aggregates the streams from all current subscriptions.
 *
 * A useful pattern:
 *
 *     var stanzas = vox.createReadStream({ checkpointKey: KEY });
 *     var checkpoints = vox.createCheckpointStream({ checkpointKey: KEY});
 *     stanzas.pipe(myConsumer).pipe(checkpoints);
 *
 * @param {Object} options
 * @param {String} [options.type] If given, only stanzas of this type will be
 *     read.  One of 'MESSAGE', 'USER_STATUS', 'USER_PROFILE', 'VOTE'.
 * @param {String} [options.stream] If given, only stanzas posted to this stream
 *     will be read.
 * @param {int} [options.seqStart] If given, the stream will start reading from
 *     the stanza with this `seq` value.  If this value is not specified, then
 *     the stream will start reading from the current time (i.e., the messages
 *     pushed from the server after the stream is created).
 * @param {int} [options.seqLimit] If given, the stream will stop reading just
 *     before the stanza with this `seq` value.
 * @param {String} [options.checkpointKey] A key to used to load stream
 *     checkpoints.  Overrides `seqStart`, if the checkpoint is in the database.
 * @param {bool} [options.batchMode] If true, then the stream will return arrays
 *     of stanzas.  If false, the stream will return single stanzas.
 * @param {int} [options.batchSize] The target size of batches to fetch from the
 *     database/network.
 */
VoxClient.prototype.createReadStream = function(options) {
  var self = this;
  options = options || {};
  debug('Creating read stream for: ', options);
  if (options.stream) {
    options.stream = voxurl.toStream(options.stream);
    return self._createReadStream(options);
  }
  options.pushMetaStanzas = true;
  var aggregate = new MergeStream(options);
  self._mergeStreams.push(aggregate);
  self.db.listSubscriptions()
    .then(function(subscriptions) {
      subscriptions.forEach(function(subscription) {
        options.stream = voxurl.toStream(subscription.url)
        aggregate.add(self._createReadStream(options));
      })
    });
  aggregate.once('end', self._removeMergeStream.bind(self, aggregate));
  return aggregate;
}


VoxClient.prototype._createReadStream = function(options) {
  return new StanzaStream(this, options);
}


VoxClient.prototype._removeMergeStream = function(mergeStream) {
  var i = this._mergeStreams.indexOf(mergeStream);
  if (i == -1) {
    return;
  }
  this._mergeStreams.splice(i, 1);
}


VoxClient.prototype._addToMergeStreams = function(stream) {
  var self = this;
  self._mergeStreams.forEach(function(mergeStream) {
    var options = mergeStream.options;
    options.stream = stream;
    mergeStream.add(self._createReadStream(options));
  });
}


VoxClient.prototype._removeFromMergeStreams = function(stream) {
  this._mergeStreams.forEach(function(mergeStream) {
    mergeStream.remove(stream);
  });
}


/**
 * Creates a Transform stream that writes checkpoints for the stanzas that pass
 * through it.
 *
 * @param {Object} options Required options.
 * @param {String} options.checkpointKey Required. A key to use to write stream
 *     checkpoints.
 */
VoxClient.prototype.createCheckpointStream = function(options) {
  return new CheckpointStream(this, options);
}


VoxClient.prototype.close = function() {
  this.emit('close');

  if (this.connectionManager) {
    this.connectionManager.close();
  }

  if (this.db) {
    this.db.close();
  }

  if (this._stanzaFetcher) {
    this._stanzaFetcher.close();
  }

  // TODO Cancel pending operations:
  this._interchangeSessions = null;
  this._stanzaFetcher = null;
  this.db = null;
  this.hubClient = null;
  this.connectionManager = null;
}


/**
 * Prepares the on-disk representation for the given nick
 */
VoxClient.prepareProfile = function(profilesDir, nick) {
  var filenames = {};
  filenames.profileDir = prepareProfileDir(profilesDir, nick);
  filenames.configFile = path.join(filenames.profileDir, 'config.json');
  filenames.dbFile = path.join(filenames.profileDir, 'metadata.db');
  filenames.streamDbDir = path.join(filenames.profileDir, 'streams.leveldb');
  return filenames;
}


/**
 * Ensures that profilesDir exists and formats an appropriate name for the
 * profile directory.
 *
 * @return {String} DB file path.
 */
function prepareProfileDir(profilesDir, nick) {
  var nick = nick || '.tmp';
  // Just in case `nick` has any funny business...
  nick = nick.replace(/[^\w\d.]/g, '-').replace('..', '-');
  var profileDir = path.join(profilesDir, util.format('vox-%s', nick));
  debug('Ensuring directory at %s', profileDir);
  mkdirp.sync(profileDir, 0700);
  return profileDir;
}


function getAtMentions(text) {
  return (text.match(/@(\w+)/g) || []).map(function(t) { return t.substr(1) });
}



function VoxClientError(message, cause) {
  this.message = message;
  this.cause = cause;
}
util.inherits(VoxClientError, Error);
module.exports.VoxClientError = VoxClientError;
