/**
 * Implements the interchange endpoints.  These routes are accessible via either
 * the socket or the web interfaces.
 */

var authentication = require('vox-common/authentication');
var debug = require('debug')('vox:interchangeroutes');
var eyes = require('vox-common/eyes')
var P = require('bluebird');
var util = require('util');
var uuid = require('node-uuid');
var validators = require('./validators');
var voxcommon = require('vox-common');
var voxurl = require('vox-common/voxurl');


// Export the router.
var router = exports.router = require('express').Router();

var makeCanonicalName = voxcommon.validation.makeCanonicalName;

var POSTVOX_PROTOCOL_VERSION = '0.0.1';
var SERVER_AGENT = 'Postvox Vanilla Server 0.0.2';


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
// The requests expect `req.url` to be of the form "vox:<owner>/...".  E.g.,
// "vox:spacemaus/friends".
//
// `req.voxOwner` must be set to the hostname portion of the URL, e.g.,
// "spacemaus".
//
// `req.stream` must be set to the <owner>/<streamName> portion of the URL, if
// <streamName> is in the URL, or to just <owner> if <streamName> is not in the
// URL.  E.g., for "vox:spacemaus" -> stream = "spacemaus", and for
// "vox:spacemaus/friends" -> stream = "spacemaus/friends".
////////////////////////////////////////////////////////////////////////////////


router.use(voxcommon.ratelimiter({
    sustainedRate: 1,
    burstCredit: 20,
    baseDelayMs: 500,
    maxDelayMs: 30000,
    whitelist: ['127.0.0.1']
}));

// Ensures that `voxOwner` is set and canonicalized.
router.use(function(req, res, next) {
  if (req._parsedUrl.hostname) {
    req.voxOwner = makeCanonicalName(req._parsedUrl.hostname);
  }
  req.stream = req.voxOwner;
  req.params.streamName = '';
  next();
});

router.param('streamName', function(req, res, next, streamName) {
  if (streamName) {
    req.stream = req.voxOwner + '/' + streamName;
  } else {
    req.stream = req.voxOwner;
    req.params.streamName = '';
  }
  next();
});

