/**
 * Integration test for InterchangeDb.
 */

// TODO This is a skeleton.


var assert = require('assert');
var interchangedb = require('../interchangedb');
var P = require('bluebird');
var temp = require('temp');


temp.track(); // Delete temp files.


describe('interchangedb', function() {
  var BEFORE_NOW = new Date().getTime()
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
})
