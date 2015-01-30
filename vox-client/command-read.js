var P = require('bluebird');
var urlparse = require('url');


exports = module.exports = function(context, args) {
  var argv = context.argv;
  var view = context.view;
  var nick = context.nick;
  var who = args[0];
  if (!who) {
    return exports.ReadFromAllSubscriptions(context)
      .then(function(messages) {
        messages.forEach(function(message) {
          context.PrintJson('MESSAGE', message);
        });
      });
  }
  var limit = ParseOrUndef(argv.limit);
  var offset = ParseOrUndef(argv.offset);
  var syncedAfter = ParseOrUndef(argv.syncedAfter);
  var syncedBefore = ParseOrUndef(argv.syncedBefore);
  return exports.ReadFromSource(context, who, {
        limit: limit,
        syncedBefore: syncedBefore,
        syncedAfter: syncedAfter
    })
    .then(function(messages) {
      messages.forEach(function(message) {
        context.PrintJson('MESSAGE', message);
      });
    });
}

exports.help = 'Reads the most recent messages from a user (if a nickname is provided), or the most recent messages from every user you\'ve followed.';
exports.examples = [
    '/read',
    '/read spacemaus',
];
exports.flags = {
    limit: {
        help: 'The number of posts to read.',
        examples: ['20']
    },
    syncedBefore: {
        help: 'If set, then fetch `limit` posts before this `syncedAt` timestamp.'
    },
    syncedAfter: {
        help: 'If set, then don\'t fetch any posts before this `syncedAt` timestamp.'
    }
}


/**
 * Reads recent messages from the given `source`.  That is, it makes a request
 * for "vox://source/messages".
 *
 * @return {Promise<Message[]>} The messages.
 */
exports.ReadFromSource = function(context, source, options) {
  if (source[0] == '@') {
    source = source.substr(1);
  }
  return context.connectionManager.Connect(source)
    .then(function(conn) {
      return conn.GET('vox://' + source + '/messages', options)
        .then(function(reply) {
          return SortUnique(reply.messages);
        });
    });
}


/**
 * Reads recent messages from all subscribed sources.
 *
 * @return {Promise<Message[]>} The messages.
 */
exports.ReadFromAllSubscriptions = function(context) {
  // Look up the user's subscriptions locally.
  return context.db.ListSubscriptions(context.nick)
    .then(function(subscriptions) {
      // For each subscription, connect to the source and fetch the messages.
      return P.settle(subscriptions.map(function(subscription) {
        var url = urlparse.parse(subscription.subscriptionUrl);
        return context.connectionManager.Connect(url.hostname)
          .then(function(conn) {
            return conn.GET(subscription.subscriptionUrl + '/messages')
          })
          .then(function(reply) {
            return reply.messages;
          })
          .catch(function() {
            return [];
          });
      }))
      .then(function(promises) {
        // Collate the messages into a single list.
        var messages = promises.reduce(function(messages, promise) {
          if (promise.isFulfilled()) {
            messages.push.apply(messages, promise.value());
          } else {
            console.error(promise.reason());
          }
          return messages;
        }, []);
        return SortUnique(messages);
      });
    });
}


function SortUnique(messages) {
  var alreadySeen = {};
  return messages.filter(function(message) {
      var url = message.clone || message.messageUrl;
      if (url in alreadySeen) {
        return false;
      }
      alreadySeen[url] = 1;
      return true;
    })
    .sort(function(a, b) {
      return a.syncedAt - b.syncedAt;
    });
}


function ParseOrUndef(s) {
  try {
    return parseInt(s, 10);
  } catch (err) {
    return undefined;
  }
}
