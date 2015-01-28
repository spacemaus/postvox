/**
 * Implements the interchange endpoints.  These routes are accessible via either
 * the socket or the web interfaces.
 */

var authentication = require('vox-common/authentication');
var debug = require('debug')('vox:interchangeroutes');
var eyes = require('vox-common/eyes')
var P = require('bluebird');
var uuid = require('node-uuid');
var validators = require('./validators');
var voxcommon = require('vox-common');
var voxurl = require('./voxurl');


// Export the router.
var router = exports.router = require('express').Router();

var MakeCanonicalName = voxcommon.validation.MakeCanonicalName;

var POSTVOX_PROTOCOL_VERSION = '0.0.0';
var SERVER_AGENT = 'Postvox Vanilla Server 0.0.1';


////////////////////////////////////////////////////////////////////////////////
// NOTE:
//
// The routes here are used by both interchangesockets.js and interchangeweb.js.
// `req` and `res` are therefore not always "real" Express Request and Response
// instances.  See interchangesockets.js for the actual interfaces provided.
////////////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////////////
// NOTE 2:
//
// The requests expect `req.url` to be of the form "vox://<source>/...".  E.g.,
// "vox://spacemaus/messages".
//
// `req.voxSource` should be set to the hostname portion of the URL, e.g.,
// "spacemaus".
////////////////////////////////////////////////////////////////////////////////


router.use(voxcommon.ratelimiter({
    sustainedRate: 1,
    burstCredit: 20,
    baseDelayMs: 500,
    maxDelayMs: 30000,
    whitelist: ['127.0.0.1']
}));


router.use(function(req, res, next) {
  if (req._parsedUrl.hostname) {
    req.voxSource = MakeCanonicalName(req._parsedUrl.hostname);
  }
  next();
});


function startTimer(req, res, next) {
  req.mainRoutePath = req.route.path;
  req.stopTimer = eyes.start('routes.' + req.mainRoutePath + '.' + req.method);
  next();
}


///////////////////////
// Session endpoints //
///////////////////////

/**
 * Create or resume a session.
 */
router.route('/session/:sessionId?')
.all(startTimer)
.post(validators.CheckPayload({
    version: validators.isValidVersion,
    agent: validators.isValidAgent,
    webhook: validators.isValidUrl.optional
}))
.post(function(req, res, next) {
  req.context.db.FindSession(req.params.sessionId)
    .then(function(session) {
      var version = req.payload.version;
      var agent = req.payload.agent;
      var now = new Date().getTime();

      // TODO Implement webhooks:
      if (req.payload.webhook) {
        res.sendStatus(501, 'Webhooks not implemented on this server.');
      }

      if (session) {
        eyes.mark('sessions.resumed');
        // Resume an existing session.
        var sessionId = session.sessionId;
        req.context.SetSessionId(sessionId);
        return req.context.db.SetSessionConnected({
              sessionId: sessionId,
              isConnected: true,
              version: version,
              agent: agent,
              remoteAddress: req.remoteAddress,
              lastSeenAt: now
          })
          .then(function() {
            res.json({
                status: 200,
                version: POSTVOX_PROTOCOL_VERSION,
                agent: SERVER_AGENT
            });
          });
      } else {
        // No session provided, or the session was expired.  Create a new one.
        eyes.mark('sessions.new');
        var sessionId = uuid.v4();
        debug('New session %s %s %s', sessionId, version, agent);
        return req.context.db.NewSession({
              sessionId: sessionId,
              isConnected: true,
              version: version,
              agent: agent,
              webhook: req.payload.webhook,
              createdAt: now,
              lastSeenAt: now
          })
          .then(function() {
            req.context.SetSessionId(sessionId);
            res.json({
                status: 200,
                newSessionId: sessionId,
                version: POSTVOX_PROTOCOL_VERSION,
                agent: SERVER_AGENT
            });
          });
        }
    })
    .finally(req.stopTimer)
    .catch(next);
});

/**
 * Create or update a route in a session.
 */
router.route('/session/:sessionId/routes')
.all(startTimer)
.post(validators.CheckPayload({
    routeUrl: validators.isValidRouteUrl,
    weight: validators.isValidWeight,
    updatedAt: validators.isValidTimestamp
}))
.post(function(req, res, next) {
  if (req.params.sessionId != req.context.sessionId) {
    res.sendStatus(400, 'Session ID does not match!');
    return;
  }
  req.context.db.InsertRoute({
        sessionId: req.params.sessionId,
        routeUrl: req.payload.routeUrl,
        weight: req.payload.weight,
        updatedAt: req.payload.updatedAt
    })
    .then(function(route) {
      res.json({
          status: 200,
          route: route
      });
    })
    .finally(req.stopTimer)
    .catch(next);
});


