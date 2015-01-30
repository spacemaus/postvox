var authentication = require('vox-common/authentication');
var colors = require('colors');
var commandGetstatus = require('./command-getstatus');
var commandHelp = require('./command-help');
var commandPost = require('./command-post');
var commandRead = require('./command-read');
var commandSetstatus = require('./command-setstatus');
var debug = require('debug')('vox:command:interactive');
var errors = require('vox-common/errors');
var moment = require('moment');
var P = require('bluebird');
var util = require('util');


/**
 * Starts an interactive session.
 */
exports = module.exports = function(context, args) {
  context.commands = INTERACTIVE_COMMANDS;
  context.interactive = true;

  var view = context.view;
  var nick = context.nick;

  var messagePrinter = context.messagePrinter = MessagePrinter(context);
  var alreadyPrinted = {};

  context.connectionManager.on('MESSAGE', function(message) {
    authentication.CheckMessageStanza(context.hubClient, message)
      .then(function() {
        messagePrinter.PrintMessage(message, alreadyPrinted);
        view.prompt();
      })
      .catch(errors.AuthenticationError, function(err) {
        debug('Rejecting MESSAGE due to authentication error', err);
      });
  });

  context.connectionManager.on('SUBSCRIPTION', function(subscription) {
    authentication.CheckSubscriptionStanza(context.hubClient, subscription)
      .then(function() {
        view.log('%s is %s %s',
            colors.cyan.bold(subscription.nick),
            subscription.weight ? 'subscribed to' : 'unsubscribed from',
            subscription.subscriptionUrl);
        view.prompt();
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

  var connectedInterchangeUrls = [];
  context.connectionManager.on('connect', function(info) {
    var url = info.interchangeUrl;
    if (connectedInterchangeUrls.indexOf(url) != -1) {
      return;
    }
    connectedInterchangeUrls.unshift(url);
    updateConnectionModeLine();
  });

  context.connectionManager.on('disconnect', function(info) {
    var url = info.interchangeUrl;
    var i = connectedInterchangeUrls.indexOf(url);
    if (i == -1) {
      return;
    }
    connectedInterchangeUrls.splice(i, 1);
    updateConnectionModeLine();
  });

  function updateConnectionModeLine() {
    if (connectedInterchangeUrls.length) {
      view.setModeLine('Connected to ' + connectedInterchangeUrls.join(', '));
    } else {
      view.setModeLine(colors.red('Disconnected'));
    }
    view.render();
  }

  view.showHelp(
    util.format('Welcome, %s!', colors.yellow.bold(nick)) + '\n\n' +
    util.format('To get started, type %s to follow someone, type %s to get help, or type %s to post a message to your stream.', colors.yellow.bold('/follow ' + colors.underline('nickname')), colors.yellow.bold('/help'), colors.yellow.bold("'")));

  view.once('main.key', function() {
    view.hideHelp();
  })

  view.focusMainBox();
  view.prompt();

  function listenForCommand() {
    view.focusInput();
    view.setInputColor('green');
    view.setPrompt('Command: /');
    view.prompt();
    view.once('input.submit', handleCommand);
  }

  function handleCommand(line) {
    view.focusMainBox();
    view.setPrompt('');
    view.setInputColor('white');
    view.prompt();
    var parts = split2(line);
    var cmdName = parts[0];
    var handler = INTERACTIVE_COMMANDS[cmdName];
    if (!handler) {
      view.log(colors.red('No such command: %s'), cmdName);
    } else {
      handler(context, [parts[1]])
        .then(function() { view.prompt() })
        .finally(view.scrollToEnd)
        .catch(function(err) {
          view.log(colors.red('Error:'), err, err.stack);
        });
    }
  }

  function listenForMessage() {
    view.focusInput();
    view.setInputColor('white');
    view.setPrompt('Say> ');
    view.prompt();
    view.once('input.submit', handleMessageCommand);
  }

  function handleMessageCommand(line) {
    view.focusMainBox();
    view.setPrompt('');
    view.prompt();
    commandPost.PostMessage(context, nick, line)
      .then(function(message) {
        messagePrinter.PrintMessage(message, alreadyPrinted);
      })
      .finally(view.scrollToEnd)
      .catch(function(err) {
        view.log(colors.red('Error:'), err, err.stack);
      });
  }

  function cancelInput() {
    view.focusMainBox();
    view.setPrompt('');
    view.prompt();
    view.removeAllListeners('input.submit');
  }

  view.on('input.cancel', cancelInput);

  return context.EnsureSessionsForSubscriptions()
    .then(function(connections) {
      view.setHelpLine(util.format('Type %s, or type %s or %s to post', colors.green.bold('/help'), colors.green.bold("'"), colors.green.bold('@')))
      view.setPrompt('');
      view.prompt();

      view.on('main.key', function(key) {
        if (key == '/') {
          listenForCommand();
        } else if (key == '\'') {
          listenForMessage();
        } else if (key == '@') {
          view.setInputLine('@');
          listenForMessage();
        }
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
  me: function(context, args) {
    var statusText = args.join(' ');
    return commandSetstatus.SetStatusText(context, statusText);
  },
  status: function(context, args) {
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
          context.view.log('To post a message to your stream, type %s then hit enter to post.  To post a message to someone else\'s stream, @-mention them like so: "@spacemaus Hi there".', colors.bold.yellow("'"));
        }
      });
  },
  quit: function(context, args) {
    process.exit(0);
  }
};

INTERACTIVE_COMMANDS.read.help = commandRead.help;
INTERACTIVE_COMMANDS.read.examples = commandRead.examples;
INTERACTIVE_COMMANDS.me.help = commandSetstatus.help;
INTERACTIVE_COMMANDS.me.examples = commandSetstatus.examples;
INTERACTIVE_COMMANDS.status.help = commandGetstatus.help;
INTERACTIVE_COMMANDS.status.examples = commandGetstatus.examples;
INTERACTIVE_COMMANDS.help.help = commandHelp.help;
INTERACTIVE_COMMANDS.help.examples = commandHelp.examples;
INTERACTIVE_COMMANDS.quit.help = 'Exits the program.';


function PrintUserStatus(context, userStatus) {
  if (!userStatus.statusText) {
    return;
  }
  var when = moment(userStatus.syncedAt).format('MMM D h:mm:ss A');
  context.view.log('%s %s',
      when,
      colors.dim.underline(userStatus.nick + ' ' + userStatus.statusText));
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
    var when = moment(message.syncedAt).format('MMM D h:mm:ss A');
    when = '{light-black-fg}' + when + '{/light-black-fg}';
    var author = colors.cyan.bold(message.author);

    // TODO We _could_ escape UGC.

    if (message.title && message.userUrl) {
      context.view.log('%s %s', when, author);
      context.view.log('    %s', colors.green(message.title));
      context.view.log('    %s', colors.underline(message.userUrl));
      if (message.text) {
        context.view.log('    %s', message.text);
      }
    } else if (message.title) {
      context.view.log('%s %s %s', when, author, colors.green(message.title));
      if (message.text) {
        context.view.log('    %s', message.text);
      }
    } else  if (message.url) {
      context.view.log('%s %s %s', when, author, colors.underline(message.userUrl));
      if (message.text) {
        context.view.log('    %s', message.text);
      }
    } else {
      context.view.log('%s %s %s', when, author, message.text);
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
