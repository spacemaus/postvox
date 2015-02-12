var stream = require('stream');
var through2 = require('through2');
var util = require('util');
var VoxClient = require('../vox-client');


var AGENT_STRING = 'readbot 0.0.0';
var HELP_MESSAGE = 'I am readbot.';
var CHECKPOINT_KEY = 'readbot_checkpoint';


var client = new VoxClient({
    // Uses --nick from the command line by default:
    // nick: NICK,
    agentString: AGENT_STRING,
});


client.connect()
  .then(function() {
    client.createReadStream({ checkpointKey: CHECKPOINT_KEY })
      .pipe(through2.obj(function(stanza, enc, callback) {
        if (stanza.type == 'MESSAGE') {
          console.info(formatMessage(s));
        }
        callback(null, stanza);
      }))
      .pipe(client.createCheckpointStream({ checkpointKey: CHECKPOINT_KEY }));
  });


function formatMessage(stanza) {
  return util.format(
      '%s/%d [%s] %s',
      stanza.stream,
      stanza.seq,
      stanza.nick,
      stanza.text);
}
