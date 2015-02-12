var authentication = require('vox-common/authentication');
var Chain = require('vox-common/Chain');
var debug = require('debug')('vox:stanza-fetcher');
var errors = require('vox-common/errors');
var events = require('events');
var P = require('bluebird');
var util = require('util');
var voxurl = require('vox-common/voxurl');


/**
 * Fetches stanzas from interchange servers.  Also listens for interchange push
 * messages.
 */
function StanzaFetcher(db, getInterchangeSession) {
  var self = this;
  self.db = db;
  self.getInterchangeSession = getInterchangeSession;
  self._highWaterMarks = new Chain(self._fetchMostRecentStanzaSeq.bind(self));
  events.EventEmitter.call(this);
}
util.inherits(StanzaFetcher, events.EventEmitter);
module.exports = StanzaFetcher;


StanzaFetcher.prototype.getHighWaterMark = function(url) {
  return this._highWaterMarks.get(url);
}


StanzaFetcher.prototype.queueWithHighWaterMark = function(url, callback) {
  this._highWaterMarks.next(url, function(seqHighWaterMark) {
    callback(seqHighWaterMark);
    return seqHighWaterMark;
  })
}


StanzaFetcher.prototype.fetchStanzas = function(url, seqStart, limit) {
  debug('Reading stanzas from %s/%d', url, seqStart);
  var self = this;
  return self._highWaterMarks.get(url)
    .then(function(){
       return self.db.listStanzas({
          stream: voxurl.toStream(url),
          seqStart: seqStart,
          limit: limit
      })
    })
    .then(function(stanzas) {
      if (!stanzas.length) {
        debug('No stanzas in the DB from %s/%d', url, seqStart);
        return self._fetchGapFromNetwork(url, seqStart, limit);
      }
      var prevSeq = Math.max(0, seqStart - 1);
      // Ensure that we return only a continguous list of stanzas.
      for (var i = 0; i < stanzas.length; i++) {
        var stanza = stanzas[i];
        var ok = stanza.seq == prevSeq + 1 || stanza.prevSeq <= prevSeq;
        prevSeq = stanza.seq;
        if (!ok) {
          if (i == 0) {
            debug('Gap exists, fetch from %s/%d', url, seqStart);
            return self._fetchGapFromNetwork(url, seqStart, limit);
          } else {
            debug('Smaller set exists, fetch from %s/%d', url, prevSeq);
            self._fetchGapFromNetwork(url, prevSeq + 1, limit, stanza);
            return stanzas.slice(0, i);
          }
        }
      }
      debug('Read %d continguous stanzas from %s/%d', stanzas.length, url, seqStart);
      return stanzas;
    })
}


StanzaFetcher.prototype._fetchGapFromNetwork = function(url, seqStart, limit, nextStanza, reverse) {
  if (!this._highWaterMarks) {
    return [];
  }
  var self = this;
  var stream = voxurl.toStream(url);
  var stanzas;
  return self._highWaterMarks.next(url, function(seqHighWaterMark) {
    if (seqHighWaterMark && seqHighWaterMark <= seqStart) {
      debug('Not sending request since start is at or after high water mark %d vs %d', seqHighWaterMark, seqStart);
      stanzas = [];
      return seqHighWaterMark;
    }
    return self.getInterchangeSession(voxurl.toSource(url))
      .then(function(conn) {
        return conn.GET(url, {
            seqStart: seqStart,
            seqLimit: nextStanza ? nextStanza.seq : undefined,
            reverse: !!reverse,
            limit: limit
        })
        .then(function(reply) {
          stanzas = reply.stanzas;
          stanzas.sort(function(a, b) { return a.seq - b.seq; });
          var newHighWaterMark = Math.max(
              seqHighWaterMark, stanzas.length ? stanzas[stanzas.length - 1].seq : 0);
          debug('Advancing high water mark to %s/%d', url, newHighWaterMark);
          return self._insertCanonicalList(seqStart, stanzas)
            .return(newHighWaterMark);
        })
      })
  })
  .then(function() {
    return stanzas;
  });
}


StanzaFetcher.prototype.fetchMostRecentStanzas = function(url, limit) {
  debug('Fetching most recent stanzas from %s', url);
  return this._fetchGapFromNetwork(url, 1, limit, null, true)
    .then(function(stanzas) {
      if (!stanzas.length) {
        debug('No stanzas in %s', url);
        return;
      }
      debug('Most recent stanzas for %s from %d to %d', url, stanzas[0].seq, stanzas[stanzas.length - 1].seq);
    })
}


StanzaFetcher.prototype._fetchMostRecentStanzaSeq = function(url) {
  var self = this;
  return self.getInterchangeSession(voxurl.toSource(url))
    .then(function(conn) {
      return conn.GET(url, {
          reverse: true,
          limit: 1
      })
    })
    .then(function(reply) {
      var stanzas = reply.stanzas;
      if (!stanzas.length) {
        debug('Most recent stanza: %s/%d', url, seq);
        return 0;
      }
      var stanza = stanzas[0];
      var seq = stanza.seq;
      debug('Most recent stanza: %s/%d', url, seq);
      return self.db.insertStanza(stanza).return(seq);
    });
}


StanzaFetcher.prototype._insertCanonicalList = function(seqStart, stanzas) {
  var self = this;
  var prevSeq = undefined;
  return P.each(stanzas, function(stanza) {
    if (prevSeq) {
      stanza.prevSeq = prevSeq;
    }
    prevSeq = stanza.seq;
    return self.db.insertStanza(stanza);
  });
}


/**
 * Listens for stanza push messages.
 */
StanzaFetcher.prototype.attachListener = function(connectionManager, hubClient) {
  var self = this;
  connectionManager.on('STANZA', function(stanza) {
    return authentication.checkStanza(hubClient, stanza)
      .then(function() {
        if (!self._highWaterMarks) {
          return;
        }
        debug('Received STANZA %s/%d', stanza.stream, stanza.seq);
        var url = voxurl.toCanonicalUrl(stanza.stream);
        self._highWaterMarks.next(url, function(seqHighWaterMark) {
          if (!self.db) {
            return seqHighWaterMark;
          }
          return self.db.insertStanza(stanza)
            .then(function() {
              self.emit('STANZA', stanza);
              var newHighWaterMark = Math.max(seqHighWaterMark, stanza.seq);
              debug('Advancing high water mark from %d to %d',
                  seqHighWaterMark, newHighWaterMark);
              return newHighWaterMark;
            })
            .catch(function(err) {
              debug('Error', err, err.stack);
            });
        })
      })
      .catch(errors.AuthenticationError, function(err) {
        debug('Received invalid %s stanza, ignoring', stanza.type);
      })
  });
}


StanzaFetcher.prototype.close = function() {
  // TODO
  this.db = null;
  this.getInterchangeSession = null;
  this._highWaterMarks = null;
  this.removeAllListeners();
}
