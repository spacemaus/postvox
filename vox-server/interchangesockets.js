/**
 * Handles incoming socket connections. Sibling to interchangeweb.js.
 */

var debug = require('debug')('vox:interchangesockets');
var errors = require('vox-common/errors');
var eyes = require('vox-common/eyes')
var P = require('bluebird');
var socketIo = require('socket.io');


/**
 * Starts listening for client socket connections on the given appServer.
 *
 * service (InterchangeService): The service instance.
 * appServer (Express app server): The appServer to attach the sockets to.
 */
exports.listen = function(appServer, service) {
  debug('Listening for connections');
  var io = socketIo(appServer);
  io.sockets.on('connection', _handleConnection.bind(null, service));
  return io.sockets;
}


/**
 * Handles communication with an interchange client over a socket.
 *
 * Routes socket messages to the service's commandRouter.
 */
function _handleConnection(service, socket) {
  debug('New socket %s from %s', socket.id, socket.conn.remoteAddress);

  var remoteAddress = socket.conn.remoteAddress;

  eyes.inc('sockets.open');

  var context = {};

  context.db = service.db;
  context.hubClient = service.hubClient;

  context.setSessionId = function(sessionId) {
    context.sessionId = sessionId;
    service.setSessionSocket(sessionId, socket);
  }

  context.unsetSessionId = function() {
    if (!context.sessionId) {
      return;
    }
    service.clearSessionSocket(context.sessionId, socket);
    context.sessionId = null;
  }

  /**
   * Pushes a message to connected interchange clients who are following the
   * given targets.
   */
  context.targetCast = service.targetCast;

  /**
   * Handles the VOX command.  A VOX command wraps a URL, HTTP method, and JSON
   * data payload, and it expects a JSON response.
   *
   * @param method {String} The command's HTTP-like method.  E.g. "POST".
   * @param data.url {String} The URL of the command.  E.g.,
   *     "vox://<source>/threads/<threadId>".
   * @param data.payload {Object} The command's JSON payload.
   */
  function handleSocketMessage(method, data, replyFn) {
    debug('%s %s %s', socket.id, method, data.url, data.payload);
    eyes.mark('sockets.' + method);
    var url = data.url;
    if (!url) {
      replyFn({ status: 400, message: 'No URL given in request!' });
      return;
    }
    if (url.indexOf('/') == -1) {
      url += '/';  // Ensure that the URL can be routed.
    }
    var req = {
        context: context,
        method: method,
        url: url,
        remoteAddress: remoteAddress,
        payload: data.payload
    };
    if (!req.payload) {
      req.payload = {};
    }
    var replied = false;
    var res = {
        json: function(reply) {
          replyFn(reply);
          replied = true;
          debug('%s reply %s %s', socket.id, method, data.url);
          eyes.mark('sockets.' + method + '.status.200');
        },
        sendStatus: function(statusCode, message) {
          replyFn({ status: statusCode, message: message });
          replied = true;
          debug('%s reply %s %s', socket.id, method, data.url, statusCode);
          eyes.mark('sockets.' + method + '.status.' + statusCode);
        }
    };
    service.commandRouter.handle(req, res, function(err) {
      if (err) {
        console.error('Error handling %s %s:', method, data.url, err, err.stack);
        if (!replied) {
          console.error('No reply sent for %s %s...sending 500 error.', method, data.url);
          res.sendStatus(500, 'Server error');
        }
      } else if (!replied) {
        debug('No route found for %s %s...sending 404', method, data.url);
        res.sendStatus(404, 'Not found: ' + data.url);
      }
    });
  }

  socket.on('GET', handleSocketMessage.bind(null, 'GET'));
  socket.on('POST', handleSocketMessage.bind(null, 'POST'));
  socket.on('SUBSCRIBE', handleSocketMessage.bind(null, 'SUBSCRIBE'));
  socket.on('UNSUBSCRIBE', handleSocketMessage.bind(null, 'UNSUBSCRIBE'));

  socket.on('disconnect', function(data) {
    debug('DISCONNECT %s', context.sessionId);
    eyes.dec('sockets.open');
    if (context.sessionId) {
      var now = Date.now();
      context.db.setSessionConnected({
          sessionId: context.sessionId,
          isConnected: false,
          lastSeenAt: now
      });
      // TODO Handle errors.
      context.unsetSessionId();
    }
  });
}


