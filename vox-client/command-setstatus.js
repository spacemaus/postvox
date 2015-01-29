var authentication = require('vox-common/authentication');


exports = module.exports = function(context, args) {
  var statusText = args.join(' ');
  return exports.SetStatusText(context, statusText)
    .then(function(reply) {
      context.PrintJson('USER_STATUS', reply.userStatus);
    });
}

exports.help = 'Sets your status and notifies anyone following you.';
exports.examples = [
    '/me Gone fishing'
];


exports.SetStatusText = function(context, statusText) {
  return context.connectionManager.Connect(context.nick)
    .then(function(conn) {
      var userStatus = {
          nick: context.nick,
          statusText: statusText,
          updatedAt: new Date().getTime()
      };
      authentication.SignUserStatusStanza(userStatus, context.privkey);
      return conn.POST('vox://' + context.nick + '/status', userStatus);
    });
}
