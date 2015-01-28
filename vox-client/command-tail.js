var P = require('bluebird');
var urlparse = require('url');


exports = module.exports = function(context, args) {
  var nick = context.nick;
  context.connectionManager.on('MESSAGE', function(message) {
    context.PrintJson('MESSAGE', message);
  });
  context.connectionManager.on('USER_STATUS', function(userStatus) {
    context.PrintJson('USER_STATUS', userStatus);
  });
  context.connectionManager.on('SUBSCRIPTION', function(subscription) {
    context.PrintJson('SUBSCRIPTION', subscription);
  });
  context.ListenForConnectionStatusEvents(context.connectionManager);

  if (args.length) {
    return P.all(args.map(function(who) {
      return context.EnsureInterchangeSession(who);
    }))
    .return(new P(function(resolve) {})); // Never resolves, so we stay alive.
  }
  return context.db.ListSubscriptions(context.nick)
    .then(function(subscriptions) {
      return P.all(subscriptions.map(function(subscription) {
        var url = urlparse.parse(subscription.subscriptionUrl);
        return context.EnsureInterchangeSession(url.hostname)
      }))
      .return(new P(function(resolve) {})); // Never resolves, so we stay alive.
    });
}

exports.help = 'Listens for push-messages on your stream and other subscriptions.  Prints messages in JSON format.';
exports.examples = [
    '/tail'
]