////////////////////////////
// Subscription endpoints //
////////////////////////////

/**
 * Get the subscriptions of <source>.
 */
router.route('/subscriptions')
.all(startTimer)
.get(validators.CheckPayload({
    limit: validators.isValidLimit.optional,
    syncedBefore: validators.isValidTimestamp.optional,
    syncedAfter: validators.isValidTimestamp.optional
}))
.get(function(req, res, next) {
  var limit = withDefault(req.payload.limit, 20);
  return req.context.db.ListSubscriptions({
        nick: req.voxSource,
        limit: limit,
        syncedBefore: req.payload.syncedBefore,
        syncedAfter: req.payload.syncedAfter
    })
    .then(function(subscriptions) {
      res.json({
          status: 200,
          subscriptions: subscriptions
      });
    })
    .finally(req.stopTimer)
    .catch(next);
})

/**
 * Register a new subscriber.
 */
router.route('/subscribers')
.all(startTimer)
.post(validators.CheckPayload({
    nick: validators.isValidNick,
    subscriptionUrl: validators.isValidSubscriptionUrl,
    weight: validators.isValidWeight,
    updatedAt: validators.isValidTimestamp
}))
.post(function(req, res, next) {
  authentication.CheckSubscriptionStanza(req.context.hubClient, req.payload)
    .then(function() {
      return req.context.db.InsertSubscription({
          nick: req.payload.nick,
          subscriptionUrl: req.payload.subscriptionUrl,
          weight: req.payload.weight,
          updatedAt: req.payload.updatedAt,
          sig: req.payload.sig
      });
    })
    .then(function(subscription) {
      res.json({
          status: 200,
          subscription: subscription
      });
      var targets = [
          voxurl.ToSourceUrl(req.payload.subscriptionUrl),
          req.payload.subscriptionUrl + '/subscribers'
      ];
      if (req.voxSource == req.payload.nick) {
        var sourceUrl = 'vox://' + req.voxSource;
        targets.push(sourceUrl, sourceUrl + '/subscriptions');
      }
      req.context.TargetCast(
          targets,
          'SUBSCRIPTION',
          subscription);
    })
    .finally(req.stopTimer)
    .catch(next);
});


var CheckSubscribersPayload = validators.CheckPayload({
    limit: validators.isValidLimit.optional,
    syncedBefore: validators.isValidTimestamp.optional,
    syncedAfter: validators.isValidTimestamp.optional
});


/**
 * Helper method to list the subscribers to a URL.
 */
function ListSubscribers(req, res, next) {
  var limit = withDefault(req.payload.limit, 20);
  var offset = withDefault(req.payload.offset, 0);
  var subscriptionUrl = req.url.substring(0, req.url.length - '/subscribers'.length);
  return req.context.db.ListSubscribersByUrl({
      subscriptionUrl: subscriptionUrl,
      limit: limit,
      syncedBefore: req.payload.syncedBefore,
      syncedAfter: req.payload.syncedAfter
    })
    .then(function(subscriptions) {
      res.json({
          status: 200,
          subscriptions: subscriptions
      });
    })
    .finally(req.stopTimer)
    .catch(next);
}

router.route('/subscribers')
  .get(CheckSubscribersPayload)
  .get(ListSubscribers);
router.route('/messages/subscribers')
  .get(CheckSubscribersPayload)
  .get(ListSubscribers);
router.route('/messages/:messageId/subscribers')
  .get(CheckSubscribersPayload)
  .get(ListSubscribers);
router.route('/messages/:messageId/thread/subscribers')
  .get(CheckSubscribersPayload)
  .get(ListSubscribers);
router.route('/messages/:messageId/replyTo/subscribers')
  .get(CheckSubscribersPayload)
  .get(ListSubscribers);
router.route('/profile/subscribers')
  .get(CheckSubscribersPayload)
  .get(ListSubscribers);
router.route('/status/subscribers')
  .get(CheckSubscribersPayload)
  .get(ListSubscribers);
router.route('/subscribers/subscribers')
  .get(CheckSubscribersPayload)
  .get(ListSubscribers);
router.route('/subscriptions/subscribers')
  .get(CheckSubscribersPayload)
  .get(ListSubscribers);


///////////////////////////////////////
// User profile and status endpoints //
///////////////////////////////////////

/**
 * Get or update a user's profile.
 */
