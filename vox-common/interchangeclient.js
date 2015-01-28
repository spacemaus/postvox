var debug = require('debug')('vox:interchangeclient');
var errors = require('./errors');
var events = require('events');
var io = require('socket.io-client');
var P = require('bluebird');
var ReferenceTracker = require('./referencetracker').ReferenceTracker;


/**
 * Manages the client side of a pool of interchange connections.
 *
 * We require an open interchange connection with another server whenever a user
 * connected to _this_ server requests messages from a source that is hosted on
 * a _different_ server.
 *
 * This manager is smart enough to know when two separate sources (e.g.
 * "vox://foo" and "vox://bar") resolve to the same host (e.g.,
 * "http://example.com/vox").  In that case, it will reuse the same socket
 * connection.
 *
 * TODO: Webhook-based pushes for low-traffic peers.
 *
 * @param {HubClient} hubClient A HubClient instance.
 * @param {String} version The Postvox version string.
 * @param {String} agent The Postvox agent string.
 *
 * @emits InterchangeConnection#connect
 * @emits InterchangeConnection#disconnect
 * @emits InterchangeConnection#reconnect
 * @emits InterchangeConnection#reconnect_failed
 * @emits InterchangeConnection#error
 * @emits InterchangeConnection#SESSION
 * @emits InterchangeConnection#USER_PROFILE
 * @emits InterchangeConnection#USER_STATUS
 * @emits InterchangeConnection#SUBSCRIPTION
 * @emits InterchangeConnection#MESSAGE
 */
exports.ConnectionManager = function(hubClient, version, agent) {
  var self = new events.EventEmitter();

  self.connections = {};
  self.version = version;
  self.agent = agent;

  var sourceByNickTracker = ReferenceTracker();
  var interchangeBySourceTracker = ReferenceTracker();
  var sourceToInterchangeUrl = {}

  /**
   * Opens an interchange connection to the interchange server that hosts the
   * given source. If a connection is already open to the source's interchange,
   * then the existing connection is reused.
   *
   * To find the server's URL, we ask the Hub for the profile with the nickname
   * given by `source`.
   *
   * @param {String} source A user's nickname: the <source> part of a URL like
   *     "vox://<source>".
   * @param {String} nick The nickname of the user requesting the connection.
   *
   * @returns {Promise<InterchangeConnection>} an open InterchangeConnection.
   */
  self.Connect = function(source, nick) {
    debug('Connecting to source %s', source);
    return hubClient.GetUserProfile(source)
      .then(function(userProfile) {
        var interchangeUrl = userProfile.interchangeUrl;
        if (!interchangeUrl) {
          throw errors.NotFoundError(
              'Source ' + source + ' has no registered interchangeUrl');
        }
        sourceByNickTracker.Add(source, nick);
        interchangeBySourceTracker.Add(interchangeUrl, source);

        if (interchangeUrl != sourceToInterchangeUrl[source]) {
          // TODO Decrement references to the old interchangeUrl in
          // interchangeBySourceTracker.
          sourceToInterchangeUrl[source] = interchangeUrl;
        }

        return self.ConnectByUrl(interchangeUrl);
      });
  }

  /**
   * Connects directly to an interchange URL, bypassing the user profile lookup.
   * Reuses any existing connection.
   *
   * @oaram {String} interchangeUrl The URL of the interchange server to connect
   *     to.
   */
  self.ConnectByUrl = function(interchangeUrl) {
    var conn = self.connections[interchangeUrl];
    if (conn) {
      return conn;
    }

    conn = InterchangeConnection(self, interchangeUrl);
    self.connections[interchangeUrl] = conn;
    conn.Open();
    return conn;
  }

  self._RemoveConnection = function(connection) {
    if (self.connections[connection.interchangeUrl] == connection) {
      delete self.connections[connection.interchangeUrl];
    }
  }

  /**
   * Releases an interchange connection for a given nick.  If the interchange
   * has no remaining nicks relying on it, then the connection is closed.
   *
   * @param {String} source A user's nickname.
   * @param {String} nick The nickname of the user requesting the connection.
   */
  self.Release = function(source, nick) {
    if (!sourceByNickTracker.Remove(source, nick)) {
      return;
    }
    var interchangeUrl = sourceToInterchangeUrl[source];
    if (!interchangeBySourceTracker.Remove(interchangeUrl, source)) {
      return;
    }
    var conn = self.connections[source];
    conn.Close();
    delete self.connections[source];
  }

  return self;
}


/**
 * Manages the client side of a single interchange connection.
 */
