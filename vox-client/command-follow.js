var authentication = require('vox-common/authentication');
var P = require('bluebird');


exports = module.exports = function(context, args) {
  var view = context.view;
  var who = args[0];
  if (!who) {
    console.error('Missing who to follow');
    process.exit(1);
  }
  return exports.Follow(context, who, 1)
    .then(function() {
      view.log('Following %s', who);
    });
}

exports.help = 'Follows a user.  You\'ll start receiving posts and other updates from them.  You\'ll also receive posts from others that are directed to them.';
exports.examples = [
    '/follow spacemaus'
];


exports.Follow = function(context, who, weight) {
  var nick = context.nick;
  var followUrl = 'vox://' + who;
  var subscription = {
      nick: nick,
      subscriptionUrl: followUrl,
      source: who,
      weight: weight,
      updatedAt: new Date().getTime()
  };
  authentication.SignSubscriptionStanza(subscription, context.privkey);
  return context.db.InsertSubscription(subscription)
    .then(function() {
      return context.EnsureInterchangeSession(who);
    })
    .then(function(conn) {
      // Notify the user's interchange server that our user is following a URL.
      return conn.POST('vox://' + who + '/subscribers', subscription)
        .then(function() {
          // Now, actually ask the interchange server to send us messages
          // published to that URL.
          return context.SendRouteRequest(followUrl, who, weight);
        })
        .then(function() {
          // And tell our own user's interchange server that we're following a
          // URL.  It may be the same server, but it'll be recorded under a
          // different source.
          return context.connectionManager.Connect(nick)
            .then(function(conn2) {
              return conn2.POST('vox://' + nick + '/subscribers', subscription);
            })
        })
    })
}