router.route('/profile')
.all(startTimer)
.get(validators.CheckPayload({}))
.get(function(req, res, next) {
  req.context.db.GetUserProfile(req.voxSource)
    .then(function(userProfile) {
      res.json({
          status: 200,
          userProfile: userProfile
      });
    })
    .finally(req.stopTimer)
    .catch(next);
})
.post(validators.CheckPayload({
    nick: validators.isValidNick,
    interchangeUrl: validators.isValidUrl,
    pubkey: validators.isValidPubkey
}))
.post(function(req, res, next) {
  authentication.CheckUserProfileStanza(req.context.hubClient, req.payload)
    .then(function() {
      return req.context.db.SetUserProfile({
          nick: req.payload.nick,
          interchangeUrl: req.payload.interchangeUrl,
          pubkey: req.payload.pubkey,
          about: req.payload.about,
          updatedAt: req.payload.updatedAt,
          hubCreatedAt: req.payload.hubCreatedAt,
          hubSyncedAt: req.payload.hubSyncedAt,
          hubSig: req.payload.hubSig,
          sig: req.payload.sig
      });
    })
    .then(function(userProfile) {
      res.json({
          status: 200,
          userProfile: userProfile
      });
      var sourceUrl = 'vox://' + req.voxSource;
      req.context.TargetCast(
          [sourceUrl, sourceUrl + '/profile'],
          'USER_PROFILE',
          userProfile);
    })
    .finally(req.stopTimer)
    .catch(next);
});


/**
 * Get or update a user's status.
 */
router.route('/status')
.all(startTimer)
.get(validators.CheckPayload({}))
.get(function(req, res, next) {
  req.context.db.GetUserStatus(req.voxSource)
    .then(function(userStatus) {
      res.json({
          status: 200,
          userStatus: userStatus
      })
    })
    .finally(req.stopTimer)
    .catch(next);
})
.post(validators.CheckPayload({
    nick: validators.isValidNick,
    statusText: validators.isValidStatusText,
    isOnline: validators.isValidBoolean.optional,
    updatedAt: validators.isValidTimestamp
}))
.post(function(req, res, next) {
  authentication.CheckUserStatusStanza(req.context.hubClient, req.payload)
    .then(function() {
      return req.context.db.SetUserStatus({
          nick: req.payload.nick,
          statusText: req.payload.statusText,
          isOnline: req.payload.isOnline,
          updatedAt: req.payload.updatedAt,
          sig: req.payload.sig
      });
    })
    .then(function(userStatus) {
      res.json({
          status: 200,
          userStatus: userStatus
      });
      var sourceUrl = 'vox://' + req.voxSource;
      req.context.TargetCast(
          [sourceUrl, sourceUrl + '/status'],
          'USER_STATUS',
          userStatus);
    })
    .finally(req.stopTimer)
    .catch(next);
});


///////////////////////
// Message endpoints //
///////////////////////

/**
 * List messages or create a new message.
 */
router.route('/messages')
.all(startTimer)
.get(validators.CheckPayload({
    limit: validators.isValidLimit.optional,
    syncedBefore: validators.isValidTimestamp.optional,
    syncedAfter: validators.isValidTimestamp.optional
}))
.get(function(req, res, next) {
  var limit = withDefault(req.payload.limit, 20);
  var offset = withDefault(req.payload.offset, 0);
  req.context.db.ListMessages({
        source: req.voxSource,
        limit: limit,
        syncedBefore: req.payload.syncedBefore,
        syncedAfter: req.payload.syncedAfter
    })
    .then(function(messages) {
      res.json({
          status: 200,
          messages: messages
      });
    })
    .finally(req.stopTimer)
    .catch(next);
})
.post(validators.CheckPayload({
    author: validators.isValidNick,
    title: validators.isValidMessageTitle.optional,
    text: validators.isValidMessageText,
    userUrl: validators.isValidUrl.optional,
    etc: validators.isValidMessageText.optional,
    clone: validators.isValidMessageUrl.optional,
    thread: validators.isValidMessageUrl.optional,
    replyTo: validators.isValidMessageUrl.optional,
    updatedAt: validators.isValidTimestamp
}))
.post(function(req, res, next) {
  var author = req.payload.author;
  var now = new Date().getTime();
  var authTimer = eyes.start('authentication.CheckMessageStanza');
  authentication.CheckMessageStanza(req.context.hubClient, req.payload)
    .then(function() {
      authTimer();
      var now = new Date().getTime();
      // TODO Use a sensible ID assignment scheme:
      var messageUrl = req.url + '/' + new Date().getTime() + String(Math.random()).substr(1);

      var text = req.payload.text;
      var title = req.payload.title;
      var etc = req.payload.etc;

      eyes.mark('messages.POST');
      if (req.payload.thread) {
        eyes.mark('messages.has_thread');
      }
      if (req.payload.clone) {
        eyes.mark('messages.has_clone');
      }
      if (req.payload.replyTo) {
        eyes.mark('messages.has_replyTo');
      }
      if (req.payload.userUrl) {
        eyes.mark('messages.has_userUrl');
      }
      eyes.observe('messages.text_size', text ? text.length : 0, 'chars');
      eyes.observe('messages.title_size', title ? title.length : 0, 'chars');
      eyes.observe('messages.etc_size', etc ? etc.length : 0, 'chars');

      var thread = withDefault(req.payload.thread, req.payload.replyTo);
      return req.context.db.InsertMessage({
          messageUrl: messageUrl,
          source: req.voxSource,
          author: author,
          thread: thread,
          clone: req.payload.clone,
          replyTo: req.payload.replyTo,
          text: req.payload.text,
          title: req.payload.title,
          userUrl: req.payload.userUrl,
          etc: req.payload.etc,
          updatedAt: req.payload.updatedAt,
          sig: req.payload.sig
      });
    })
    .then(function(message) {
      var sessionId = req.context.sessionId;
      var messageUrl = message.messageUrl;
      var now = message.updatedAt;
      res.json({
          status: 200,
          message: message
      });
      var sourceUrl = 'vox://' + req.voxSource;
      var targets = [
          sourceUrl,
          sourceUrl + '/messages'
      ];
      if (message.thread) {
        targets.push(message.thread + '/thread');
      }
      if (message.replyTo) {
        targets.push(message.replyTo + '/replyTo');
      }
      req.context.TargetCast(
          targets,
          'MESSAGE',
          message);
      return message;
    })
    .finally(req.stopTimer)
    .catch(next);
});



