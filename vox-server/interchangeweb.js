/**
 * Attaches the handlers in serverhandlers.js to the HTTP server. Sibling to
 * interchangesockets.js.
 */

var debug = require('debug')('vox:interchangeweb');
var urlparse = require('url');


/**
 * Registers interchange web request handlers on the given app.
 */
exports.Listen = function(app, service, sockets) {
  debug('Listening for HTTP requests');

  // Prepares the request to be handed off to the interchange routes.
  app.use(function(req, res, next) {
    req.context = {
        db: service.db,
        TargetCast: service.TargetCast,
        SetSessionId: function(sessionId) {
          req.context.sessionId = sessionId;
        },
        UnsetSessionId: function() {
          req.context.sessionId = null;
        }
    };
    if (req.params.sessionId) {
      req.context.sessionId = req.params.sessionId;
    }
    req.voxSource = req.query.source;
    if (!req.voxSource) {
      next({ statusCode: 400, message: 'Missing ?source query param.' });
      return;
    }
    var url = urlparse.parse(req.url);
    url.hostname = req.voxSource;
    url.host = url.port = null;
    url.protocol = 'vox:';
    url.slashes = true;
    req.url = urlparse.format(url);

    if (req.method == 'GET') {
      req.payload = req.query;
    } else if (req.method == 'POST') {
      req.payload = req.body;
    }
    next();
  });

  app.use(function(err, req, res, next) {
    console.error('error', err.statusCode);
    var statusCode = err.statusCode ? err.statusCode : 500;
    if (statusCode < 400 || statusCode > 499) {
      console.error('Server error', err.stack);
    }
    res.sendStatus(statusCode);
    next(err);
  });

  app.use(service.commandRouter);
}
