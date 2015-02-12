/**
 * Integration test for InterchangeServer.
 */

// TODO This is a skeleton.  It only tests some primary paths, no failure cases.


var assert = require('assert');
var authentication = require('vox-common/authentication');
var ConnectionManager = require('vox-common/connection-manager');
var eyes = require('vox-common/eyes');
var fakehub = require('vox-common/test/fakehub');
var hubclient = require('vox-common/hubclient');
var interchangedb = require('../interchangedb');
var interchangeserver = require('../interchangeserver');
var P = require('bluebird');
var temp = require('temp');
var urlparse = require('url');
var ursa = require('ursa');
var uuid = require('node-uuid');
var voxurl = require('vox-common/voxurl');


temp.track(); // Delete temp files.


describe('interchangeserver', function() {
  var fakeHub;
  var fakeHubUrl;
  var serverHubClient;
  var clientHubClient;
  var server;
  var clientManager;

  var BEFORE_NOW = Date.now()
  var NOW = BEFORE_NOW + 1;

  var userKeys = {};
  var _cachedUserKeys = [];
  var _availableUserKeys = [];

  before(function() {
    return fakehub.FakeHub()
      .then(function(f) {
        fakehub.stubHubPublicKey();
        fakeHub = f;
        fakeHubUrl = urlparse.format({
            protocol: 'http',
            slashes: true,
            hostname: 'localhost',
            port: fakeHub.address().port
        });
      });
  })

  beforeEach(function() {
    fakeHub.__clearProfiles__();
    _availableUserKeys = _cachedUserKeys.slice(0);

    // We create one server with a local DB, and one client with its own local
    // DB.
    return interchangedb.openDb({ dbFile: temp.path(), streamDbDir: temp.path() })
      .then(function(db) {
        serverHubClient = hubclient.HubClient(fakeHubUrl, db);
        return interchangeserver.CreateInterchangeServer(0, 0, serverHubClient, db);
      })
      .then(function(s) {
        server = s;
      })
      .then(function() {
        return interchangedb.openDb({ dbFile: temp.path(), streamDbDir: temp.path() })
          .then(function(db) {
            clientHubClient = hubclient.HubClient(fakeHubUrl, db);
            clientManager = ConnectionManager(clientHubClient, '0.0.0', 'unittest');
          })
      });
  })

  afterEach(function() {
    eyes.close();
  })

  function _generateUserKey() {
    if (_availableUserKeys.length) {
      return _availableUserKeys.pop();
    }
    var key = ursa.generatePrivateKey();
    _cachedUserKeys.push(key);
    return key;
  }


  //////////////////////
  // Helper functions //
  //////////////////////

  /** Creates a new user and registers it with the fake Hub. */
  function registerUser(nick) {
    var key = _generateUserKey();
    userKeys[nick] = key;
    return clientHubClient.registerUserProfile({
        nick: nick,
        interchangeUrl: server.serverUrl,
        pubkey: key.toPublicPem('utf8'),
        about: 'I am ' + nick,
        updatedAt: BEFORE_NOW
    }, key.toPrivatePem('utf8'));
  }

  /** Sends a new UserProfile to the fake Hub, then sends a stanza to vox:<nick>/profile */
  function updateUserProfile(stanza) {
    var key = userKeys[stanza.nick];
    stanza.type = 'USER_PROFILE';
    authentication.signStanza(stanza, key);
    return clientHubClient.registerUserProfile(stanza, key.toPrivatePem('utf8'))
      .then(function(userProfile) {
        return clientManager.connect(userProfile.nick, userProfile.nick)
          .then(function(conn) {
            return conn.POST('vox:' + userProfile.nick + '/profile', userProfile);
          })
          .then(function(reply) {
            assert.equal(reply.status, 200);
            assert(!!reply.userProfile);
            return reply.userProfile;
          })
      });
  }

  /** Opens a connection and sends SESSION. */
  function establishSession(owner, nick) {
    return clientManager.connect(owner, nick)
      .then(function(conn) {
        if (conn.sessionId) {
          return conn;
        }
        return conn.SESSION().return(conn);
      });
  }

  /** Sets up a route on vox:<owner> for `routeUrl` */
  function subscribeTo(routeUrl) {
    var owner = voxurl.toSource(routeUrl);
    return establishSession(owner, owner)
      .then(function(conn) {
        var payload = {
            sessionId: conn.sessionId,
            updatedAt: NOW
        };
        return conn.SUBSCRIBE(routeUrl, payload)
          .then(function(reply) {
            assert.equal(reply.status, 200);
          });
      });
  }

  /** Sends POST to vox:<stream> */
  function postMessage(stanza) {
    var owner = voxurl.toSource(stanza.stream);
    stanza.type = 'MESSAGE';
    return clientManager.connect(owner, stanza.nick)
      .then(function(conn) {
        authentication.signStanza(stanza, userKeys[stanza.nick]);
        return conn.POST(voxurl.toCanonicalUrl(stanza.stream), { stanza: stanza });
      })
      .then(function(reply) {
        assert.equal(reply.status, 200);
        assert(!!reply.stanza);
        return reply.stanza;
      });
  }

  /** Sends POST to vox:<stream> */
  function postVote(stanza) {
    var owner = voxurl.toSource(stanza.stream);
    stanza.type = 'VOTE';
    return clientManager.connect(owner, stanza.nick)
      .then(function(conn) {
        authentication.signStanza(stanza, userKeys[stanza.nick]);
        return conn.POST(voxurl.toCanonicalUrl(stanza.stream), { stanza: stanza });
      })
      .then(function(reply) {
        assert.equal(reply.status, 200);
        assert(!!reply.stanza);
        return reply.stanza;
      })
  }

  /** Sends POST to vox:<stream> */
  function postUserStatus(stanza) {
    var owner = voxurl.toSource(stanza.stream);
    stanza.type = 'USER_STATUS';
    return clientManager.connect(owner, stanza.nick)
      .then(function(conn) {
        authentication.signStanza(stanza, userKeys[stanza.nick]);
        return conn.POST(voxurl.toCanonicalUrl(stanza.stream), { stanza: stanza });
      })
      .then(function(reply) {
        assert.equal(reply.status, 200);
        assert(!!reply.stanza);
        return reply.stanza;
      })
  }

  /** Sends GET to vox:<stream> */
  function listStanzas(stream, options) {
    var owner = voxurl.toSource(stream);
    return clientManager.connect(owner, owner)
      .then(function(conn) {
        return conn.GET(voxurl.toCanonicalUrl(stream), options);
      })
      .then(function(reply) {
        assert.equal(reply.status, 200);
        assert(!!reply.stanzas);
        return reply.stanzas;
      });
  }

  ////////////////
  // Test cases //
  ////////////////

  it('accepts POST to /messages', function() {
    return registerUser('tester')
      .then(function() {
        return postMessage({ stream: 'tester', nick: 'tester', text: 'hi there!', updatedAt: NOW });
      })
      .then(function() {
        return listStanzas('tester');
      })
      .then(function(messages) {
        assert.equal(messages.length, 1);
        assert.equal(messages[0].text, 'hi there!');
      });
  })

  it('lists only the messages from a stream', function() {
    return P.all([registerUser('a'), registerUser('b')])
      .then(function() {
        return P.all([
            postMessage({ stream: 'a', nick: 'a', text: 'hi there!', updatedAt: NOW }),
            postMessage({ stream: 'b', nick: 'b', text: 'hi there!', updatedAt: NOW })
        ]);
      })
      .then(function() {
        return listStanzas('a');
      })
      .then(function(messages) {
        assert.equal(messages.length, 1);
        assert.equal(messages[0].nick, 'a');
      });
  })

  it('lists replies to a message', function() {
    return P.all([registerUser('a')])
      .then(function() {
        return postMessage({ stream: 'a', nick: 'a', text: 'first', updatedAt: NOW });
      })
      .then(function(message) {
        var messageUrl = voxurl.getStanzaUrl(message);
        return P.all([
            postMessage({ stream: 'a', nick: 'a', text: 'second', updatedAt: NOW, replyTo: messageUrl }),
            postMessage({ stream: 'a', nick: 'a', text: 'third', updatedAt: NOW + 1, replyTo: messageUrl }),
            postMessage({ stream: 'a', nick: 'a', text: 'fourth', updatedAt: NOW + 2 })
        ])
        .then(function() {
          return listStanzas('a', { replyTo: messageUrl });
        })
        .then(function(messages) {
          assert.equal(messages.length, 2);
          messages.sort(function(a, b) { return a.updatedAt - b.updatedAt });
          assert.equal(messages[0].text, 'second');
          assert.equal(messages[1].text, 'third');
        })
      })
  })

  it('lists replies to a thread', function() {
    return P.all([registerUser('a')])
      .then(function() {
        return postMessage({ stream: 'a', nick: 'a', text: 'first', updatedAt: NOW });
      })
      .then(function(message) {
        var thread = voxurl.getStanzaUrl(message);
        return postMessage({ stream: 'a', nick: 'a', text: 'second', updatedAt: NOW + 1, replyTo: thread, thread: thread });
      })
      .then(function(reply1) {
        return postMessage({ stream: 'a', nick: 'a', text: 'third', updatedAt: NOW + 2, thread: reply1.thread });
      })
      .then(function(reply2) {
        return listStanzas('a', { thread: reply2.thread });
      })
      .then(function(messages) {
        assert.equal(messages.length, 2);
        messages.sort(function(a, b) { return a.updatedAt - b.updatedAt });
        assert.equal(messages[0].text, 'second');
        assert.equal(messages[1].text, 'third');
      })
  });

  it('forwards MESSAGEs to routes', function(done) {
    clientManager.on('STANZA', function(stanza) {
      assert.equal('MESSAGE', stanza.type);
      assert.equal('sender', stanza.nick);
      assert.equal(NOW, stanza.updatedAt);
      assert.equal('hi from sender', stanza.text);
      done();
    });

    P.all([registerUser('sender')])
      .then(function() {
        return subscribeTo('vox:sender/friends');
      })
      .then(function() {
        return postMessage({ stream: 'sender/friends', nick: 'sender', text: 'hi from sender', updatedAt: NOW});
      })
      .catch(function(err) {
        done(err);
      });
  });

  it('forwards VOTEs to routes', function(done) {
    clientManager.on('STANZA', function(stanza) {
      assert.equal('VOTE', stanza.type);
      assert.equal('sender', stanza.nick);
      assert.equal(NOW, stanza.updatedAt);
      assert.equal('vox:other/123', stanza.voteUrl);
      assert.equal(2, stanza.score);
      assert.equal('like', stanza.tag);
      done();
    });

    P.all([registerUser('sender'), registerUser('other')])
      .then(function() {
        return subscribeTo('vox:sender/things');
      })
      .then(function() {
        return postVote({
            nick: 'sender',
            stream: 'sender/things',
            voteUrl: 'vox:other/123',
            score: 2,
            tag: 'like',
            updatedAt: NOW
         });
      })
      .catch(function(err) {
        done(err);
      });
  })

  it('forwards USER_STATUSes to routes', function(done) {
    clientManager.on('STANZA', function(stanza) {
      assert.equal('USER_STATUS', stanza.type);
      assert.equal('sender', stanza.nick);
      assert.equal(NOW, stanza.updatedAt);
      assert.equal('I am fine', stanza.statusText);
      done();
    });

    P.all([registerUser('sender')])
      .then(function() {
        return subscribeTo('vox:sender/status');
      })
      .then(function() {
        return postUserStatus({
            nick: 'sender',
            stream: 'sender/status',
            statusText: 'I am fine',
            updatedAt: NOW
        });
      })
      .catch(function(err) {
        done(err);
      });
  })

  it('forwards USER_PROFILEs to routes', function(done) {
    clientManager.on('STANZA', function(stanza) {
      assert.equal('USER_PROFILE', stanza.type);
      assert.equal('sender', stanza.nick);
      assert.equal(NOW, stanza.updatedAt);
      assert.equal('I am about', stanza.about);
      done();
    });

    P.all([registerUser('sender')])
      .then(function() {
        return subscribeTo('vox:sender/profile');
      })
      .then(function() {
        return updateUserProfile({
            nick: 'sender',
            stream: 'sender/profile',
            about: 'I am about',
            updatedAt: NOW + 1,
            pubkey: userKeys['sender'].toPublicPem('utf8')
        });
      })
      .catch(function(err) {
        done(err);
      });
  })

  // TODO test that an event is NOT fired, but without using a timeout:
  // it('stops routing to disconnected sessions', function(done) {
  //   return P.all([registerUser('sender')])
  //     .then(function() {
  //       return subscribeTo('vox:sender');
  //     })
  //     .then(function() {
  //       return postMessage({ nick: 'sender', text: 'hi from sender', updatedAt: NOW});
  //     })
  //     .then(function() {
  //       return clientManager.connect('sender', 'sender');
  //     })
  //     .then(function(conn) {
  //       conn.close();
  //       return postMessage({ nick: 'sender', text: 'hi from sender', updatedAt: NOW});
  //     })
  //     .catch(function(err) {
  //       done(err);
  //     });
  // });
})