function InterchangeConnection(connectionManager, interchangeUrl) {
  var self = {};

  var socket;

  self.interchangeUrl = interchangeUrl;
  self.connected = false;
  self.sessionId = undefined;
  self.serverVersion = 'unknown';
  self.serverAgent = 'unknown';

  var pendingCommands = [];

  /**
   * Opens a socket connection to the interchange server.
   */
  self.Open = function() {
    debug('Connecting to %s', interchangeUrl);

    socket = io.connect(interchangeUrl, {
        forceNew: true,
        transports: ['websocket']
    });

    ///////////////////
    // Socket Events //
    ///////////////////

    socket.on('connect', function() {
      debug('Connected to %s', interchangeUrl);
      self.connected = true;
      connectionManager.emit('connect', {
          interchangeUrl: interchangeUrl
      });
      NextCommand();
    });

    socket.on('error', function(err) {
      console.error('Connection error %s', interchangeUrl);
      connectionManager.emit('error', {
          interchangeUrl: interchangeUrl,
          error: err
      });
    });

    socket.on('reconnect', function() {
      debug('Reconnecting %s', interchangeUrl);
      // If our client has previously set the session, then reissue it on
      // reconnection.
      if (self.sessionId) {
        self.SESSION('_reconnect_', self.sessionId);
      }
      connectionManager.emit('reconnect', {
          interchangeUrl: interchangeUrl
      });
    });

    socket.on('disconnect', function() {
      debug('Disconnected %s', interchangeUrl);
      self.connected = false;
      connectionManager.emit('disconnect', {
          interchangeUrl: interchangeUrl
      });
    });

    socket.on('reconnect_failed', function() {
      debug('Reconnection failed %s', interchangeUrl);
      connectionManager.emit('reconnect_failed', {
          interchangeUrl: interchangeUrl
      });
    });

    ///////////////////////////////
    // Interchange Push Messages //
    ///////////////////////////////

    socket.on('USER_PROFILE', function(userProfile) {
      debug('USER_PROFILE', userProfile);
      connectionManager.emit('USER_PROFILE', userProfile);
    });

    socket.on('USER_STATUS', function(userStatus) {
      debug('USER_STATUS', userStatus);
      connectionManager.emit('USER_STATUS', userStatus);
    });

    socket.on('SUBSCRIPTION', function(subscription) {
      debug('SUBSCRIPTION', subscription);
      connectionManager.emit('SUBSCRIPTION', subscription);
    });

    socket.on('MESSAGE', function(message) {
      debug('MESSAGE', message);
      connectionManager.emit('MESSAGE', message);
    });

    return self;
  }

  //////////////////////////
  // Interchange Commands //
  //////////////////////////

  self.SESSION = function(source, sessionId) {
    self.sessionId = sessionId;
    var url = 'vox://' + source + (sessionId ? ('/session/' + sessionId) : '/session');
    return SendCommand('POST', url, {
          version: connectionManager.version,
          agent: connectionManager.agent,
       }, true)
      .then(function(reply) {
        var newSessionId = reply ? reply.newSessionId : 0;
        // If the server replies with a new session ID, then it has created a
        // new session for us.  Update our internal record.
        if (newSessionId) {
          self.sessionId = newSessionId;
        }
        reply = reply ? reply : {};
        reply.version = (reply.version ? reply.version : 'unknown').substr(0, 64);
        reply.agent = (reply.agent ? reply.agent : 'unknown').substr(0, 64);
        self.serverVersion = reply.version;
        self.serverAgent = reply.agent;
        reply.interchangeUrl = interchangeUrl;
        connectionManager.emit('SESSION', reply);
        NextCommand();
        return reply;
      });
  }

  self.POST = function(url, payload) {
    return SendCommand('POST', url, payload);
  }

  self.GET = function(url, payload) {
    return SendCommand('GET', url, payload);
  }

  self.Close = function() {
    socket.close();
    connectionManager._RemoveConnection(self);
  }

  /**
   * Helper function to send a command to the server.
   *
   * Returns a Promise for the server's response.  Rejects the Promise if the
   * reply's status is not 200.
   *
   * If this connection is not ready to receive commands, the command is queued
   * for later execution.
   */
  function SendCommand(method, url, payload, skipQueue) {
    if (!self.connected) {
      debug('Queueing %s %s', method, url);
      return new P(function(resolve, reject) {
        var p = P.method(function() {
          debug('Dequeueing %s %s', method, url);
          return _SendCommand(method, url, payload)
            .then(resolve)
            .catch(reject);
        });
        if (skipQueue) {
          pendingCommands.splice(0, 0, p);
        } else {
          pendingCommands.push(p);
        }
      });
    }
    return _SendCommand(method, url, payload);
  }

  function _SendCommand(method, url, payload) {
    return new P(function(resolve, reject) {
      var data = {
          method: method,
          url: url,
          payload: payload
      };
      debug('%s %s %s\n', interchangeUrl, method, url, data);
      socket.emit('VOX', data, function(reply) {
        debug('REPLY %s %s %s\n', interchangeUrl, method, url, reply);
        if (reply && reply.status && reply.status != 200) {
          reject(reply);
        } else {
          resolve(reply);
        }
      });
    });
  }

  /**
   * Executes the next command on the queue.
   */
  function NextCommand() {
    var fn = pendingCommands.shift();
    if (!fn) {
      return;
    }
    fn().then(NextCommand);
  }

  return self;
}
