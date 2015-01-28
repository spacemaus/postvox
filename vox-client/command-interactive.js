var authentication = require('vox-common/authentication');
var colors = require('colors');
var commandGetstatus = require('./command-getstatus');
var commandHelp = require('./command-help');
var commandPost = require('./command-post');
var commandRead = require('./command-read');
var commandStatus = require('./command-status');
var debug = require('debug')('vox:command:interactive');
var errors = require('vox-common/errors');
var moment = require('moment');
var P = require('bluebird');


/**
 * Starts an interactive session.
 */
exports = module.exports = function(context, args) {
  context.commands = INTERACTIVE_COMMANDS;
  context.interactive = true;

  var term = context.term;
  var nick = context.nick;

  var messagePrinter = context.messagePrinter = MessagePrinter(context);
  var alreadyPrinted = {};

  context.connectionManager.on('MESSAGE', function(message) {
    authentication.CheckMessageStanza(context.hubClient, message)
      .then(function() {
        messagePrinter.PrintMessage(message, alreadyPrinted);
        term.prompt();
      })
      .catch(errors.AuthenticationError, function(err) {
        debug('Rejecting MESSAGE due to authentication error', err);
      });
  });

  context.connectionManager.on('SUBSCRIPTION', function(subscription) {
    authentication.CheckSubscriptionStanza(context.hubClient, subscription)
      .then(function() {
        term.log('%s is %s %s',
            colors.cyan.bold(subscription.nick),
            subscription.weight ? 'subscribed to' : 'unsubscribed from',
            subscription.subscriptionUrl);
        term.prompt();
      })
      .catch(errors.AuthenticationError, function(err) {
        debug('Rejecting SUBSCRIPTION due to authentication error', err);
      });
  });

  context.connectionManager.on('USER_STATUS', function(userStatus) {
    authentication.CheckUserStatusStanza(context.hubClient, userStatus)
      .then(function() {
        PrintUserStatus(context, userStatus);
      })
      .catch(errors.AuthenticationError, function(err) {
        debug('Rejecting USER_STATUS due to authentication error', err);
      });
  })

  context.ListenForConnectionStatusEvents(context.connectionManager);

  term.log('Connecting as %s', colors.bold(nick));

  term.log(colors.bold('Welcome, %s!'), nick);
  term.log('To get started, type %s to follow someone, type %s to get help, or type anything else to post a message to your stream.', colors.bold('/follow ' + colors.underline('nickname')), colors.bold('/help'));

  return context.EnsureSessionsForSubscriptions()
    .then(function() {
      term.setPrompt('> ');
      term.prompt();
      term.rl.on('line', function(line) {
        var parts = split2(line);
        var cmdName = parts[0];
        if (cmdName[0] == '/') {
          var handler = INTERACTIVE_COMMANDS[cmdName.substr(1)];
          if (!handler) {
            term.log(colors.red('No such command: %s'), cmdName);
            term.prompt();
          } else {
            handler(context, [parts[1]])
              .then(function() { term.prompt() })
              .catch(function(err) {
                term.log(colors.red('Error:'), err, err.stack);
              });
          }
        } else {
          commandPost.PostMessage(context, nick, line)
            .then(function(message) {
              messagePrinter.PrintMessage(message, alreadyPrinted);
              term.prompt();
            })
            .catch(function(err) {
              term.log(colors.red('Error:'), err, err.stack);
            });
        }
      });
      term.rl.on('close', function() {
        process.exit(0);
      })
    })
    .return(new P(function(resolve) {})); // Never resolves, so we stay alive foreeever.
}

exports.help = 'Starts an interactive session.  Commands start with "/", e.g. "/follow spacemaus".';
exports.examples = [
    './vox.js'
];


/**
 * The set of commands that can be invoked from an interactive session.
 */
