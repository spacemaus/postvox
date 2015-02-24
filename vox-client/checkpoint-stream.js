var Chain = require('vox-common/chain');
var debug = require('debug')('vox:checkpoint-stream');
var stream = require('stream');
var util = require('util');


/**
 * Implements a Transform stream that writes checkpoints for the stanzas that
 * pass through it.
 */
var CheckpointStream = module.exports = function(voxClient, options) {
  if (!options) {
    throw new Error('Missing `options` argument!');
  }
  if (!options.checkpointKey) {
    throw new Error('Missing `options.checkpointKey` argument!');
  }
  this._voxClient = voxClient;
  this._checkpointKey = options.checkpointKey;
  this._checkpointChain = new Chain(this._loadClientCheckpoint.bind(this));
  stream.Transform.call(this, { objectMode: true });
}
util.inherits(CheckpointStream, stream.Transform);


CheckpointStream.prototype._transform = function(stanza, encoding, callback) {
  if (util.isArray(stanza)) {
    stanza = stanza[stanza.length - 1];
  }
  var self = this;
  self._checkpointChain.next(stanza.stream, function(checkpointSeq) {
    if (stanza.seq <= checkpointSeq) {
      debug('Not checkpointing %s/%d <= %d', stanza.stream, stanza.seq, checkpointSeq);
      callback(null, stanza);
      return checkpointSeq;
    }
    debug('Checkpointing %s at %s/%d', self._checkpointKey, stanza.stream, stanza.seq);
    return self._voxClient.db.setClientCheckpoint(
        self._checkpointKey, stanza.stream, stanza.seq)
      .then(function() {
        callback(null, stanza);
      })
      .catch(function(err) {
        callback(err);
      });
  })
  .catch(function(err) {
    console.error('Ooops', err);
  })
}


CheckpointStream.prototype._loadClientCheckpoint = function(stream) {
  return this._voxClient.db.getClientCheckpoint(this._checkpointKey, stream);
}
