var commandFollow = require('./command-follow');


exports = module.exports = function(context, args) {
  var term = context.term;
  var who = args[0];
  if (!who) {
    console.error('Missing who to unfollow');
    process.exit(1);
  }
  return commandFollow.Follow(context, who, 0)
    .then(function() {
      term.log('Unfollowed %s', who);
    });
}

exports.help = 'Unfollows a user.  You\'ll stop receiving updates from them.';
exports.examples = [
    '/unfollow spacemaus'
];
