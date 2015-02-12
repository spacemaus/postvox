/**
 * Integration test for InterchangeDb.
 */

// TODO This is a skeleton.


var assert = require('assert');
var moreAsserts = require('vox-common/test/more-asserts');
var interchangedb = require('../interchangedb');
var P = require('bluebird');
var temp = require('temp');


temp.track(); // Delete temp files.


describe('interchangedb', function() {
  var BEFORE_NOW = Date.now()
  var NOW = BEFORE_NOW + 1;
  var AFTER_NOW = NOW + 1;

  var db;

  beforeEach(function() {
    return interchangedb.openDb({ dbFile: temp.path(), streamDbDir: temp.path() })
      .then(function(newDb) {
        db = newDb;
      })
  });

  afterEach(function() {
    db.close();
  })


  //////////////////////
  // Helper functions //
  //////////////////////

  function appendMessage(text, author, stream, syncedAt) {
    return db.appendStanza({
        type: 'MESSAGE',
        text: text,
        nick: author,
        stream: stream,
        syncedAt: syncedAt,
    }, true);
  }

  ////////////////
  // Test cases //
  ////////////////

  it('scans message author index', function() {
    return P.all([
          appendMessage('aaa1', 'aaa', 'bbb/friends', 1),
          appendMessage('aaa2', 'aaa', 'bbb/friends', 2),
          appendMessage('aaa3', 'aaa', 'bbb/friends', 3),
          appendMessage('aaab', 'aaab', 'bbb/friends', 2),
      ])
      .then(function() {
        return db.listStanzas({ stream: 'bbb/friends', nick: 'aaa' });
      })
      .then(function(messages) {
        assert.equal(3, messages.length);
        assert.equal('aaa1', messages[0].text);
        assert.equal('aaa2', messages[1].text);
        assert.equal('aaa3', messages[2].text);
      });
  })

  it('limits scans to seq range', function() {
    return P.all([
          appendMessage('aaa1', 'aaa', 'bbb/friends', 1),
          appendMessage('aaa2', 'aaa', 'bbb/friends', 2),
          appendMessage('aaa3', 'aaa', 'bbb/friends', 3),
      ])
      .then(function() {
        return db.listStanzas({
            stream: 'bbb/friends',
            'author': 'aaa',
            seqStart: 2,
            seqLimit: 3
        });
      })
      .then(function(messages) {
        assert.equal(1, messages.length);
        assert.equal('aaa2', messages[0].text);
      });
  })

  it('assigns seq numbers', function() {
    return appendMessage('aaa1', 'aaa', 'aaa/friends', 1)
      .then(appendMessage.bind(null, 'aaa2', 'aaa', 'aaa/friends', 2))
      .then(appendMessage.bind(null, 'aaa3', 'aaa', 'bbb/friends', 3))
      .then(appendMessage.bind(null, 'aaa4', 'aaa', 'bbb/friends', 4))
      .then(db.listStanzas.bind(db, { stream: 'aaa/friends' }))
      .then(function(messages) {
        assert.equal(2, messages.length);
        assert.equal('aaa1', messages[0].text);
        assert.equal(1, messages[0].seq);
        assert.equal('aaa2', messages[1].text);
        assert.equal(2, messages[1].seq);
      })
      .then(db.listStanzas.bind(db, { stream: 'bbb/friends' }))
      .then(function(messages) {
        assert.equal(2, messages.length);
        assert.equal('aaa3', messages[0].text);
        assert.equal(1, messages[0].seq);
        assert.equal('aaa4', messages[1].text);
        assert.equal(2, messages[1].seq);
      });
  })

  it('loads seq numbers from the db', function() {
    return appendMessage('aaa1', 'aaa', 'aaa/friends', 1)
      .then(function() {
        var config = { dbFile: db.dbFile, streamDbDir: db.streamDbDir };
        db.close();
        return interchangedb.openDb(config);
      })
      .then(function(newDb) {
        db = newDb;
        return appendMessage('aaa2', 'aaa', 'aaa/friends', 2);
      })
      .then(function() {
        return db.listStanzas({
            stream: 'aaa/friends'
        });
      })
      .then(function(messages) {
        assert.equal(2, messages.length);
        assert.equal('aaa1', messages[0].text);
        assert.equal(1, messages[0].seq);
        assert.equal('aaa2', messages[1].text);
        assert.equal(2, messages[1].seq);
      });
  })

  it('lists messages with seqStart', function() {
    return P.all([
        appendMessage('hi1', 'author', 'bbb/friends', 1),
        appendMessage('hi2', 'author', 'bbb/friends', 2),
        appendMessage('hi3', 'author', 'bbb/friends', 3),
        appendMessage('hi4', 'author', 'bbb/friends', 4),
        appendMessage('hi5', 'author', 'bbb/friends', 5),
      ])
      .then(function() {
        return db.listStanzas({
            stream: 'bbb/friends',
            seqStart: 3,
            limit: 2
        });
      })
      .then(function(messages) {
        assert.equal(2, messages.length);
        assert.equal('hi3', messages[0].text);
        assert.equal('hi4', messages[1].text);
      })
  })

  it('lists messages with seqLimit and reverse', function() {
    return P.all([
        appendMessage('hi1', 'author', 'bbb/friends', 1),
        appendMessage('hi2', 'author', 'bbb/friends', 2),
        appendMessage('hi3', 'author', 'bbb/friends', 3),
        appendMessage('hi4', 'author', 'bbb/friends', 4),
        appendMessage('hi5', 'author', 'bbb/friends', 5),
      ])
      .then(function() {
        return db.listStanzas({
            stream: 'bbb/friends',
            seqLimit: 4,
            limit: 2,
            reverse: true
        });
      })
      .then(function(messages) {
        assert.equal(2, messages.length);
        assert.equal('hi3', messages[0].text);
        assert.equal('hi2', messages[1].text);
      })
  })

  it('refreshes target cache on session reconnect', function() {
    return P.all([
          db.createSession({ sessionId: 's1', isConnected: true }),
          db.createSession({ sessionId: 's2', isConnected: true }),
          db.insertRoute({ routeUrl: 'url1', sessionId: 's1', weight: 1 }),
          db.insertRoute({ routeUrl: 'url1', sessionId: 's2', weight: 1 }),
      ])
      .then(db.forTargetSessionIds.bind(db, 'url1', function() {})) // Fill the cache.
      .then(function(sessionIds) {
        moreAsserts.sortedArraysEqual(['s1', 's2'], sessionIds);
        db.uncacheTargetSessionId('url1', 's1');
        return db.setSessionConnected({ sessionId: 's1', isConnected: false })
      })
      .then(db.forTargetSessionIds.bind(db, 'url1', function() {}, true))
      .then(function(sessionIds) {
        moreAsserts.sortedArraysEqual(['s2'], sessionIds);
        return db.setSessionConnected({ sessionId: 's1', isConnected: true });
      })
      .then(db.forTargetSessionIds.bind(db, 'url1', function() {}, true))
      .then(function(sessionIds) {
        moreAsserts.sortedArraysEqual(['s1', 's2'], sessionIds);
      });
  })
})
