/**
 * In-memory version of a Hub.
 */

var authentication = require('vox-common/authentication');
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
        userProfile.about +
        userProfile.interchangeUrl +
        userProfile.nick +
        userProfile.pubkey +
        userProfile.updatedAt +
        userProfile.hubCreatedAt +
        userProfile.hubSyncedAt +
        userProfile.sig);
    userProfile.hubSig = fakeKey.hashAndSign('sha1', data, 'utf8', 'base64');
    profiles[userProfile.nick] = userProfile;
    res.json({ userProfile: JSON.parse(JSON.stringify(userProfile)) });
  });

  return new P(function(resolve, reject) {
    var appServer = app.listen(0, function() {
      appServer.__ClearProfiles__ = function() {
        profiles = {};
      }
      resolve(appServer);
    });
  })
}


exports.StubHubPublicKey = function() {
  authentication._SetHubPublicKey(ursa.createPublicKey(fakeKey.toPublicPem('utf8')));
}
