/**
 * Integration test for VoxClient.
 */

// TODO This is a skeleton.


var assert = require('assert');
var eyes = require('vox-common/eyes');
var fakehub = require('vox-common/test/fakehub');
var hubclient = require('vox-common/hubclient');
var interchangedb = require('vox-server/interchangedb');
var interchangeserver = require('vox-server/interchangeserver');
var P = require('bluebird');
var temp = require('temp');
var urlparse = require('url');
var ursa = require('ursa');
var VoxClient = require('../vox-client');


temp.track(); // Delete temp files.


describe('VoxClient', function() {
  var NICK = 'testvox';

  var BEFORE_NOW = Date.now()
  var NOW = BEFORE_NOW + 1;
  var AFTER_NOW = NOW + 1;

  var userKeys = {};
  var _cachedUserKeys = [];
  var _availableUserKeys = [];

  var fakeHub;
  var fakeHubUrl;
  var hubClient;
  var server;
  var client;
  var friendClient;

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

    return _createHubClient()
      .then(function(hc) {
        hubClient = hc;
        return createServer()
      })
      .then(function(s) {
        server = s;
        return P.all([registerUser(NICK), registerUser('friend')]);
      })
      .then(function() {
        client = createClient(NICK, server.interchangeUrl);
        friendClient = createClient('friend', server.interchangeUrl);
        return P.all([client.connect(), friendClient.connect()]);
      });
  });

  afterEach(function() {
    eyes.close();
    client.close();
    friendClient.close();
  })

  function _createHubClient() {
    return interchangedb.openDb({
        dbFile: temp.path(),
        streamDbDir: temp.path(),
        minTargetCacheRefreshMs: 0
    })
    .then(function(db) {
      return hubclient.HubClient(fakeHubUrl, db);
    });
  }

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
    return hubClient.registerUserProfile({
        nick: nick,
        interchangeUrl: server.serverUrl,
        pubkey: key.toPublicPem('utf8'),
        about: 'I am ' + nick,
        updatedAt: BEFORE_NOW
    }, key.toPrivatePem('utf8'));
  }

  function createClient(nick, interchangeUrl) {
    return new VoxClient({
        nick: nick,
        profilesDir: temp.path(),
        config: {
            nick: nick,
            privkey: userKeys[nick].toPrivatePem('utf8'),
            interchangeUrl: interchangeUrl,
        },
        hubUrl: fakeHubUrl
    });
  }

  function createServer() {
    return interchangedb.openDb({
          dbFile: temp.path(),
          streamDbDir: temp.path(),
          minTargetCacheRefreshMs: 0
      })
      .then(function(db) {
        return interchangeserver.CreateInterchangeServer(0, 0, hubClient, db);
      })
  }

  function postInOrder(client, var_args) {
    var stanzas = Array.prototype.slice.call(arguments, 1);
    return P.each(stanzas, function(stanza) {
      return client.post(stanza);
    })
  }

  function expectStream(done, var_args) {
    var expectedStanzas = Array.prototype.slice.call(arguments, 1);
    return function(stanza) {
      try {
        var expectedStanza = expectedStanzas.shift();
        if (expectedStanza.seq) {
          assert.equal(stanza.seq, expectedStanza.seq);
        }
        if (expectedStanza.stream) {
          assert.equal(stanza.stream, expectedStanza.stream);
        }
        if (expectedStanza.text) {
          assert.equal(stanza.text, expectedStanza.text);
        }
      } catch (e) {
        done(e);
      }
      if (!expectedStanzas.length) {
        done();
      }
    }
  }

  function expectStreamAnyOrder(done, var_args) {
    function compareText(a, b) { return a.text.localeCompare(b.text); };
    var expectedStanzas = Array.prototype.slice.call(arguments, 1);
    expectedStanzas.sort(compareText);
    var stanzas = [];
    return function(stanza) {
      try {
        stanzas.push(stanza);
        if (stanzas.length < expectedStanzas.length) {
          return;
        }
        if (stanzas.length > expectedStanzas.length) {
          done(new Error('More stanzas than expected!'));
        }
        stanzas.sort(compareText);
        for (var i = 0; i < stanzas.length; i++) {
          var expectedStanza = expectedStanzas[i];
          var stanza = stanzas[i];
          if (expectedStanza.seq) {
            assert.equal(stanza.seq, expectedStanza.seq);
          }
          if (expectedStanza.stream) {
            assert.equal(stanza.stream, expectedStanza.stream);
          }
          if (expectedStanza.text) {
            assert.equal(stanza.text, expectedStanza.text);
          }
        }
        done();
      } catch (e) {
        done(e);
      }
    }
  }

  ////////////////
  // Test cases //
  ////////////////

  it('subscribes', function(done) {
    client.connectionManager.on('STANZA', function(message) {
      assert.equal('hello', message.text);
      assert.equal('friend', message.nick);
      assert.equal('friend', message.stream);
      done();
    })
    client.subscribe('friend')
      .then(function() {
        return friendClient.post({ stream: 'friend', text: 'hello' });
      })
      .catch(done);
  })

  it('syncs from beginning', function(done) {
    return postInOrder(
          friendClient,
          { text: 'hello 1' },
          { text: 'hello 2' },
          { text: 'hello 3' })
      .then(function() {
        return client.subscribe('friend');
      })
      .then(function() {
        var stream = client.createReadStream({ stream: 'friend', seqStart: 1 });
        stream.on('data', expectStream(done,
          { seq: 1, text: 'hello 1' },
          { seq: 2, text: 'hello 2' },
          { seq: 3, text: 'hello 3' }));
      })
      .catch(done);
  })

  it('syncs from seqStart', function(done) {
    return postInOrder(
          friendClient,
          { text: 'hello 1' },
          { text: 'hello 2' },
          { text: 'hello 3' })
      .then(function() {
        return client.subscribe('friend');
      })
      .then(function() {
        var stream = client.createReadStream({ stream: 'friend', seqStart: 2 });
        var stanzas = [];
        stream.on('data', expectStream(done,
          { seq: 2, text: 'hello 2' },
          { seq: 3, text: 'hello 3' }));
      })
      .catch(done);
  })

  it('resyncs after disconnect', function(done) {
    return client.subscribe('friend')
      .then(function() {
        return postInOrder(friendClient,
          { text: 'hello 1' },
          { text: 'hello 2' })
      })
      .then(function() {
        // Sync up through 'hello 2'.
        return client.fetchStanzas('vox:friend', 1, 2);
      })
      .then(function() {
        // Disconnect, and post while subscriber is disconnected.
        client.close();
        return friendClient.post({ text: 'hello 3' });
      })
      .then(function() {
        return client.connect();
      })
      .then(function() {
        var stream = client.createReadStream({
            stream: 'friend',
            seqStart: 3
        });
        stream.on('data', expectStream(done,
          { seq: 3, text: 'hello 3' },
          { seq: 4, text: 'hello 4' }));
        return friendClient.post({ text: 'hello 4' });
      })
      .catch(done);
  })

  it('.createReadStream() loads from checkpoints', function(done) {
    return client.subscribe('friend')
      .then(function() {
        return postInOrder(friendClient,
            { text: 'hello 1' },
            { text: 'hello 2' },
            { text: 'hello 3' },
            { text: 'hello 4' });
      })
      .then(function() {
        return client.db.setClientCheckpoint('checkkey', 'friend', 2);
      })
      .then(function() {
        client.createReadStream({
            checkpointKey: 'checkkey',
            stream: 'friend'
        })
        .on('data', expectStream(done,
            { seq: 3, text: 'hello 3' },
            { seq: 4, text: 'hello 4' }));
      })
  })

  it('.createReadStream() aggregates streams', function(done) {
    return P.all([
          client.subscribe('friend/a'),
          client.subscribe('friend/b'),
          client.subscribe('friend/c')
      ])
      .then(function() {
        return postInOrder(friendClient,
            { stream: 'friend/a', text: 'hello 1' },
            { stream: 'friend/b', text: 'hello 2' },
            { stream: 'friend/c', text: 'hello 3' },
            { stream: 'friend/d', text: 'hello 4' });
      })
      .then(function() {
        var stanzas = [];
        client.createReadStream({ seqStart: 1 })
          .on('data', expectStream(done,
            { text: 'hello 1' },
            { text: 'hello 2' },
            { text: 'hello 3' }));
      })
  })

  it('.createReadStream() aggregates new stream', function(done) {
    return P.all([
          client.subscribe('friend/old'),
          client.subscribe('friend/new')
      ])
      .then(function() {
        return postInOrder(friendClient,
            { stream: 'friend/old', text: 'hello 1' },
            { stream: 'friend/old', text: 'hello 2' })
      })
      .then(function() {
        var stanzas = [];
        client.createReadStream({ seqStart: 1 })
          .on('data', expectStream(done,
            { text: 'hello 1' },
            { text: 'hello 2' },
            { text: 'hello new' }));
        friendClient.post({ stream: 'friend/new', text: 'hello new' });
      })
  })

  it('.createReadStream() only reads live stanzas', function(done) {
    return P.all([
          client.subscribe('friend/a'),
          client.subscribe('friend/b')
      ])
      .then(function() {
        return postInOrder(friendClient,
            { stream: 'friend/a', text: 'unseen 1' },
            { stream: 'friend/b', text: 'unseen 2' })
      })
      .then(function() {
        return P.all([
            client.fetchStanzas('vox:friend/a', 1, 2),
            client.fetchStanzas('vox:friend/b', 1, 2)
        ])
      })
      .then(function() {
        var stanzas = [];
        client.createReadStream()
          .on('data', expectStreamAnyOrder(done,
            { text: 'hello 1' },
            { text: 'hello 2' },
            { text: 'hello 3' },
            { text: 'hello 4' }));
        return P.delay(50); // TODO createReadStream may take some time to init.
      })
      .then(function() {
        return postInOrder(friendClient,
            { stream: 'friend/a', text: 'hello 1' },
            { stream: 'friend/b', text: 'hello 2' },
            { stream: 'friend/a', text: 'hello 3' },
            { stream: 'friend/b', text: 'hello 4' });
      })
  })

  it('.subscribe() updates merged streams', function(done) {
    client.createReadStream({ seqStart: 1 })
      .on('data', expectStream(done,
          { text: 'hello 1' },
          { text: 'hello 2' }))
    return postInOrder(friendClient, { stream: 'friend/a', text: 'hello 1' })
      .then(function() {
        return client.subscribe('friend/a');
      })
      .then(function() {
        return friendClient.post({ stream: 'friend/a', text: 'hello 2' });
      })
  })

  it('.unsubscribe() updates merged streams', function(done) {
    return postInOrder(friendClient, { stream: 'friend/a', text: 'hello 1' })
      .then(function() {
        return client.subscribe('friend/a');
      })
      .then(function() {
        return new P(function(resolve) {
          client.createReadStream({ seqStart: 1 })
            .on('data', expectStream(done,
                { text: 'hello 1' }))
            .once('data', resolve);
        })
      })
      .then(function() {
        return client.unsubscribe('friend/a');
      })
      .then(function() {
        return postInOrder(friendClient, { stream: 'friend/a', text: 'hello 2' })
          .delay(50); // Meh.
      })
  })
})