/**
 * Get or update an individual message.
 */
router.route('/messages/:messageId')
.all(startTimer)
.get(validators.CheckPayload({}))
.get(function(req, res, next) {
  req.context.db.GetMessage(req.url)
    .then(function(message) {
      res.json({
          status: 200,
          message: message
      });
    })
    .finally(req.stopTimer)
    .catch(next);
})
.post(function(req, res, next) {
  // TODO Update the message.
  res.sendStatus(405, 'Not implemented yet');
})
.delete(function(req, res, next) {
  res.sendStatus(405, 'Not implemented yet');
})


router.route('/messages/:messageId/replyTo')
.all(startTimer)
.get(validators.CheckPayload({
    limit: validators.isValidLimit.optional,
    syncedBefore: validators.isValidTimestamp.optional,
    syncedAfter: validators.isValidTimestamp.optional
}))
.get(function(req, res, next) {
  var messageUrl = req.url.substring(0, req.url.length - '/replyTo'.length);
  var limit = withDefault(req.payload.limit, 20);
  req.context.db.ListMessages({
        source: req.voxSource,
        limit: limit,
        syncedBefore: req.payload.syncedBefore,
        syncedAfter: req.payload.syncedAfter,
        replyTo: messageUrl
    })
    .then(function(messages) {
      res.json({
          status: 200,
          messages: messages
      });
    })
    .finally(req.stopTimer)
    .catch(next);
})


router.route('/messages/:messageId/thread')
.all(startTimer)
.get(validators.CheckPayload({
    limit: validators.isValidLimit.optional,
    syncedBefore: validators.isValidTimestamp.optional,
    syncedAfter: validators.isValidTimestamp.optional
}))
.get(function(req, res, next) {
  var messageUrl = req.url.substring(0, req.url.length - '/thread'.length);
  var limit = withDefault(req.payload.limit, 20);
  req.context.db.ListMessages({
        source: req.voxSource,
        limit: limit,
        syncedBefore: req.payload.syncedBefore,
        syncedAfter: req.payload.syncedAfter,
        thread: messageUrl
    })
    .then(function(messages) {
      res.json({
          status: 200,
          messages: messages
      });
    })
    .finally(req.stopTimer)
    .catch(next);
})


/////////////////////
// Block endpoints //
/////////////////////

router.route('/blocks')
.get(function(req, res, next) {
  res.sendStatus(405, 'Not implemented yet');
})
.post(function(req, res, next) {
  res.sendStatus(405, 'Not implemented yet');
});



////////////////////
// Error handling //
////////////////////


router.use(function(err, req, res, next) {
  if (err.statusCode && (err.statusCode < 400 || err.statusCode > 499)) {
    console.error('Server error', err.stack);
  }
  var statusCode = err.statusCode ? err.statusCode : 500;
  res.sendStatus(statusCode, err.message);
  if (req.mainRoutePath) {
    eyes.mark('routes.' + req.mainRoutePath + '.errors.' + statusCode);
  }
  next(err);
});


function withDefault(v, defaultValue) {
  if (v === undefined || v === null) {
    return defaultValue;
  }
  return v;
}
