var debug = require('debug')('vox:authentication');
var errors = require('./errors');
var P = require('bluebird');
var ursa = require('ursa');


// TODO Temporary key:
var HUB_PUBLIC_KEY = ursa.createPublicKey(
  '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAv/H+NuVxMS4IKpENcDFN\n4sjXDSrfb8uy7DtgzmMR9eyyZjFolwUrh+WKQvQqQRea8p5vF1lB7A2Q+JZm475g\neToZK/QLGBT3lnj1RjDiXFiCgeZXB9rbtnz46+f0FcSeKpbcWnJYBC4AszApWOAH\nKylq/vItedB/GPpND/DzEh4SmOyazyIlg2faWuTqhCAztL/WFieoEfWk8kaC86Li\nyC0AWFT4rWM4JcAP2KTp5B7hvCc3AvU+15zDC8hNi0oj+o1kjTDb8dxJhXrx5XCV\n8OUzLxGyr24+Xq6tuZ4jOP6jZ2vXiJ1vkkx+ZfcYefIddWRp9dCLPslMjVckutvS\nPQIDAQAB\n-----END PUBLIC KEY-----\n')


exports._SetHubPublicKey = function(pubkey) {
  HUB_PUBLIC_KEY = pubkey;
}


var MESSAGE_FIELDS = [
  'author',
  'clone',
  'deletedAt',
  'etc',
  'replyTo',
  'source',
  'text',
  'thread',
  'title',
  'updatedAt',
  'userUrl',
];

exports.CheckMessageStanza = function(hubClient, message) {
  return CheckStanza(hubClient, message, MESSAGE_FIELDS, message.author);
}

exports.SignMessageStanza = function(message, privkey) {
  return SignStanza(message, MESSAGE_FIELDS, privkey);
}


var SUBSCRIPTION_FIELDS = [
    'nick',
    'subscriptionUrl',
    'updatedAt',
    'weight',
];

exports.CheckSubscriptionStanza = function(hubClient, subscription) {
  return CheckStanza(hubClient, subscription, SUBSCRIPTION_FIELDS, subscription.nick);
}

exports.SignSubscriptionStanza = function(subscription, privkey) {
  return SignStanza(subscription, SUBSCRIPTION_FIELDS, privkey);
}


var USER_PROFILE_FIELDS = [
    'about',
    'interchangeUrl',
    'nick',
    'pubkey',
    'updatedAt',
];

exports.CheckUserProfileStanza = function(hubClient, userProfile) {
  if (!exports.ValidateHubSignature(userProfile)) {
    throw new errors.AuthenticationError('User profile\'s `hubSig` does not match the Hub\'s key on file.');
  }

  // In contrast to all the other verifiers, we don't fetch the user's profile
  // to check this stanza.  Instead, we just check that it is internally-
  // consistent (i.e., that its sig matches its claimed pubkey.)
  //
  // Since we've checked the Hub's signature, we trust it to ensure that the
  // user profile is valid.
  var verifier = ursa.createVerifier('sha1');
  UpdateWithFields(verifier, userProfile, USER_PROFILE_FIELDS);
  var pubkeyStr = userProfile.pubkey;
  var pubkey = ursa.createPublicKey(pubkeyStr);
  return P.resolve(verifier.verify(pubkey, userProfile.sig, 'base64'));
}

exports.SignUserProfileStanza = function(userProfile, privkey) {
  return SignStanza(userProfile, USER_PROFILE_FIELDS, privkey);
}

exports.ValidateHubSignature = function(userProfile) {
  var data = new Buffer(
      userProfile.about +
      userProfile.interchangeUrl +
      userProfile.nick +
      userProfile.pubkey +
      userProfile.updatedAt +
      userProfile.hubCreatedAt +
      userProfile.hubSyncedAt +
      userProfile.sig);
  var verifier = ursa.createVerifier('sha1');
  verifier.update(data, 'utf8');
  return verifier.verify(HUB_PUBLIC_KEY, userProfile.hubSig, 'base64');
}


var USER_STATUS_FIELDS = [
    'isOnline',
    'nick',
    'statusText',
    'updatedAt',
];

exports.CheckUserStatusStanza = function(hubClient, userStatus) {
  return CheckStanza(hubClient, userStatus, USER_STATUS_FIELDS, userStatus.nick);
}

