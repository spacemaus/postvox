var Chain = require('vox-common/chain');
var debug = require('debug')('vox:merge-stream');
var P = require('bluebird');
var stream = require('stream');
var util = require('util');
var voxurl = require('vox-common/voxurl');


function MergeStream(options) {
  this.options = JSON.parse(JSON.stringify(options));
  this._batchMode = options && options.batchMode;
  this._inputStreams = [];
  this._buffers = {};
  this._isCaughtUp = {};
  this._onInputListener = this._onInput.bind(this);
  this._onErrorListener = this._onError.bind(this);
  stream.Readable.call(this, { objectMode: true });
}
util.inherits(MergeStream, stream.Readable)
module.exports = MergeStream;


MergeStream.prototype.add = function(stanzaStream) {
  debug('Merging stream %s', stanzaStream._stream);
  this._inputStreams.push(stanzaStream);
  this._buffers[stanzaStream._stream] = [];
  this._isCaughtUp[stanzaStream._stream] = stanzaStream.isCaughtUp;
  stanzaStream.on('data', this._onInputListener);
  stanzaStream.on('error', this._onErrorListener);
}


MergeStream.prototype.remove = function(stream) {
  var self = this;
  self._inputStreams = self._inputStreams.filter(function(inputStream) {
    if (inputStream._stream != stream) {
      return true;
    }
    inputStream.removeListener('on', self._onInputListener);
    inputStream.removeListener('error', self._onErrorListener);
    return false;
  })
}


MergeStream.prototype._read = function() {
  // TODO
}


MergeStream.prototype._onError = function(error) {
  this.emit('error', error);
}


MergeStream.prototype._onInput = function(stanzas) {
  if (util.isArray(stanzas)) {
    stanzas.forEach(this._onStanza.bind(this));
  } else {
    this._onStanza(stanzas);
  }
}


MergeStream.prototype._onStanza = function(stanza) {
  debug('Merge got stanza %s/%d', stanza.stream, stanza.seq);
  if (stanza.type == 'INTERNAL_META') {
    this._isCaughtUp[stanza.stream] = stanza.isCaughtUp;
  } else {
    this._buffers[stanza.stream].push(stanza);
  }
  this._push();
}


MergeStream.prototype._push = function() {
  // TODO Batch mode
  while (true) {
    var earliestSyncedAt = Number.POSITIVE_INFINITY;
    var earliestBuffer = null;
    for (var i = 0; i < this._inputStreams.length; i++) {
      var inputStream = this._inputStreams[i];
      var buffer = this._buffers[inputStream._stream];
      if (!buffer.length && !this._isCaughtUp[inputStream._stream]) {
        debug('Merge not ready, waiting for %s', inputStream._stream);
        return;
      }
      if (!buffer.length) {
        continue;
      }
      if (buffer[0].syncedAt < earliestSyncedAt) {
        earliestSyncedAt = buffer[0].syncedAt;
        earliestBuffer = buffer;
      }
    }
    if (!earliestBuffer) {
      return;
    }
    var stanza = earliestBuffer.shift();
    debug('Merging next %s/%d', stanza.stream, stanza.seq);
    if (this._batchMode) {
      this.push([stanza]);
    } else {
      this.push(stanza);
    }
  }
}


MergeStream.prototype.close = function() {
  this._inputStreams.forEach(function(stream) {
    if (!stream.close) {
      return;
    }
    stream.close();
  });
  this.emit('end');
}