var INTERACTIVE_COMMANDS = {
  follow: require('./command-follow'),
  unfollow: require('./command-unfollow'),
  read: function(context, args) {
    var p;
    if (args[0]) {
      p = commandRead.ReadFromSource(context, args[0], {});
    } else {
      p = commandRead.ReadFromAllSubscriptions(context);
    }
    return p.then(function(messages) {
      messages.forEach(function(message) {
        context.messagePrinter.PrintMessage(message);
      });
    });
  },
  status: function(context, args) {
    var statusText = args.join(' ');
    return commandStatus.SetStatusText(context, statusText);
  },
  getstatus: function(context, args) {
    if (!args[0]) {
      return commandGetstatus.GetAllStatuses(context)
        .then(function(userStatuses) {
          userStatuses.forEach(PrintUserStatus.bind(null, context));
        });
    }
    return commandGetstatus.GetStatus(context, args[0])
      .then(function(userStatus) {
        PrintUserStatus(context, userStatus);
      });
  },
  help: function(context, args) {
    return commandHelp(context, args)
      .then(function() {
        if (!args[0]) {
          context.term.log('To post a message to your stream, enter any line that does not start with "/".  To post a message to someone else\'s stream, @-mention them like so: "@spacemaus Hi there".');
        }
      });
  }
};

INTERACTIVE_COMMANDS.read.help = commandRead.help;
INTERACTIVE_COMMANDS.read.examples = commandRead.examples;
INTERACTIVE_COMMANDS.status.help = commandStatus.help;
INTERACTIVE_COMMANDS.status.examples = commandStatus.examples;
INTERACTIVE_COMMANDS.getstatus.help = commandGetstatus.help;
INTERACTIVE_COMMANDS.getstatus.examples = commandGetstatus.examples;
INTERACTIVE_COMMANDS.help.help = commandHelp.help;
INTERACTIVE_COMMANDS.help.examples = commandHelp.examples;


function PrintUserStatus(context, userStatus) {
  if (!userStatus.statusText) {
    return;
  }
  context.term.log('%s %s',
      colors.cyan.bold(userStatus.nick),
      colors.dim(userStatus.statusText));
}


function MessagePrinter(context) {
  var self = {};

  var localMessageIds = {};
  var localIdToMessageUrl = {};
  var messageIndex = 1;

  self.PrintMessage = function(message, opt_alreadyPrinted) {
    var url = message.clone || message.messageUrl;
    var localId = localMessageIds[url];
    if (!localId) {
      localId = messageIndex++;
      localMessageIds[url] = localId;
      localIdToMessageUrl[localId] = url;
    }

    if (opt_alreadyPrinted) {
      if (localId in opt_alreadyPrinted) {
        return;
      }
      opt_alreadyPrinted[localId] = 1;
    }

    // TODO Print idStr and implement "/reply".
    //var idStr = colors.yellow.dim('[' + localId + ']');
    var when = moment(message.createdAt).format('MMM D h:mm:ss A');
    var author = colors.cyan.bold(message.author);
    if (message.title && message.userUrl) {
      context.term.log('%s %s', colors.dim(when), author);
      context.term.log('    %s', colors.green(message.title));
      context.term.log('    %s', colors.underline(message.userUrl));
      if (message.text) {
        context.term.log('    %s', message.text);
      }
    } else if (message.title) {
      context.term.log('%s %s %s', colors.dim(when), author, colors.green(message.title));
      if (message.text) {
        context.term.log('    %s', message.text);
      }
    } else  if (message.url) {
      context.term.log('%s %s %s', colors.dim(when), author, colors.underline(message.userUrl));
      if (message.text) {
        context.term.log('    %s', message.text);
      }
    } else {
      context.term.log('%s %s %s',
          colors.dim(when), author, message.text);
    }
  }

  self.GetMessageUrlFromLocalId = function(localId) {
    return localIdToMessageUrl[localId];
  }

  return self;
}


function split2(line) {
  var i = line.indexOf(' ');
  if (i == -1) {
    return [line, ''];
  }
  return [line.substring(0, i), line.substring(i + 1).trim()];
}
