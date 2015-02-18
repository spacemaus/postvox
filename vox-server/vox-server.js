/**
 * This is the startup script for a basic Postvox interchange server.
 *
 * An interchange server is a data-hosting server for one or more Postvox
 * streams, which are identified by a URL like "vox://<source>".  It's like a
 * network-accessible database of messages and user metadata.
 *
 * Start it like so:
 *
 *     $ npm run vox-server --port 9001
 *
 * Set the DEBUG environment variable to see debug logging:
 *
 *     $ DEBUG='vox:*' npm run vox-server --port 9001
 */

var argv = require('./argv');
var hubclient = require('vox-common/hubclient');
var interchangedb = require('./interchangedb');
var interchangeserver = require('./interchangeserver');
var mkdirp = require('mkdirp');
var path = require('path');


if (!argv.dbDir) {
  console.error('Must specify --dbDir');
  process.exit(1);
}

mkdirp.sync(argv.dbDir, 0700);


var dbConfig = {
    dbFile: path.join(argv.dbDir, 'metadata.db'),
    streamDbDir: path.join(argv.dbDir, 'messages.leveldb')
};


process.on('unhandledRejection', function(err, promise) {
  console.error('Unhandled error', err, err.stack);
  process.exit(1);
});


return interchangedb.openDb(dbConfig)
  .then(function(db) {
    var hubClient = hubclient.HubClient(argv.hubUrl, db);
    return interchangeserver.CreateInterchangeServer(
        argv.port,
        argv.metricsPort,
        hubClient,
        db);
  })
  .catch(function(err) {
    console.error('FATAL ERROR', err, err ? err.stack : '');
    process.exit(1);
  });
