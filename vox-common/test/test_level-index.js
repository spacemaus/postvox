/**
 * Unittest for level-index.js.
 */

// TODO This is a skeleton.


var assert = require('assert');
var level = require('level');
var LevelChain = require('../level-chain');
var LevelIndex = require('../level-index');
var moreAsserts = require('./more-asserts');
var P = require('bluebird');
var temp = require('temp');


temp.track(); // Delete temp files.


describe('LevelIndex', function() {
  var db;
  var chain;

  beforeEach(function() {
    db = level(temp.path(), { valueEncoding: 'json' });
    P.promisifyAll(db);
    chain = new LevelChain(db);
  });

  afterEach(function() {
    db.close();
  })

  function getPk(object) {
    return object.pk;
  }

  it('.scan() works for prefix', function() {
    var index = new LevelIndex(getPk,
        [['first', 'f'], ['second', 's']]);
    return chain.batch('a', function(batch) {
        index.put(batch, { pk: 'one', first: 'one1', second: 'one2' });
        index.put(batch, { pk: 'two', first: 'two1', second: 'two2' });
      })
      .then(function() {
        return index.scan(db, { first: 'one1' })
      })
      .then(function(objs) {
        assert.equal(1, objs.length);
        assert.equal('one', objs[0].pk);
      });
  })

  it('.scan() works for range start', function() {
    var index = new LevelIndex(getPk,
        [['first', 'f'], ['second', 's', LevelIndex.toAsc]]);
    return chain.batch('a', function(batch) {
      index.put(batch, { pk: 'one', first: 'first', second: 100 });
      index.put(batch, { pk: 'two', first: 'first', second: 101 });
      index.put(batch, { pk: 'three', first: 'first', second: 102 });
    })
    .then(function() {
      return index.scan(db, { first: 'first', secondStart: 101 })
    })
    .then(function(objs) {
      assert.equal(2, objs.length);
      assert.equal(101, objs[0].second);
      assert.equal(102, objs[1].second);
    })
  })

  it('.scan() works for range limit', function() {
    var index = new LevelIndex(getPk,
        [['first', 'f'], ['second', 's', LevelIndex.toAsc]]);
    return chain.batch('a', function(batch) {
      index.put(batch, { pk: 'one', first: 'first', second: 100 });
      index.put(batch, { pk: 'two', first: 'first', second: 101 });
      index.put(batch, { pk: 'three', first: 'first', second: 102 });
    })
    .then(function() {
      return index.scan(db, { first: 'first', secondLimit: 102 })
    })
    .then(function(objs) {
      assert.equal(2, objs.length);
      assert.equal(100, objs[0].second);
      assert.equal(101, objs[1].second);
    })
  })

  it('.scan() works for range start and limit', function() {
    var index = new LevelIndex(getPk,
        [['first', 'f'], ['second', 's', LevelIndex.toAsc]]);
    return chain.batch('a', function(batch) {
      index.put(batch, { pk: 'one', first: 'first', second: 100 });
      index.put(batch, { pk: 'two', first: 'first', second: 101 });
      index.put(batch, { pk: 'three', first: 'first', second: 102 });
    })
    .then(function() {
      return index.scan(db, { first: 'first', secondStart: 101, secondLimit: 102 })
    })
    .then(function(objs) {
      assert.equal(1, objs.length);
      assert.equal(101, objs[0].second);
    })
  })

  it('.scan() picks correct index', function() {
    var index = new LevelIndex(getPk,
        [['first', 'f'], ['second', 's']],
        [['first', 'f'], ['third', 't']]);
    return chain.batch('a', function(batch) {
      index.put(batch, { pk: 'one', first: 'first', second: 'a', third: 'b' });
      index.put(batch, { pk: 'two', first: 'first', second: 'a', third: 'c' });
    })
    .then(function() {
      return index.scan(db, { first: 'first', third: 'c' })
    })
    .then(function(objs) {
      assert.equal(1, objs.length);
      assert.equal('two', objs[0].pk);
    })
  })

  it('.scan() omits prefix-indices', function() {
    var index = new LevelIndex(getPk,
        [['first', 'f']],
        [['first', 'f'], ['second', 's']]);
    return chain.batch('a', function(batch) {
      index.put(batch, { pk: 'one', first: 'first', second: 'a' });
      index.put(batch, { pk: 'two', first: 'first', second: 'a' });
    })
    .then(function() {
      return index.scan(db, { first: 'first' })
    })
    .then(function(objs) {
      assert.equal(2, objs.length);
      assert.equal('one', objs[0].pk);
      assert.equal('two', objs[1].pk);
    })
  })
})
