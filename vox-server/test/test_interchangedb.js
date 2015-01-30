/**
 * Integration test for InterchangeDb.
 */

// TODO This is a skeleton.


var assert = require('assert');
var moreAsserts = require('./more-asserts');
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
    return interchangedb.OpenDb({ dbFile: temp.path(), messageDbDir: temp.path() })
      .then(function(newDb) {
        db = newDb;
      })
  });

  afterEach(function() {
    db.Close();
  })


  //////////////////////
  // Helper functions //
  //////////////////////

  function insertMessage(messageUrl, author, source, syncedAt) {
    return db.InsertMessage({
        messageUrl: messageUrl,
        author: author,
        source: source,
        syncedAt: syncedAt,
    }, true);
  }

  ////////////////
  // Test cases //
  ////////////////

  it('scans message author index', function() {
    return P.all([
          insertMessage('aaa1', 'aaa', 'source', 1),
          insertMessage('aaa2', 'aaa', 'source', 2),
          insertMessage('aaa3', 'aaa', 'source', 3),
          insertMessage('aaab', 'aaab', 'source', 2),
      ])
      .then(function() {
        return db.ListMessages({ source: 'source', 'author': 'aaa' });
      })
      .then(function(messages) {
        assert.equal(3, messages.length);
        assert.equal('aaa3', messages[0].messageUrl);
        assert.equal('aaa2', messages[1].messageUrl);
        assert.equal('aaa1', messages[2].messageUrl);
      });
  })

  it('limits scans to syncedAt range', function() {
    return P.all([
          insertMessage('aaa1', 'aaa', 'source', 1),
          insertMessage('aaa2', 'aaa', 'source', 2),
          insertMessage('aaa3', 'aaa', 'source', 3),
      ])
      .then(function() {
        return db.ListMessages({
            source: 'source',
            'author': 'aaa',
            syncedBefore: 2.5,
            syncedAfter: 1.5
        });
      })
      .then(function(messages) {
        assert.equal(1, messages.length);
        assert.equal('aaa2', messages[0].messageUrl);
      });
  })

  it('assigns seq numbers', function() {
    return insertMessage('aaa1', 'aaa', 'aaa', 1)
      .then(insertMessage.bind(null, 'aaa2', 'aaa', 'aaa', 2))
      .then(insertMessage.bind(null, 'aaa3', 'aaa', 'bbb', 3))
      .then(insertMessage.bind(null, 'aaa4', 'aaa', 'bbb', 4))
      .then(db.ListMessages.bind(db, { source: 'aaa' }))
      .then(function(messages) {
        assert.equal(2, messages.length);
        assert.equal('aaa2', messages[0].messageUrl);
        assert.equal(2, messages[0].seq);
        assert.equal('aaa1', messages[1].messageUrl);
        assert.equal(1, messages[1].seq);
      })
      .then(db.ListMessages.bind(db, { source: 'bbb' }))
      .then(function(messages) {
        assert.equal(2, messages.length);
        assert.equal('aaa4', messages[0].messageUrl);
        assert.equal(2, messages[0].seq);
        assert.equal('aaa3', messages[1].messageUrl);
        assert.equal(1, messages[1].seq);
      });
  })

  it('loads seq numbers from the db', function() {
    return insertMessage('aaa1', 'aaa', 'aaa', 1)
      .then(function() {
        var config = { dbFile: db.dbFile, messageDbDir: db.messageDbDir };
        db.Close();
        return interchangedb.OpenDb(config);
      })
      .then(function(newDb) {
        db = newDb;
        return insertMessage('aaa2', 'aaa', 'aaa', 2);
      })
      .then(function() {
        return db.ListMessages({
            source: 'aaa'
        });
      })
      .then(function(messages) {
        assert.equal(2, messages.length);
        assert.equal('aaa2', messages[0].messageUrl);
        assert.equal(2, messages[0].seq);
        assert.equal('aaa1', messages[1].messageUrl);
        assert.equal(1, messages[1].seq);
      });
  })

  it('lists messages with seqAfter', function() {
    return P.all([
        insertMessage('url1', 'author', 'source', 1),
        insertMessage('url2', 'author', 'source', 2),
        insertMessage('url3', 'author', 'source', 3),
        insertMessage('url4', 'author', 'source', 4),
        insertMessage('url5', 'author', 'source', 5),
      ])
      .then(function() {
        return db.ListMessages({
            source: 'source',
            seqAfter: 3,
            limit: 2
        });
      })
      .then(function(messages) {
        assert.equal(2, messages.length);
        assert.equal('url3', messages[0].messageUrl);
        assert.equal('url4', messages[1].messageUrl);
      })
  })

  it('refreshes target cache on session reconnect', function() {
    return P.all([
          db.NewSession({ sessionId: 's1', isConnected: true }),
          db.NewSession({ sessionId: 's2', isConnected: true }),
          db.InsertRoute({ routeUrl: 'url1', sessionId: 's1', weight: 1 }),
          db.InsertRoute({ routeUrl: 'url1', sessionId: 's2', weight: 1 }),
      ])
      .then(db.ForTargetSessionIds.bind(db, 'url1', function() {})) // Fill the cache.
      .then(function(sessionIds) {
        moreAsserts.sortedArraysEqual(['s1', 's2'], sessionIds);
        db.UncacheTargetSessionId('url1', 's1');
        return db.SetSessionConnected({ sessionId: 's1', isConnected: false })
      })
      .then(db.ForTargetSessionIds.bind(db, 'url1', function() {}, true))
      .then(function(sessionIds) {
        moreAsserts.sortedArraysEqual(['s2'], sessionIds);
        return db.SetSessionConnected({ sessionId: 's1', isConnected: true });
      })
      .then(db.ForTargetSessionIds.bind(db, 'url1', function() {}, true))
      .then(function(sessionIds) {
        moreAsserts.sortedArraysEqual(['s1', 's2'], sessionIds);
      });
  })
})