exports.SignUserStatusStanza = function(userStatus, privkey) {
  return SignStanza(userStatus, USER_STATUS_FIELDS, privkey);
}


var BLOCK_FIELDS = [
  'blocked',
  'blockee',
  'blocker',
  'intermediateNick',
  'updatedAt',
];

exports.CheckBlockStanza = function(hubClient, block) {
  return CheckStanza(hubClient, block, BLOCK_FIELDS, block.blocker);
}

exports.SignBlockStanza = function(block, privkey) {
  return SignStanza(block, BLOCK_FIELDS, privkey);
}


var MIN_ENTITY_RESYNC_MS = 60000;


/**
 * Verifies that the stanza's signature matches the author's public key on file
 * at the Hub.
 *
 * May fetch updated user profile information from the Hub.
 *
 * @param {HubClient} hubClient A HubClient instance used to fetch user profile
 *     information.
 * @param {Object} stanza The stanza to check
 * @param {String} stanza.sig The stanza's signature field.
 * @param {Array<String>} fields The names of the stanza fields to check.
 * @param {String} author The name of the purported author of the stanza.
 * @param {String?} opt_sigValue The sig value to check.  If unset, defaults to
 *     `stanza.sig`.
 * @return {Promise<true>} Iff the signature is valid
 * @throws {errors.AuthenticationError} If the signature is invalid or the user
 *     cannot be found.
 */
CheckStanza = function(hubClient, stanza, fields, author, opt_sigValue) {
  var sig = opt_sigValue === undefined ? stanza.sig : opt_sigValue;
  if (!sig) {
    throw new errors.AuthenticationError('No `sig` field in stanza');
  }
  if (!stanza.updatedAt || typeof(stanza.updatedAt) != 'number') {
    throw new errors.AuthenticationError('Invalid `updatedAt` field in stanza');
  }
  return hubClient.GetUserProfile(author, stanza.updatedAt)
    .then(function(userProfile) {
      var verifier = ursa.createVerifier('sha1');
      UpdateWithFields(verifier, stanza, fields);
      var pubkeyStr = userProfile.pubkey;
      var pubkey = ursa.createPublicKey(pubkeyStr);
      var ok = verifier.verify(pubkey, stanza.sig, 'base64');
      if (ok) {
        return true;
      }
      debug('First verification failed', author);
      // The signatures do not match.  Refetch the author's profile directly
      // from the hub, then try again.
      if (new Date().getTime() - userProfile.syncedAt < MIN_ENTITY_RESYNC_MS) {
        debug('Not refetching user profile', author);
        return false;
      }
      return hubClient.GetUserProfileFromHub(author, stanza.updatedAt)
        .then(function(userProfile) {
          // The pubkeys are still the same, so don't bother re-checking.
          if (userProfile.pubkey == pubkeyStr) {
            debug('Pubkeys identical, not reverifying', author);
            return false;
          }
          // The pubkeys are different, so perhaps that's why the first check
          // failed.
          var pubkey = ursa.createPublicKey(userProfile.pubkey);
          return verifier.verify(userProfile.pubkey, sig, 'base64');
        })
    })
    .catch(errors.NotFoundError, function(err) {
      throw new errors.AuthenticationError(
          'No such user registered with the Hub: ' + author);
    })
    .then(function(ok) {
      if (!ok) {
        throw new errors.AuthenticationError('Stanza signatures do not match for user ' + author);
      }
      return ok;
    });
}


/**
 * Signs a stanza with the given private key.
 *
 * @param {Object} stanza The object to sign.
 * @param {Array<String>} fields The name of the fields to include in the
 *     signature.
 * @param {String} privkey The private key to use to sign, in PEM format.
 * @returns {Object} The given stanza, with `sig` set to the signature.
 */
function SignStanza(stanza, fields, privkey) {
  stanza.sig = GenerateStanzaSig(stanza, fields, privkey);
  return stanza;
}


function GenerateStanzaSig(stanza, fields, privkey) {
  debug('Signing', fields);
  var signer = ursa.createSigner('sha1');
  UpdateWithFields(signer, stanza, fields);
  return signer.sign(privkey, 'base64');
}



function UpdateWithFields(updatable, stanza, fields) {
  fields.forEach(function(name) {
    var v = stanza[name];
    if (v === undefined) {
      return;
    }
    updatable.update(v + '', 'utf8');
  });
}
