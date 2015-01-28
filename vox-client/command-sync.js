var P = require('bluebird');
var urlparse = require('url');


exports = module.exports = function(context, args) {
  var argv = context.argv;
  var term = context.term;
  var nick = context.nick;
  var who = args[0];
  if (!who) {
    return exports.SyncAllSubscriptions(context)
      .then(function(messages) {
      });
  }

  var limit = ParseOrUndef(argv.limit);
  var offset = ParseOrUndef(argv.offset);
  var syncedAfter = ParseOrUndef(argv.syncedAfter);
  return exports.SyncSource(context, who, {
        limit: limit,
        offset: offset,
        syncedAfter: syncedAfter
    })
    .then(function(messages) {
    });
}

exports.help = 'Retrieves messages since the last sync command.';
exports.examples = [
    '/sync',
    '/sync spacemaus',
];


exports.SyncSource = function(context, who, options) {
  return context.connectionManager.Connect(who)
    .then(function(conn) {
      return conn.GET('vox://' + who + '/messages', options)
        .then(function(reply) {
          return SortUnique(reply.messages);
        });
    });
}


exports.SyncAllSubscriptions = function(context) {
  return context.db.ListSubscriptions(context.nick)
    .then(function(subscriptions) {
      return P.settle(subscriptions.map(function(subscription) {
        var url = urlparse.parse(subscription.subscriptionUrl);
        return context.connectionManager.Connect(url.hostname)
          .then(function(conn) {
            return conn.GET(subscription.subscriptionUrl + '/messages')
          })
          .then(function(reply) {
            return reply.messages;
          });
      }))
      .then(function(promises) {
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
      return a.updatedAt - b.updatedAt;
    });
}


function ParseOrUndef(s) {
  try {
    return parseInt(s, 10);
  } catch (err) {
    return undefined;
  }
}


function PrintJsonMessage(context, message, alreadyPrinted) {
  if (alreadyPrinted) {
    var url = message.clone || message.messageUrl;
    if (url in alreadyPrinted) {
      return;
    }
    alreadyPrinted[url] = 1;
  }
  context.PrintJson('MESSAGE', message);
}