/**
 * Starts an eyes timer.  Call `req.stopTimer()` at the end of the request.
 */
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
.post(validators.checkPayload({
    version: validators.isValidVersion,
    agent: validators.isValidAgent,
    webhook: validators.isValidUrl.optional
}))
.post(function(req, res, next) {
  req.context.db.findSession(req.params.sessionId)
    .then(function(session) {
      var version = req.payload.version;
      var agent = req.payload.agent;
      var now = Date.now();

      // TODO Implement webhooks:
      if (req.payload.webhook) {
        res.sendStatus(501, 'Webhooks not implemented on this server.');
      }

      if (session) {
        eyes.mark('sessions.resumed');
        // Resume an existing session.
        var sessionId = session.sessionId;
        req.context.setSessionId(sessionId);
        return req.context.db.setSessionConnected({
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
        return req.context.db.createSession({
              sessionId: sessionId,
              isConnected: true,
              version: version,
              agent: agent,
              webhook: req.payload.webhook,
              createdAt: now,
              lastSeenAt: now
          })
          .then(function() {
            req.context.setSessionId(sessionId);
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


//////////////////////
// Stream endpoints //
//////////////////////

router.route('/:streamName?').all(startTimer);

var _checkSubscribePayload = validators.checkPayload({
    sessionId: validators.isValidSessionId.optional,
    updatedAt: validators.isValidTimestamp
});

function _handleSubscribeOrUnsubscribe(req, res, next)  {
  if (!req.payload.sessionId && !req.context.sessionId) {
    res.sendStatus(400, 'No SESSION started, and no sesionId provided!')
    return;
  } else if (req.payload.sessionId && req.context.sessionId &&
      req.payload.sessionId != req.context.sessionId) {
    res.sendStatus(400, util.format('Session ID does not match! %s vs %s', req.payload.sessionId, req.context.sessionId));
    return;
  }
  var weight = req.method == 'SUBSCRIBE' ? 1 : 0;
  var url = voxurl.toCanonicalUrl(req.url);
  if (!url) {
    res.sendStatus(400, 'Invalid URL: ' + req.url);
  }
  req.context.db.insertRoute({
        sessionId: req.context.sessionId,
        routeUrl: url,
        weight: weight,
        updatedAt: req.payload.updatedAt
    })
    .then(function(route) {
      res.json({
          status: 200
      });
    })
    .finally(req.stopTimer)
    .catch(next);
}

router.route('/:streamName?')
.subscribe(_checkSubscribePayload)
.subscribe(_handleSubscribeOrUnsubscribe)
.unsubscribe(_checkSubscribePayload)
.unsubscribe(_handleSubscribeOrUnsubscribe)


var STANZA_CHECKERS = {
    MESSAGE: validators.checkObject({
        nick: validators.isValidNick,
        stream: validators.isValidStream,
        title: validators.isValidMessageTitle.optional,
        text: validators.isValidMessageText,
        userUrl: validators.isValidUrl.optional,
        etc: validators.isValidMessageText.optional,
        clone: validators.isValidMessageUrl.optional,
        thread: validators.isValidMessageUrl.optional,
        replyTo: validators.isValidMessageUrl.optional,
        updatedAt: validators.isValidTimestamp,
        op: validators.isValidOp.optional,
        opSeq: validators.isValidSeq.optional
    }),
    VOTE: validators.checkObject({
        nick: validators.isValidNick,
        stream: validators.isValidStream,
        voteUrl: validators.isValidVoteUrl,
        score: validators.isValidScore,
        tag: validators.isValidTag.optional,
        updatedAt: validators.isValidTimestamp,
        op: validators.isValidOp.optional,
        opSeq: validators.isValidSeq.optional
    }),
    USER_PROFILE: validators.checkObject({
        nick: validators.isValidNick,
        stream: validators.isValidStream,
        interchangeUrl: validators.isValidUrl,
        pubkey: validators.isValidPubkey,
        op: validators.isValidOp.optional,
        opSeq: validators.isValidSeq.optional
    }),
    USER_STATUS: validators.checkObject({
        nick: validators.isValidNick,
        stream: validators.isValidStream,
        statusText: validators.isValidStatusText,
        isOnline: validators.isValidBoolean.optional,
        updatedAt: validators.isValidTimestamp,
        op: validators.isValidOp.optional,
        opSeq: validators.isValidSeq.optional
    })
};


/**
 * Append to and retrieve from streams.
 */
router.route('/:streamName?')
.post(validators.checkPayload({
    stanza: validators.isPartlyValidStanza,
}))
.post(function(req, res, next) {
  var stanza = req.payload.stanza;
  var nick = stanza.nick;
  if (req.stream != stanza.stream) {
    res.sendStatus(400, util.format(
        'Payload stream does not match request URL stream: %s vs %s',
        stanza.stream, req.stream));
    return;
  }
  var checkResult = STANZA_CHECKERS[stanza.type](stanza);
  if (checkResult !== true) {
    res.sendStatus(400, 'Invalid stanza: ' + checkResult);
    return;
  }
  var authTimer = eyes.start('authentication.checkStanza.' + stanza.type);
  authentication.checkStanza(req.context.hubClient, stanza)
    .then(function() {
      authTimer();
      eyes.mark('POST.' + stanza.type);
      if (stanza.type == 'MESSAGE') {
        var text = stanza.text;
        var title = stanza.title;
        var etc = stanza.etc;
        eyes.observe('messages.text_size', text ? text.length : 0, 'chars');
        eyes.observe('messages.title_size', title ? title.length : 0, 'chars');
        eyes.observe('messages.etc_size', etc ? etc.length : 0, 'chars');
        if (stanza.thread) {
          eyes.mark('messages.has_thread');
        }
        if (stanza.clone) {
          eyes.mark('messages.has_clone');
        }
        if (stanza.replyTo) {
          eyes.mark('messages.has_replyTo');
        }
        if (stanza.userUrl) {
          eyes.mark('messages.has_userUrl');
        }
      }
      return req.context.db.appendStanza(stanza);
    })
    .then(function(stanza) {
      res.json({
          status: 200,
          stanza: stanza
      });
      var streamUrl = 'vox:' + req.stream;
      var targets = [
          streamUrl
      ];
      if (stanza.thread) {
        targets.push(stanza.thread + '/thread');
      }
      if (stanza.replyTo) {
        targets.push(stanza.replyTo + '/replyTo');
      }
      req.context.targetCast(
          targets,
          'STANZA',
          stanza);

      if (stanza.type == 'USER_PROFILE') {
        return req.context.db.saveUserProfile(stanza)
          .return(stanza);
      }
      return stanza;
    })
    .finally(req.stopTimer)
    .catch(next);
})
.get(validators.checkPayload({
    limit: validators.isValidLimit.optional,
    seqStart: validators.isValidSeq.optional,
    seqLimit: validators.isValidSeq.optional,
    reverse: validators.isValidBoolean.optional,
    thread: validators.isValidMessageUrl.optional,
    replyTo: validators.isValidMessageUrl.optional,
    opSeq: validators.isValidSeq.optional,
    stanzaUrl: validators.isValidMessageUrl.optional,
    nick: validators.isValidNick.optional
}))
.get(function(req, res, next) {
  var options = req.payload;
  if (options.stanzaUrl) {
    req.context.db.getStanza(options.stanzaUrl)
      .then(function(stanza) {
        if (!stanza) {
          res.sendStatus(404, 'Not found: ' + options.stanzaUrl);
        } else {
          res.json({
              status: 200,
              stanzas: [stanza]
          });
        }
      })
      .finally(req.stopTimer)
      .catch(next);
  } else {
    options.stream = req.stream;
    options.limit = withDefault(options.limit, 40);
    req.context.db.listStanzas(options)
      .then(function(stanzas) {
        res.json({
            status: 200,
            stanzas: stanzas
        });
      })
      .finally(req.stopTimer)
      .catch(next);
  }
})


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
