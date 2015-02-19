/**
 * Test for Chain.
 */


var assert = require('assert');
var Chain = require('../chain');
var P = require('bluebird');


describe('chain', function() {
  it('runs sequentially', function(done) {
    var chain = new Chain(function(key) {
      return P.resolve('a');
    });
    chain.next('key', function(val) {
      return P.delay(10).return(val + 'b');
    });
    chain.next('key', function(val) {
      return val + 'c';
    });
    chain.next('key', function(val) {
      return P.resolve(val + 'd');
    });
    chain.next('key', function(val) {
      if (val == 'abcd') {
        done();
      } else {
        done(new Error('Bad val: ' + val));
      }
    });
  })

  it('handles static init values', function(done) {
    var chain = new Chain(function(key) {
      return 'a';
    });
    chain.next('key', function(val) {
      return val + 'b';
    });
    chain.next('key', function(val) {
      if (val == 'ab') {
        done();
      } else {
        done(new Error('Bad val: ' + val));
      }
    });
  })

  it('handles init Promise', function(done) {
    var chain = new Chain(function(key) {
      return P.delay(5).return('a');
    });
    chain.next('key', function(val) {
      return P.delay(5).return(val + 'b');
    });
    chain.next('key', function(val) {
      if (val == 'ab') {
        done();
      } else {
        done(new Error('Bad val: ' + val));
      }
    });
  })

  it('can chain from promise', function(done) {
    var chain = new Chain(function(key) {
      return P.delay(5).return('a');
    });
    chain.next('key', function(val) {
      return P.delay(5).return(val + 'b');
    })
    .then(function() {
      chain.next('key', function(val) {
        return val + 'c';
      });
      chain.next('key', function(val) {
        if (val == 'abc') {
          done();
        } else {
          done(new Error('Bad val: ' + val));
        }
      });
    });
  })

  it('is reentrant', function(done) {
    var chain = new Chain(function(key) {
      return P.resolve('a');
    });
    chain.next('key', function(val) {
      chain.next('key', function(val) {
        chain.next('key', function(val) {
          chain.next('key', function(val) {
            if (val == 'abcd') {
              done();
            } else {
              done(new Error('Bad val: ' + val));
            }
          })
          return val + 'd';
        });
        return val + 'c';
      });
      return val + 'b';
    });
  })
});
