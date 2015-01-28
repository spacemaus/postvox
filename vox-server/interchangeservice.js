var debug = require('debug')('vox:interchangeservice');
var eyes = require('vox-common/eyes')
var hubclient = require('vox-common/hubclient');
var interchangesockets = require('./interchangesockets');
var interchangeweb = require('./interchangeweb');
var P = require('bluebird');
var timers = require('timers');


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
    var toSocketLatency = eyes.start('targetcast.' + eventName + '.tosocket_latency');

    P.all(targetUrls.map(function(url) {
        return self.db.GetTargetSessionIds(url)
      }))
      .then(function(sessionIdLists) {
        var sent = {};
        for (var i = 0; i < sessionIdLists.length; i++) {
          var sessionIds = sessionIdLists[i];
          var url = targetUrls[i];

          debug('casting to %d sessions for %s', sessionIds.length, url);

          function SendTo(sessionId) {
            var socket = sessionSockets[sessionId];
            if (!socket) {
              debug('removing disconnected session', sessionId);
              db.UncacheTargetSessionId(url, sessionId);
              eyes.mark('targetcast.disconnected_session');
            } else if (!(sessionId in sent)) {
              sent[sessionId] = true;
              socket.emit(eventName, data);
              toSocketLatency();
            }
          }

          eyes.observe('targetcast.number_of_sessions', sessionIds.length);

          if (sessionIds.length > 10) {
            // If there are more than a few target sessions, then don't block IO
            // on sending.
            for (var j = 0; j < sessionIds.length; j++) {
              timers.setImmediate(SendTo, sessionIds[j]);
            }
          } else {
            for (var j = 0; j < sessionIds.length; j++) {
              SendTo(sessionIds[j]);
            }
          }
        }
      })
  }

  return self;
}
