var P = require('bluebird');
var split = require('split');


exports = module.exports = function(context, args, argv) {
  var options = {
      cloneToMentions: argv.cloneToMentions,
  };
  process.stdin
    .pipe(split(JSON.parse))
    .on('data', function(stanza) {
      if (!stanza.stream) {
        stanza.stream = argv.stream;
      }
      if (!stanza.type) {
        stanza.type = argv.type || 'MESSAGE';
      }
      context.voxClient.post(stanza, options)
        .catch(function(err) {
          console.error('Error while posting', err);
        })
    })
    .on('error', function(err) {
      console.error('Error while reading input:', err);
      process.exit(1);
    });

  context.voxClient.createReadStream({
      type: argv.type,
      stream: argv.stream,
      seqStart: argv.seqStart,
      seqLimit: argv.seqLimit,
      checkpointKey: argv.checkpointKey
  })
  .on('data', function(stanza) {
    console.info(JSON.stringify(stanza));
  });

  return(new P(function(resolve) {})); // Never resolves, so we stay alive foreeever.
};
