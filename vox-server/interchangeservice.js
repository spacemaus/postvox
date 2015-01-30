var debug = require('debug')('vox:interchangeservice');
var eyes = require('vox-common/eyes')
var hubclient = require('vox-common/hubclient');
var interchangesockets = require('./interchangesockets');
var interchangeweb = require('./interchangeweb');
var P = require('bluebird');


/**
 * Creates a new InterchangeService.
 *
 * @param {InterchangeDb} db The database stub.
 * @param {HubClient} hubClient A Hub client.
 * @param {Router} commandRouter The interchange commands to serve.
 *
 * @returns {InterchangeService}
 */
exports.InterchangeService = function(db, hubClient, commandRouter) {
  var self = {};

  self.db = db;
  self.hubClient = hubClient;
  self.commandRouter = commandRouter;

  var sessionSockets = {};

  /**
   * Begins listening for connections on sockets and HTTP.
   */
  self.Listen = function(app, appServer) {
    var sockets = interchangesockets.Listen(appServer, self);
    interchangeweb.Listen(app, self, sockets);
  }

  /**
   * Associates the given sessionId with an open socket.
   */
  self.SetSessionSocket = function(sessionId, socket) {
    sessionSockets[sessionId] = socket;
  }

  /**
   * Clears the association set by `SetSessionSocket()`.
   */
  self.ClearSessionSocket = function(sessionId, socket) {
    if (sessionSockets[sessionId] == socket) {
      delete sessionSockets[sessionId];
    }
  }

  /**
   * Pushes a message to connected interchange clients who are following the
   * given targets.
   */
  self.TargetCast = function(targetUrls, eventName, data) {
    debug('cast to %s %s %s', targetUrls, eventName, data);
    var markToSocketLatency = eyes.start('targetcast.' + eventName + '.tosocket_latency');
    var sent = {}; // Session IDs that have already received this message.
    var p =[];
    for (var i = 0; i < targetUrls.length; i++) {
      var url = targetUrls[i];
      sendToRoute(url, eventName, data, sent, markToSocketLatency)
        .catch(function(err) {
          console.error('Error in TargetCast', err, err.stack);
          eyes.mark('targetcast.error');
        })
    }
  }

  function sendToRoute(url, eventName, data, sent, markToSocketLatency) {
    var sentCount = 0;
    return db.ForTargetSessionIds(url,
      function(sessionId) {
        var socket = sessionSockets[sessionId];
        if (!socket) {
          debug('removing disconnected session', sessionId);
          // TODO We can be lazier about this:
          db.UncacheTargetSessionId(url, sessionId);
          eyes.mark('targetcast.disconnected_session');
        } else if (!(sessionId in sent)) {
          sent[sessionId] = true;
          socket.emit(eventName, data);
          sentCount++;
          markToSocketLatency();
        }
      })
  }

  return self;
}
