var VoxClient = require('../vox-client');
var morse = require('morse-node').create("ITU");
var voxurl = require('vox-common/voxurl');


var NICK = 'morsebot'
var AGENT_STRING = 'morsebot 0.0.0';
var HELP_MESSAGE = 'I am morsebot. Say @morsebot /follow or /unfollow.';


var client = new VoxClient({
    nick: NICK,
    agentString: AGENT_STRING,
});


client.connect()
  .then(function() {
    // Follow ourselves so that we get messages sent to @morsebot.
    client.subscribe(NICK);

    // Post to our public stream.
    client.post({ text: 'online ' + new Date() });

    // Create a Node stream to read stanzas from the all the postvox streams we
    // are subscribed to.  Since we don't specify `seqStart`, the stream will
    // only read stanzas from the current time forward.
    client.createReadStream({ type: 'MESSAGE' })
      .on('data', function(message) {

        // We don't need to respond to our OWN messages.
        if (message.nick == NICK) {
          return;
        }

        // An empty message is no message at all!
        var text = message.text;
        if (!text) {
          return;
        }

        console.info('%s %s', message.nick, message.text);

        var command = getCommand(text);
        if (command == '/follow') {
          // Yay, the user wants us to follow them!  So we will, and we'll tell
          // them how to get us to stop following them.
          followUser(message.nick);

        } else if (command == '/unfollow') {
          // Awww, the user doesn't want us to follow them any more.
          unfollowUser(message.nick);

        } else if (command == '/help') {
          // Yes, what is this anyway?
          replyWithHelp(message.nick);

        } else {
          var translated = translateText(text);
          if (translated) {
            sendTranslation(message.nick, translated, message);
          }
        }
      });
  });


function getCommand(text) {
  var atMentioned = text.indexOf('@' + NICK) != -1;
  if (!atMentioned) {
    return null;
  }
  var m = /\/\w+/.exec(text);
  return m ? m[0] : null;
}


function followUser(nick) {
  client.subscribe(nick);
  client.post({
      stream: nick,
      text: 'dah dit dah...send @morsebot /unfollow to stop the morse'
  });
}


function unfollowUser(nick) {
  client.unsubscribe(nick);
  client.post({
      stream: nick,
      text: morse.encode('goodbye') + " :'("
  });
}


function replyWithHelp(message) {
  client.post({
      text: HELP_MESSAGE,
      replyToStanza: message
  })
  .catch(function(err) {
    console.error('Ooops', err);
  })
}


function translateText(text) {
  var text = text.replace('@' + NICK, '');
  if (looksLikeMorse(text)) {
    // Oh, what's it mean?  I will tell you!
    return morse.decode(text);
  } else {
    // Here, have some morse code.
    return morse.encode(text);
  }
}


function sendTranslation(to, text, replyToStanza) {
  client.post({
      text: '@' + to + ' ' + text,
      replyToStanza, replyToStanza
  })
  .catch(function(err) {
    console.error('Ooops', err);
  });
}


function looksLikeMorse(text) {
  return countChars(/[. -]/g, text) > countChars(/[^. -]/g, text);
}


function countChars(re, text) {
  return text.split(re).length;
}
