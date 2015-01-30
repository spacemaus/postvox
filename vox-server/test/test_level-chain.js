/**
 * Integration test for LevelChain.
 */

// TODO More bullets to see if async operations are bullet-proof.


var assert = require('assert');
var LevelChain = require('../level-chain');
var levelup = require('level');
var P = require('bluebird');
var temp = require('temp');


temp.track(); // Delete temp files.


describe('level-chain', function() {
  var leveldb;
  var levelChain;

  beforeEach(function() {
    leveldb = levelup(temp.path(), { valueEncoding: 'json' });
    levelChain = new LevelChain(leveldb);
    P.promisifyAll(leveldb);
  });

  afterEach(function() {
    leveldb.close();
  });

  it('runs sequentially', function() {
    return P.all([
          levelChain.batch('a', function(batch, seq) {
            batch.put('one', 'one');
            batch.put('here', 'a1');
          }),
          levelChain.batch('a', function(batch, seq) {
            batch.put('one', 'two');
            batch.del('here');
          }),
          levelChain.batch('a', function(batch, seq) {
            batch.put('one', 'three');
            batch.put('here', 'a3');
          })
      ])
      .then(function() {
        return P.join(
          leveldb.getAsync('one'),
          leveldb.getAsync('here'),
          function(one, here) {
            assert.equal('three', one);
            assert.equal('a3', here);
          });
      });
  })

  it('assigns seq', function() {
    return P.all([
          levelChain.batch('a', function(batch, seq) {
            batch.put('one', seq);
          }),
          levelChain.batch('a', function(batch, seq) {
            batch.put('one', seq);
          })
      ])
      .then(function() {
        return leveldb.getAsync('one')
      })
      .then(function(v) {
        assert.equal(2, v);
        return leveldb.getAsync(levelChain.counterKeyPrefix + 'a');
      })
      .then(function(v) {
        assert.equal(2, v);
      })
  })

  it('rolls back seq on failure', function() {
    return P.settle([
          levelChain.batch('a', function(batch, seq) {
            batch.put('one', seq);
          }),
          levelChain.batch('a', function(batch, seq) {
            batch.put(null, null);
          }),
          levelChain.batch('a', function(batch, seq) {
            batch.put('one', seq);
          })
      ])
      .then(function() {
        return leveldb.getAsync('one')
      })
      .then(function(v) {
        assert.equal(2, v);
        return leveldb.getAsync(levelChain.counterKeyPrefix + 'a');
      })
      .then(function(v) {
        assert.equal(2, v);
      })
  })
})
