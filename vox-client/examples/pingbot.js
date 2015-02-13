var VoxClient = require('../vox-client')
var voxurl = require('vox-common/voxurl');


var client = new VoxClient({
    agentString: 'My pingbot'
})

client.connect()
  .then(function() {
    // client.subscribe('somestream')
    client.post({ text: 'hello!' })
    client.createReadStream({ type: 'MESSAGE' })
      .on('data', function(stanza) {
        console.info('%s says %s', stanza.nick, stanza.text)
        if (stanza.nick == client.nick) {
          return;
        }
        client.post({
            stream: stanza.stream,
            text: 'Pong: ' + stanza.text,
            replyTo: voxurl.getStanzaUrl(stanza)
        })
      })
  })
