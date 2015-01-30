var P = require('bluebird');
var urlparse = require('url');


exports = module.exports = function(context, args) {
  var who = args[0];
  if (!who) {
    return exports.GetAllStatuses(context)
      .then(function(userStatuses) {
        userStatuses.forEach(context.PrintJson.bind(null, 'USER_STATUS'));
      });
  }
  return exports.GetStatus(context, who)
    .then(function(userStatus) {
      context.PrintJson('USER_STATUS', userStatus);
    });
}

exports.help = 'Gets the status of a single user, or of all the users you are following.';
exports.examples = [
    '/status spacemaus',
    '/status'
];


exports.GetStatus = function(context, who) {
  if (!who) {
    return GetAllStatuses(context);
  }
  if (!who) {
    who = context.nick;
  }
  if (who[0] == '@') {
    who = who.substr(1);
  }
  return context.connectionManager.Connect(who)
    .then(function(conn) {
      return conn.GET('vox://' + who + '/status', {});
    })
    .then(function(reply) {
      return reply.userStatus;
    });
}


exports.GetAllStatuses = function(context) {
  return context.db.ListSubscriptions(context.nick)
    .then(function(subscriptions) {
      var nicknames = GetNicknames(subscriptions);
      return P.settle(nicknames.map(function(nickname) {
        return context.connectionManager.Connect(nickname)
          .then(function(conn) {
            return conn.GET('vox://' + nickname + '/status')
          })
          .then(function(reply) {
            return reply.userStatus;
          })
          .catch(function() {
            return null;
          });
      }))
      .then(function(promises) {
        return promises.reduce(function(userStatuses, promise) {
          if (promise.isFulfilled()) {
            if (promise.value()) {
              userStatuses.push(promise.value());
            }
          } else {
            console.error(promise.reason());
          }
          return userStatuses;
        }, []);
        return SortUnique(messages);
      });
    });
}


function GetNicknames(subscriptions) {
  return Object.keys(subscriptions.reduce(function(nicknames, subscription) {
    var url = urlparse.parse(subscription.subscriptionUrl);
    var nickname = url.hostname;
    if (!(nickname in nicknames)) {
      nicknames[nickname] = 1;
    }
    return nicknames;
  }, {}));
}
