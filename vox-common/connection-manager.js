var Chain = require('./chain');
var debug = require('debug')('vox:connection-manager');
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
 * @emits InterchangeConnection#STANZA
 */
var ConnectionManager = module.exports = function(hubClient, version, agent) {
  var self = new events.EventEmitter();

  self.connections = {};
  self.version = version;
  self.agent = agent;

  var sourceByNickTracker = ReferenceTracker();
  var interchangeBySourceTracker = ReferenceTracker();
  var sourceToInterchangeUrl = {}
  var interchangeChain = new Chain(_connectByUrl);

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
  self.connect = function(source, nick) {
    debug('Connecting to source %s', source);
    return hubClient.getUserProfile(source)
      .then(function(userProfile) {
        var interchangeUrl = userProfile.interchangeUrl;
        if (!interchangeUrl) {
          throw errors.NotFoundError(
              'Source ' + source + ' has no registered interchangeUrl');
        }
        sourceByNickTracker.add(source, nick);
        interchangeBySourceTracker.add(interchangeUrl, source);

        if (interchangeUrl != sourceToInterchangeUrl[source]) {
          // TODO Decrement references to the old interchangeUrl in
          // interchangeBySourceTracker.
          sourceToInterchangeUrl[source] = interchangeUrl;
        }

        return self.connectByUrl(interchangeUrl);
      });
  }

  /**
   * Connects directly to an interchange URL, bypassing the user profile lookup.
   * Reuses any existing connection.
   *
   * @oaram {String} interchangeUrl The URL of the interchange server to connect
   *     to.
   */
  self.connectByUrl = function(interchangeUrl) {
    return interchangeChain.get(interchangeUrl);
  }

  function _connectByUrl(interchangeUrl) {
    conn = InterchangeConnection(self, interchangeUrl);
    self.connections[interchangeUrl] = conn;
    conn._open();
    return conn;
  }

  self._removeConnection = function(connection) {
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
  self.release = function(source, nick) {
    if (!sourceByNickTracker.remove(source, nick)) {
      return;
    }
    var interchangeUrl = sourceToInterchangeUrl[source];
    if (!interchangeBySourceTracker.remove(interchangeUrl, source)) {
      return;
    }
    var conn = self.connections[source];
    conn.close();
    delete self.connections[source];
  }

  self.close = function() {
    Object.keys(self.connections).forEach(function(key) {
      if (!self.connections[key]) {
        return;
      }
      self.connections[key].close();
    })
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
  self._open = function() {
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
      _nextCommand();
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
        self.SESSION(self.sessionId);
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

    socket.on('STANZA', function(stanza) {
      debug('STANZA', stanza);
      connectionManager.emit('STANZA', stanza);
    });

    return self;
  }

  //////////////////////////
  // Interchange Commands //
  //////////////////////////

  self.SESSION = function(sessionId) {
    self.sessionId = sessionId;
    var url = 'vox:__session__' + (sessionId ? ('/session/' + sessionId) : '/session');
    return sendCommand('POST', url, {
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
        _nextCommand();
        return reply;
      });
  }

  self.GET = function(url, payload) {
    return sendCommand('GET', url, payload);
  }

  self.POST = function(url, payload) {
    return sendCommand('POST', url, payload);
  }

  self.SUBSCRIBE = function(url, payload) {
    return sendCommand('SUBSCRIBE', url, payload);
  }

  self.UNSUBSCRIBE = function(url, payload) {
    return sendCommand('UNSUBSCRIBE', url, payload);
  }

  self.close = function() {
    socket.close();
    connectionManager._removeConnection(self);
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
  function sendCommand(method, url, payload, skipQueue) {
    if (!self.connected) {
      debug('Queueing %s %s', method, url);
      return new P(function(resolve, reject) {
        var p = P.method(function() {
          debug('Dequeueing %s %s', method, url);
          return _sendCommand(method, url, payload)
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
    return _sendCommand(method, url, payload);
  }

  function _sendCommand(method, url, payload) {
    return new P(function(resolve, reject) {
      var data = {
          url: url,
          payload: payload
      };
      debug('REQUEST %s %s %s\n', interchangeUrl, method, url, data);
      socket.emit(method, data, function(reply) {
        debug('REPLY %s %s %s\n', interchangeUrl, method, url, reply);
        if (reply && reply.status && reply.status != 200) {
          reject(new errors.HttpError(reply.status, reply.message));
        } else {
          resolve(reply);
        }
      });
    });
  }

  /**
   * Executes the next command on the queue.
   */
  function _nextCommand() {
    var fn = pendingCommands.shift();
    if (!fn) {
      return;
    }
    fn().then(_nextCommand);
  }

  return self;
}
