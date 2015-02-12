/**
 * In-memory version of a Hub.
 */

var authentication = require('../authentication');
var bodyParser = require('body-parser');
var express = require('express');
var P = require('bluebird');
var ursa = require('ursa');


var fakeKey = ursa.generatePrivateKey()


exports.FakeHub = function() {
  var app = express();
  app.use(bodyParser.json());

  var profiles = {};

  app.route('/profiles/:nick')
  .get(function(req, res) {
    var profile = profiles[req.params.nick];
    if (!profile) {
      res.sendStatus(404);
      return;
    }
    res.json({ userProfile: JSON.parse(JSON.stringify(profile)) });
  })
  .post(function(req, res) {
    var userProfile = JSON.parse(JSON.stringify(req.body));
    userProfile.hubCreatedAt = Date.now();
    userProfile.hubSyncedAt = userProfile.hubCreatedAt;
    var data = new Buffer(
        encodeField(userProfile.about) +
        encodeField(userProfile.hubCreatedAt) +
        encodeField(userProfile.hubSyncedAt) +
        encodeField(userProfile.interchangeUrl) +
        encodeField(userProfile.nick) +
        encodeField(userProfile.op) +
        encodeField(userProfile.opSeq) +
        encodeField(userProfile.pubkey) +
        encodeField(userProfile.sig) +
        encodeField(userProfile.stream) +
        encodeField(userProfile.type) +
        encodeField(userProfile.updatedAt));
    userProfile.hubSig = fakeKey.hashAndSign('sha1', data, 'utf8', 'base64');
    profiles[userProfile.nick] = userProfile;
    res.json({ userProfile: JSON.parse(JSON.stringify(userProfile)) });
  });

  return new P(function(resolve, reject) {
    var appServer = app.listen(0, function() {
      appServer.__clearProfiles__ = function() {
        profiles = {};
      }
      resolve(appServer);
    });
  })
}


exports.stubHubPublicKey = function() {
  authentication._setHubPublicKey(ursa.createPublicKey(fakeKey.toPublicPem('utf8')));
}


function encodeField(v) {
  if (v === null || v === undefined) {
    return '\x00';
  }
  return v + '\x00';
}
