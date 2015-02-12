var Chain = require('vox-common/Chain');
var debug = require('debug')('vox:stanza-stream');
var P = require('bluebird');
var stream = require('stream');
var util = require('util');
var voxurl = require('vox-common/voxurl');


/**
 * Implements a Readable stream of stanzas.  Stanzas are guaranteed to be
 * delivered in `seq` order.
 */
var StanzaStream = module.exports = function(voxClient, options) {
  if (!options) {
    throw new Error('Must provide options!');
  }
  if (!options.stream) {
    throw new Error('Must specify a stream!');
  }
  this._voxClient = voxClient;
  this._type = options.type;
  this._stream = options.stream;
  this._url = voxurl.toCanonicalUrl(this._stream);
  this._checkpointKey = options.checkpointKey;
  this._seqInitCheckpoint = options.seqStart ? options.seqStart - 1 : 0;
  this._seqLimit = options.seqLimit;
  this._checkpointChain = new Chain(this._loadCheckpoint.bind(this));
  this._waitingForFirstPushMessage = !options.seqStart && !options.checkpointKey;
  this.isCaughtUp = this._waitingForFirstPushMessage;
  this._waitingForSeqStart = options.seqStart < 0;
  this._isReadReady = false;
  this._closed = false;
  this._batchMode = options.batchMode;
  this._batchSize = options.batchSize || 40;
  this._pushMetaStanzas = options.pushMetaStanzas;

  this._listener = this._handleStanza.bind(this);
  voxClient.on('STANZA', this._listener);
  voxClient.on('close', this.close.bind(this));

  stream.Readable.call(this, { objectMode: true });
}
util.inherits(StanzaStream, stream.Readable);


StanzaStream.prototype.close = function() {
  if (this._closed) {
    return;
  }
  debug('Closing stream');
  this._voxClient.removeListener('STANZA', this._listener);
  this._closed = true;
  this.emit('end');
}


StanzaStream.prototype._push = function(stanza) {
  if (this._closed) {
    return;
  }
  try {
    this._isReadReady = this.push(this._batchMode ? [stanza] : stanza);
    this._pushCaughtUpMeta(stanza.seq);
    if (stanza.seq >= this._seqLimit - 1) {
      this.close();
    }
  } catch (e) {
    console.error('Error during stream read:', e, e.stack);
  }
}


StanzaStream.prototype._pushBatch = function(stanzas) {
  var self = this;
  if (self._closed) {
    return;
  }
  if (self._batchMode) {
    var shouldClose = false;
    var maxSeq = 0;
    var batch = stanzas.filter(function(stanza) {
      if (stanza.seq >= self._seqLimit - 1) {
        shouldClose = true;
        return false;
      }
      maxSeq = Math.max(maxSeq, stanza.seq);
      return !(self._type && self._type != stanza.type);
    });
    try {
      self._isReadReady = self.push(batch);
      self._pushCaughtUpMeta(maxSeq);
    } catch (e) {
      console.error('Error during stream read:', e, e.stack);
    }
    if (shouldClose) {
      self.close();
    }
  } else {
    stanzas.forEach(self._push.bind(self));
  }
}


StanzaStream.prototype._pushCaughtUpMeta = function(seq) {
  var self = this;
  if (self.isCaughtUp) {
    return;
  }
  self._voxClient.getHighWaterMark(self._url)
    .then(function(highWaterMark) {
      if (seq < highWaterMark) {
        debug('Stream not caught up %s/%d vs %d', self._url, seq, highWaterMark);
        return;
      }
      debug('Stream is caught up to real time at %s/%d', self._url, seq);
      self.isCaughtUp = true;
      if (self._pushMetaStanzas) {
        var meta = { type: 'INTERNAL_META', stream: self._stream, isCaughtUp: true };
        self.push(self._batchMode ? [meta] : meta);
      }
    })
}


StanzaStream.prototype._setSeqStart = function(seqStart) {
  debug('Starting stream %s from %d', this._stream, seqStart);
  this._seqInitCheckpoint = seqStart - 1;
  this._waitingForSeqStart = false;
  this._read();
}


StanzaStream.prototype._read = function() {
  var self = this;
  self._isReadReady = true;
  if (this._waitingForFirstPushMessage || this._waitingForSeqStart || this._closed) {
    return;
  }
  self._checkpointChain.next(self._stream, function(seqCheckpoint) {
    if (self._closed) {
      return seqCheckpoint;
    }
    return self._fetchStanzas(seqCheckpoint);
  });
}


StanzaStream.prototype._fetchStanzas = function(seqCheckpoint) {
  var self = this;
  debug('Read after checkpoint %s/%d', self._stream, seqCheckpoint);
  var seqStart = seqCheckpoint + 1;
  return self._voxClient.fetchStanzas(self._url, seqStart, self._batchSize)
    .then(function(stanzas) {
      if (!stanzas.length) {
        self._pushCaughtUpMeta(seqCheckpoint);
        return seqCheckpoint;
      }
      self._pushBatch(stanzas);
      seqCheckpoint = stanzas[stanzas.length - 1].seq;
      debug('Advancing checkpoint to %s/%d', self._stream, seqCheckpoint);
      return seqCheckpoint;
    })
}


StanzaStream.prototype._handleStanza = function(stanza) {
  if (this._stream && this._stream != stanza.stream) {
    return;
  }
  if (this._type && this._type != stanza.type) {
    this._pushCaughtUpMeta(stanza.seq);
    return;
  }
  if (this._waitingForSeqStart || this._closed) {
    return;
  }
  var self = this;
  self._checkpointChain.next(self._stream, function(seqCheckpoint) {
    if (self._closed) {
      return seqCheckpoint;
    }
    debug('Got STANZA %s/%d with checkpoint %d',
        self._stream, stanza.seq, seqCheckpoint)
    if (stanza.seq == seqCheckpoint + 1 || stanza.prevSeq == seqCheckpoint || self._waitingForFirstPushMessage) {
      // If the stanza is immediately following our checkpoint, then we can push
      // it onto the stream and advance our checkpoint.
      debug('Pushing %s/%d', stanza.stream, stanza.seq);
      // TODO Handle backpressure.
      self._push(stanza);
      self._waitingForFirstPushMessage = false;
      return stanza.seq;
    } else  if (stanza.seq > seqCheckpoint + 1 && self._isReadReady) {
      return self._fetchStanzas(seqCheckpoint);
    }
    // The stanza is either too far ahead or too far behind, so keep the same
    // checkpoint.
    return seqCheckpoint;
  });
}


StanzaStream.prototype._loadCheckpoint = function() {
  var self = this;
  if (!self._checkpointKey) {
    debug('Starting stream %s after %d', self._stream, self._seqInitCheckpoint);
    self._pushCaughtUpMeta(self._seqInitCheckpoint);
    return self._seqInitCheckpoint;
  }
  return self._voxClient.db.getClientCheckpoint(self._checkpointKey, self._stream)
    .then(function(seqCheckpoint) {
      debug('Loaded checkpoint for %s from %s: %d', self._stream, self._checkpointKey, seqCheckpoint);
      if (!seqCheckpoint) {
        seqCheckpoint = self._seqInitCheckpoint;
      }
      self._pushCaughtUpMeta(seqCheckpoint);
      return seqCheckpoint;
    });
}

