var authentication = require('vox-common/authentication');
var P = require('bluebird');


exports = module.exports = function(context, args) {
  var term = context.term;
  var author = context.nick;
  var text = args.join(' ');
  if (!text.trim()) {
    console.error('Missing post text');
    process.exit(1);
  }
  return exports.PostMessage(context, author, text)
    .then(function(message) {
      context.PrintJson('MESSAGE', message);
    });
}

exports.help = 'Posts a message to your stream.  When run in interactive mode, this is the default command.  You can post to other users\' streams via @-mentions, e.g. "@spacemaus Hi."';
exports.examples = [
    '/post Hello World',
    '/post @spacemaus This is something, alright.'
];
exports.flags = {
    title: {
        help: 'The title of the post.',
        examples: ['\'31,934 ways to blah.\'']
    },
    thread: {
        help: 'The message URL of the thread that this post belongs to.',
        examples: ['vox://spacemaus/messages/382949423']
    },
    replyTo: {
        help: 'The message URL of the thread that this post is a direct reply to.',
        examples: ['vox://spacemaus/messages/382949423']
    },
    userUrl: {
        help: 'The URL of something interesting.',
        examples: ['http://daringfireball.net']
    },
    etc: {
        help: 'Extensible message payload.',
        examples: ['\'{myOwnField: "hi"}\'']
    }
}


exports.PostMessage = function(context, nick, text) {
  return context.connectionManager.Connect(nick, nick)
    .then(function(conn) {
      var now = new Date().getTime();
      var message = {
          author: nick,
          source: nick,
          text: text,
          title: context.argv.title,
          userUrl: context.argv.userUrl,
          thread: context.argv.thread,
          replyTo: context.argv.replyTo,
          etc: context.argv.etc,
          updatedAt: now
      };
      authentication.SignMessageStanza(message, context.privkey);
      return conn.POST('vox://' + nick + '/messages', message)
      .then(function(reply) {
        var message = reply.message;
        var targets = GetAtMentions(message.text);
        return P.settle(targets.map(function(target) {
          return context.connectionManager.Connect(target, nick)
            .then(function(conn) {
              var clone = JSON.parse(JSON.stringify(message));
              clone.source = target;
              clone.clone = message.messageUrl;
              delete clone.messageUrl;
              delete clone.sig;
              authentication.SignMessageStanza(clone, context.privkey);
              return conn.POST('vox://' + target + '/messages', clone);
            });
        }))
        .return(message);
      })
    })
}


function GetAtMentions(text) {
  return (text.match(/@(\w+)/g) || []).map(function(t) { return t.substr(1) });
}

