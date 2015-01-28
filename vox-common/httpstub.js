/**
 * Contains a low-level class for talking to the Hub and interchange servers via
 * HTTP.
 */

// TODO Use request module, or something higher-level.


var debug = require('debug')('vox:httpstub');
var http = require('http');
var P = require('bluebird');
var urlparse = require('url');


function ParseIfJson(resp, stuff) {
  try {
    // TODO JSON.parse blocks the main thread:
    return JSON.parse(stuff);
  } catch(e) {
    return stuff;
  }
}


/**
 * Creates and returns a HttpStub.
 *
 * This class is intented for use from service stubs, rather than directly.
 */
module.exports = exports = function(hubUrl) {
  var self = {};

  var parsedUrl = urlparse.parse(hubUrl);
  var hubHostname = parsedUrl.hostname;
  var hubPort = parsedUrl.port || 80;
  var hubPrefix = parsedUrl.pathname || '';
  if (hubPrefix == '/') {
    hubPrefix = '';
  }

  self.serverGet = function(path) {
    return new P(function(resolve, reject) {
      debug('Sending GET to %s', path);
      var req = http.get({
          host: hubHostname,
          port: hubPort,
          path: hubPrefix + path
      },
      function(resp) {
        var respData = '';
        resp
          .on('data', function(chunk) {
            respData += chunk;
          })
          .on('end', function() {
            debug('Got response %s', path, respData);
            respData = ParseIfJson(resp, respData);
            if (resp.statusCode == 200) {
              resolve(respData);
            } else {
              var err = new Error();
              reject({ statusCode: resp.statusCode, data: respData });
            }
          });
      });
      req.on('error', reject);
      req.end();
    });
  };

  self.serverPost = function(path, data) {
    if (typeof(data) != 'string') {
      data = JSON.stringify(data);
    }
    // TODO use buffers
    return new P(function(resolve, reject) {
      debug('Sending POST to %s with %d chars', path, data.length);
      var req = http.request({
          method: 'POST',
          host: hubHostname,
          port: hubPort,
          path: hubPrefix + path,
          headers: {
              'Content-Type': 'application/json',
              'Content-Length': data.length
          }
      },
      function(resp) {
        var respData = '';
        resp
          .on('data', function(chunk) {
            respData += chunk;
          })
          .on('end', function() {
            debug('Got response %s', path, respData);
            respData = ParseIfJson(resp, respData);
            if (resp.statusCode == 200) {
              resolve(respData);
            } else {
              reject({ statusCode: resp.statusCode, data: respData });
            }
          });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  };

  return self;
}
