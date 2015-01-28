/**
 * Integration test for InterchangeServer.
 */

// TODO This is a skeleton.  It only tests some primary paths, no failure cases.


var assert = require('assert');
var authentication = require('vox-common/authentication');
var eyes = require('vox-common/eyes');
var fakehub = require('./fakehub');
var hubclient = require('vox-common/hubclient');
var interchangeclient = require('vox-common/interchangeclient');
var interchangedb = require('../interchangedb');
var interchangeserver = require('../interchangeserver');
var P = require('bluebird');
var temp = require('temp');
var urlparse = require('url');
var ursa = require('ursa');
var uuid = require('node-uuid');


temp.track(); // Delete temp files.


describe('interchangeserver', function() {

  var fakeHub;
  var fakeHubUrl;
  var serverHubClient;
  var clientHubClient;
  var server;
  var clientManager;

  var BEFORE_NOW = new Date().getTime()
  var NOW = BEFORE_NOW + 1;

  var userKeys = {};
  var _cachedUserKeys = [];
  var _availableUserKeys = [];

  before(function() {
    return fakehub.FakeHub()
      .then(function(f) {
        fakehub.StubHubPublicKey();
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
    fakeHub.__ClearProfiles__();
    _availableUserKeys = _cachedUserKeys.slice(0);

    // We create one server with a local DB, and one client with its own local
    // DB.
    return interchangedb.OpenDb({ dbFile: temp.path(), messageDbDir: temp.path() })
      .then(function(db) {
        serverHubClient = hubclient.HubClient(fakeHubUrl, db);
        return interchangeserver.CreateInterchangeServer(0, 0, serverHubClient, db);
      })
      .then(function(s) {
        server = s;
      })
      .then(function() {
        return interchangedb.OpenDb({ dbFile: temp.path(), messageDbDir: temp.path() })
          .then(function(db) {
            clientHubClient = hubclient.HubClient(fakeHubUrl, db);
            clientManager = interchangeclient.ConnectionManager(clientHubClient, '0.0.0', 'unittest');
          })
      });
  })

  afterEach(function() {
    eyes.close();
  })

  function _GenerateUserKey() {
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
  function RegisterUser(nick) {
    var key = _GenerateUserKey();
    userKeys[nick] = key;
    return clientHubClient.RegisterUserProfile({
        nick: nick,
        interchangeUrl: server.serverUrl,
        pubkey: key.toPublicPem('utf8'),
        about: 'I am ' + nick,
        updatedAt: BEFORE_NOW
    }, key.toPrivatePem('utf8'));
  }

  /** Sends a new UserProfile to the fake Hub, then sends a POST to vox://<nick>/profile */
  function UpdateUserProfile(stanza) {
    var key = userKeys[stanza.nick];
    authentication.SignUserProfileStanza(stanza, key);
    return clientHubClient.RegisterUserProfile(stanza, key.toPrivatePem('utf8'))
      .then(function(userProfile) {
        return clientManager.Connect(userProfile.nick, userProfile.nick)
          .then(function(conn) {
            return conn.POST('vox://' + userProfile.nick + '/profile', userProfile);
          })
          .then(function(reply) {
            assert.equal(reply.status, 200);
            assert(!!reply.userProfile);
            return reply.userProfile;
          })
      });
  }

  /** Opens a connection and sends SESSION. */
  function EstablishSession(source, nick) {
    return clientManager.Connect(source, nick)
      .then(function(conn) {
        if (conn.sessionId) {
          return conn;
        }
        return conn.SESSION().return(conn);
      });
  }

  /** Sets up a route on vox://<source> for `routeUrl` */
  function EstablishRoute(source, routeUrl) {
    return EstablishSession(source, source)
      .then(function(conn) {
        var stanza = {
            routeUrl: routeUrl,
            weight: 1,
            updatedAt: NOW
        };
        return conn.POST('vox://' + source + '/session/' + conn.sessionId + '/routes', stanza)
          .then(function(reply) {
            assert.equal(reply.status, 200);
            assert(!!reply.route);
            return reply.route;
          });
      });
  }

  /** Sends POST to vox://<source>/messages */
  function PostMessage(source, stanza) {
    return clientManager.Connect(source, stanza.author)
      .then(function(conn) {
        authentication.SignMessageStanza(stanza, userKeys[stanza.author]);
        return conn.POST('vox://' + source + '/messages', stanza);
      })
      .then(function(reply) {
        assert.equal(reply.status, 200);
        assert(!!reply.message);
        return reply.message;
      });
  }

  /** Sends POST to vox://<source>/subscribers */
  function PostSubscription(source, stanza) {
    return clientManager.Connect(source, stanza.nick)
      .then(function(conn) {
        authentication.SignSubscriptionStanza(stanza, userKeys[stanza.nick]);
        return conn.POST('vox://' + source + '/subscribers', stanza);
      })
      .then(function(reply) {
        assert.equal(reply.status, 200);
        assert(!!reply.subscription);
        return reply.subscription;
      })
  }

  /** Sends POST to vox://<source>/status */
  function PostUserStatus(source, stanza) {
    return clientManager.Connect(source, stanza.nick)
      .then(function(conn) {
        authentication.SignUserStatusStanza(stanza, userKeys[stanza.nick]);
        return conn.POST('vox://' + source + '/status', stanza);
      })
      .then(function(reply) {
        assert.equal(reply.status, 200);
        assert(!!reply.userStatus);
        return reply.userStatus;
      })
  }

  /** Sends GET to vox://<source>/messages */
  function ListMessages(source, url) {
    url = url ? url : 'vox://' + source + '/messages';
    return clientManager.Connect(source, source)
      .then(function(conn) {
        return conn.GET(url, { limit: 10 });
      })
      .then(function(reply) {
        assert.equal(reply.status, 200);
        assert(!!reply.messages);
        return reply.messages;
      });
  }

  function ListSubscriptions(source) {
    return clientManager.Connect(source, source)
      .then(function(conn) {
        return conn.GET('vox://' + source + '/subscriptions', { limit: 10 });
      })
      .then(function(reply) {
        assert.equal(reply.status, 200);
        assert(!!reply.subscriptions);
        return reply.subscriptions;
      });
  }

  function ListSubscribers(source, url) {
    return clientManager.Connect(source, source)
      .then(function(conn) {
        return conn.GET(url + '/subscribers', { limit: 10 });
      })
      .then(function(reply) {
        assert.equal(reply.status, 200);
        assert(!!reply.subscriptions);
        return reply.subscriptions;
      });
  }


  ////////////////
  // Test cases //
  ////////////////

  it('accepts POST to /messages', function() {
    return RegisterUser('tester')
      .then(function() {
        return PostMessage('tester', { author: 'tester', text: 'hi there!', updatedAt: NOW });
      })
      .then(function() {
        return ListMessages('tester');
      })
      .then(function(messages) {
        assert.equal(messages.length, 1);
        assert.equal(messages[0].text, 'hi there!');
      });
  })

  it('lists only the messages from a source', function() {
    return P.all([RegisterUser('a'), RegisterUser('b')])
      .then(function() {
        return P.all([
            PostMessage('a', { author: 'a', text: 'hi there!', updatedAt: NOW }),
            PostMessage('b', { author: 'b', text: 'hi there!', updatedAt: NOW })
        ]);
      })
      .then(function() {
        return ListMessages('a');
      })
      .then(function(messages) {
        assert.equal(messages.length, 1);
        assert.equal(messages[0].author, 'a');
      });
  })

  it('lists replies to a message', function() {
    return P.all([RegisterUser('a')])
      .then(function() {
        return PostMessage('a', { author: 'a', text: 'first', updatedAt: NOW });
      })
      .then(function(message) {
        var messageUrl = message.messageUrl;
        return P.all([
            PostMessage('a', { author: 'a', text: 'second', updatedAt: NOW, replyTo: messageUrl }),
            PostMessage('a', { author: 'a', text: 'third', updatedAt: NOW + 1, replyTo: messageUrl }),
            PostMessage('a', { author: 'a', text: 'fourth', updatedAt: NOW + 2 })
        ])
        .then(function() {
          return ListMessages('a', messageUrl + '/replies');
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
    return P.all([RegisterUser('a')])
      .then(function() {
        return PostMessage('a', { author: 'a', text: 'first', updatedAt: NOW });
      })
      .then(function(message) {
        var thread = message.messageUrl;
        return PostMessage('a', { author: 'a', text: 'second', updatedAt: NOW + 1, replyTo: thread });
      })
      .then(function(reply1) {
        return PostMessage('a', { author: 'a', text: 'third', updatedAt: NOW + 2, thread: reply1.thread });
      })
      .then(function(reply2) {
        return ListMessages('a', reply2.thread + '/thread');
      })
      .then(function(messages) {
        assert.equal(messages.length, 2);
        messages.sort(function(a, b) { return a.updatedAt - b.updatedAt });
        assert.equal(messages[0].text, 'second');
        assert.equal(messages[1].text, 'third');
      })
  });

  it('forwards MESSAGEs to routes', function(done) {
    clientManager.on('MESSAGE', function(message) {
      assert.equal('sender', message.author);
      assert.equal(NOW, message.updatedAt);
      assert.equal('hi from sender', message.text);
      done();
    });

    P.all([RegisterUser('sender')])
      .then(function() {
        return EstablishRoute('sender', 'vox://sender/messages');
      })
      .then(function() {
        return PostMessage('sender', { author: 'sender', text: 'hi from sender', updatedAt: NOW});
      })
      .catch(function(err) {
        done(err);
      });
  });

  it('forwards SUBSCRIPTIONs to routes', function(done) {
    clientManager.on('SUBSCRIPTION', function(subscription) {
      assert.equal('sender', subscription.nick);
      assert.equal(NOW, subscription.updatedAt);
      assert.equal('vox://other/messages', subscription.subscriptionUrl);
      done();
    });

    P.all([RegisterUser('sender'), RegisterUser('other')])
      .then(function() {
        return EstablishRoute('sender', 'vox://sender/subscriptions');
      })
      .then(function() {
        return PostSubscription('sender', { nick: 'sender', subscriptionUrl: 'vox://other/messages', weight: 1, updatedAt: NOW });
      })
      .catch(function(err) {
        done(err);
      });
  })

  it('forwards USER_STATUSes to routes', function(done) {
    clientManager.on('USER_STATUS', function(userStatus) {
      assert.equal('sender', userStatus.nick);
      assert.equal(NOW, userStatus.updatedAt);
      assert.equal('I am fine', userStatus.statusText);
      done();
    });

    P.all([RegisterUser('sender')])
      .then(function() {
        return EstablishRoute('sender', 'vox://sender/status');
      })
      .then(function() {
        return PostUserStatus('sender', { nick: 'sender', statusText: 'I am fine', updatedAt: NOW });
      })
      .catch(function(err) {
        done(err);
      });
  })

  it('forwards USER_PROFILEs to routes', function(done) {
    clientManager.on('USER_PROFILE', function(userProfile) {
      assert.equal('sender', userProfile.nick);
      assert.equal(NOW, userProfile.updatedAt);
      assert.equal('I am about', userProfile.about);
      done();
    });

    P.all([RegisterUser('sender')])
      .then(function() {
        return EstablishRoute('sender', 'vox://sender/profile');
      })
      .then(function() {
        return UpdateUserProfile({
            nick: 'sender',
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
  //   return P.all([RegisterUser('sender')])
  //     .then(function() {
  //       return EstablishRoute('sender', 'vox://sender/messages');
  //     })
  //     .then(function() {
  //       return PostMessage('sender', { author: 'sender', text: 'hi from sender', updatedAt: NOW});
  //     })
  //     .then(function() {
  //       return clientManager.Connect('sender', 'sender');
  //     })
  //     .then(function(conn) {
  //       conn.Close();
  //       return PostMessage('sender', { author: 'sender', text: 'hi from sender', updatedAt: NOW});
  //     })
  //     .catch(function(err) {
  //       done(err);
  //     });
  // });

  it('lists subscribers for a source', function() {
    return P.all([RegisterUser('tester'), RegisterUser('other')])
      .then(function() {
        return P.all([
            PostSubscription('tester', { nick: 'tester', subscriptionUrl: 'vox://tester/messages', weight: 1, updatedAt: NOW }),
            PostSubscription('tester', { nick: 'tester', subscriptionUrl: 'vox://tester/status', weight: 1, updatedAt: NOW + 1 }),
            PostSubscription('tester', { nick: 'tester', subscriptionUrl: 'vox://tester/profile', weight: 1, updatedAt: NOW + 2 }),
            PostSubscription('tester', { nick: 'other', subscriptionUrl: 'vox://tester/messages', weight: 1, updatedAt: NOW + 3}),
            PostSubscription('tester', { nick: 'other', subscriptionUrl: 'vox://tester/profile', weight: 1, updatedAt: NOW + 4 })
        ])
      })
      .then(function() {
        return ListSubscriptions('tester');
      })
      .then(function(subscriptions) {
        assert.equal(subscriptions.length, 3);
        subscriptions.sort(function(a, b) { return a.updatedAt - b.updatedAt });
        assert(subscriptions[0].subscriptionUrl.endsWith('/messages'));
        assert(subscriptions[1].subscriptionUrl.endsWith('/status'));
        assert(subscriptions[2].subscriptionUrl.endsWith('/profile'));
      });
  })

  it('lists subscribers to a URL', function() {
    var URL_OF_INTEREST = 'vox://tester/messages';
    return P.all([RegisterUser('tester'), RegisterUser('other')])
      .then(function() {
        return P.all([
            PostSubscription('tester', { nick: 'tester', subscriptionUrl: URL_OF_INTEREST, weight: 1, updatedAt: NOW }),
            PostSubscription('tester', { nick: 'tester', subscriptionUrl: 'vox://tester/status', weight: 1, updatedAt: NOW + 1 }),
            PostSubscription('tester', { nick: 'tester', subscriptionUrl: 'vox://tester/profile', weight: 1, updatedAt: NOW + 2 }),
            PostSubscription('tester', { nick: 'other', subscriptionUrl: URL_OF_INTEREST, weight: 1, updatedAt: NOW + 3 }),
            PostSubscription('tester', { nick: 'other', subscriptionUrl: 'vox://tester/profile', weight: 1, updatedAt: NOW + 4 })
        ])
      })
      .then(function() {
        return ListSubscribers('tester', URL_OF_INTEREST);
      })
      .then(function(subscriptions) {
        assert.equal(subscriptions.length, 2);
        subscriptions.sort(function(a, b) { return a.updatedAt - b.updatedAt });
        assert.equal(subscriptions[0].subscriptionUrl, URL_OF_INTEREST);
        assert.equal(subscriptions[1].subscriptionUrl, URL_OF_INTEREST);
        assert.equal(subscriptions[0].nick, 'tester');
        assert.equal(subscriptions[1].nick, 'other');
      });
  })
})
