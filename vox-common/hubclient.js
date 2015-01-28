var authentication = require('./authentication');
var debug = require('debug')('vox:hubclient');
var errors = require('./errors');
var eyes = require('./eyes');
var HttpStub = require('./httpstub');
var lruCache = require('lru-cache');
var P = require('bluebird');
var urlparse = require('url');
var ursa = require('ursa')


var MAX_USER_PROFILE_CACHE_MS = 30 * 60 * 60000; // 30 minutes


/**
 * A client interface for the Hub.  Caches user profile information in the local
 * db.
 *
 * @param {URL} hubUrl The URL of the Hub.  Can be any server that implements
 *     the Hub protocol, though its encryption key must match that
 *     authentication.js.
 * @param {Object} db A DB stub.
 * @param {function(String, Number?)} db.GetUserProfile
 * @param {function(Object)} db.SetUserProfile
 */
exports.HubClient = function(hubUrl, db) {
  debug('Using Hub at', urlparse.format(hubUrl));

  var httpStub = HttpStub(hubUrl);

  var userProfileCache = lruCache({
      max: 1000,
      maxAge: MAX_USER_PROFILE_CACHE_MS
  });

  /**
   * Caches the UserProfile, but only if it is newer than the existing cached
   * version.
   */
  function setUserProfileInCache(userProfile) {
    var old = userProfileCache.peek(userProfile.nick);
    if (old && old.updatedAt > userProfile.updatedAt) {
      return;
    }
    userProfileCache.set(userProfile.nick, userProfile);
  }

  var self = {};

  /**
   * Takes a UserProfile object and sends it to the Hub.
   *
   * @param {UserProfile} The profile to register at the hub.
   * @param {String} privkey The private key to use to sign the profile.  Note:
   *     if the UserProfile contains a NEW pubkey, then this private key must
   *     correspond to the OLD pubkey that the Hub already knows about.
   *     Otherwise the Hub will reject the update.
   * @return {Promise<UserProfile>} the registered profile.
   */
  self.RegisterUserProfile = function(userProfile, privkey) {
    debug('Registering ' + userProfile.nick + ' with home ' + userProfile.interchangeUrl +
        ' with the Hub at (' + urlparse.format(hubUrl) + ')...');

    if (!userProfile.updatedAt) {
      userProfile.updatedAt = new Date().getTime();
    }

    authentication.SignUserProfileStanza(userProfile,
        ursa.createPrivateKey(privkey, undefined, 'utf8'));

    debug('Sending userProfile to the Hub', userProfile);
    return httpStub.serverPost('/profiles/' + userProfile.nick, userProfile)
      .then(function(reply) {
        var userProfile = reply.userProfile;
        authentication.ValidateHubSignature(userProfile);
        setUserProfileInCache(userProfile);
        return db.SetUserProfile(userProfile);
      });
  }

  /**
   * Fetches a user profile from the Hub.  First checks the local cache.
   *
   * @param {String} nick The nickname of the user to fetch.
   * @param {Number?} opt_updatedBefore If set, then fetch the latest version of
   *     the profile that was updated before this timestamp.
   *
   * @return {Promise<UserProfile>}
   */
  self.GetUserProfile = function(nick, opt_updatedBefore) {
    // Fetch from local cache.
    var userProfile = userProfileCache.get(nick);
    if (userProfile && (!opt_updatedBefore || opt_updatedBefore > userProfile.updatedAt)) {
      return P.resolve(userProfile);
    }
    var stop = eyes.start('hubclient.GetUserProfile.uncached');
    return db.GetUserProfile(nick, opt_updatedBefore)
      .then(function(userProfile) {
        // TODO expire cache.
        if (userProfile) {
          if (opt_updatedBefore || (new Date().getTime() - userProfile.syncedAt) < MAX_USER_PROFILE_CACHE_MS) {
            return userProfile;
          }
        }
        // Not found locally: fetch info from Hub.
        return self.GetUserProfileFromHub(nick, opt_updatedBefore);
      })
      .then(function(userProfile) {
        setUserProfileInCache(userProfile);
        return userProfile;
      })
      .finally(stop);
  }

  /**
   * Fetches a user profile from the Hub.
   *
   * @param {String} nick The nickname of the user to fetch.
   * @param {Number?} opt_updatedBefore If set, then fetch the latest version of
   *     the profile that was updated before this timestamp.
   *
   * @return {Promise<UserProfile>}
   */
  self.GetUserProfileFromHub = function(nick, opt_updatedBefore) {
    var stop = eyes.start('hubclient.GetUserProfileFromHub');
    var url = '/profiles/' + encodeURIComponent(nick);
    if (opt_updatedBefore) {
      url += '?updatedBefore=' + opt_updatedBefore;
    }
    return httpStub.serverGet(url)
      .then(function(reply) {
        var userProfile = reply.userProfile;
        if (!userProfile || nick != userProfile.nick) {
          throw new errors.ServerError('Got bad reply from Hub');
        }
        return authentication.CheckUserProfileStanza(self, userProfile)
          .then(function() {
            return db.SetUserProfile({
                nick: userProfile.nick,
                interchangeUrl: userProfile.interchangeUrl,
                pubkey: userProfile.pubkey,
                about: userProfile.about,
                createdAt: userProfile.createdAt,
                updatedAt: userProfile.updatedAt,
                sig: userProfile.sig,
                hubSig: userProfile.hubSig,
                hubSyncedAt: userProfile.hubSyncedAt,
            });
          })
          .then(function(userProfile) {
            setUserProfileInCache(userProfile);
            return userProfile;
          });
      })
      .finally(stop);
  }

  return self;
}
