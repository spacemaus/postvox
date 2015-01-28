/**
 * Provides a function to create an Interchange server.
 */

var bodyParser = require('body-parser');
var debug = require('debug')('vox:interchangeserver');
var express = require('express');
var eyes = require('vox-common/eyes');
var interchangeroutes = require('./interchangeroutes');
var interchangeservice = require('./interchangeservice');
var P = require('bluebird');
var url = require('url');


function FatalError(err) {
  console.error('FATAL ERROR'.red, err, err ? err.stack : '');
  process.exit(1);
}


/**
 * Creates a basic interchange server and returns a Promise for a context
 * object.
 *
 * @param {Number} port The port to serve on.
 * @param {Number} metricsPort The port to serve metrics reports on.
 * @param {HubClient} hubClien The Hub client to use.
 * @param {InterchangeDatabase} db A DB object.
 *
 * @returns {Promise<Object>}
 *   {Express app} app
 *   {Express appServer} appServer
 *   {String} serverUrl The URL the server is serving on.
 *   {InterchangeDb} db A handle to the DB.
 */
exports.CreateInterchangeServer = function(port, metricsPort, hubClient, db) {
  var app = express();
  app.use(bodyParser.json()); // for parsing application/json

  var context = {};
  context.app = app;
  context.appServer = null;
  context.serverUrl = null;
  context.db = db;
  context.hubClient = hubClient;
  context.identity = null;
  context.interchangeService = null;

  eyes.Init(metricsPort);

  return CreateExpressAppServer(app, port)
    .then(function(c) {
      context.appServer = c.appServer;
      context.serverUrl = c.serverUrl;
    })
    .then(function() {
      // Start the interchange service.
      context.interchangeService = interchangeservice.InterchangeService(
          context.db, context.hubClient, interchangeroutes.router);
      context.interchangeService.Listen(context.app, context.appServer);
      debug('Server online. Listening at:', context.appServer.address());
      return context;
    });
}


/**
 * Creates an Express app and begins listening on the configured address.
 *
 * @param {Function} app The express app.
 * @param {Number} port The port to listen on.
 *
 * @returns {Promise<Object>}
 *   app_server: The server listening to the given port.
 *   serverUrl: The url to report to clients.
 */
function CreateExpressAppServer(app, port) {
  return new P(function(resolve, reject) {
    var appServer = app.listen(port, function() {
      var addr = appServer.address();
      resolve({
          app: app,
          appServer: appServer,
          serverUrl: url.format({ protocol: 'http', hostname: addr.address, port: addr.port })
      });
    });
  });
}

