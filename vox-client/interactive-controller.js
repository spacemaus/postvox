var authentication = require('vox-common/authentication');
var Chain = require('vox-common/chain');
var colors = require('colors');
var debug = require('debug')('vox:interactive-controller');
var errors = require('vox-common/errors');
var moment = require('moment');
var P = require('bluebird');
var urlparse = require('url');
var util = require('util');
var voxurl = require('vox-common/voxurl');


var SYNC_CHECKPOINT = 'interactive-controller-sync'


function InteractiveController(context) {
  this._messagePrinter = new MessagePrinter();
  this.view = context.view;
  this.vox = context.voxClient;

  this.inboxPage = new InboxPage(this, this.vox, this.view);
  this.streamPage = new StreamPage(this, this.vox, this.view);

  this.activePage = null;
}
module.exports = InteractiveController;


InteractiveController.prototype.start = function() {
  var view = this.view;

  view.setModeLine('Connected as %s', colors.bold(this.vox.nick));
  view.showHelp(
    util.format('Welcome, %s!', colors.yellow.bold(this.vox.nick)) + '\n\n' +
    util.format('To get started, type %s to follow someone, type %s to get help, or type %s to post a message to your stream.', colors.yellow.bold(':follow ' + colors.underline('nickname')), colors.yellow.bold(':help'), colors.yellow.bold("'")));

  view.once('main.key', function() {
    view.hideHelp();
  });

  view.on('input.cancel', this.cancelInput.bind(this));

  var self = this;
  view.on('main.key', function(char, key) {
    if (char == ':') {
      self._promptForCommand();
    } else {
      self.activePage.onMainKey(char, key);
    }
  });

  this.vox.on('error', function(error) {
    view.log(colors.red('Error: %s'), error);
  })

  this.showStreamPage('__everything__');
}

InteractiveController.prototype.cancelInput = function() {
  this.view.focusMainBox();
  this.view.setPrompt('');
  if (this.activePage) {
    this.activePage.showDefaultHelpLine();
  }
  this.view.prompt();
  this.view.removeAllListeners('input.submit');
}

InteractiveController.prototype.showInboxPage = function() {
  if (this.activePage) {
    this.activePage.hide();
  }
  this.activePage = this.inboxPage;
  this.inboxPage.show();
}

InteractiveController.prototype.showStreamPage = function(stream) {
  if (this.activePage) {
    this.activePage.hide();
  }
  this.activePage = this.streamPage;
  this.streamPage.show(stream);
}

InteractiveController.prototype._promptForCommand = function() {
  var view = this.view;
  view.focusInput();
  view.setInputColor('green');
  view.setPrompt('Command: :');
  view.prompt();
  view.setHelpLine([
      ':help',
      ':follow user[/stream]',
      ':unfollow user[/stream]',
  ].join(', '))
  view.once('input.submit', this._handleCommand.bind(this));
}

InteractiveController.prototype._handleCommand = function(line) {
  var view = this.view;
  this.cancelInput();
  var parts = split2(line);
  var cmdName = parts[0];
  var handler = this['command_' + cmdName];
  if (!handler) {
    view.log(colors.red('No such command: %s'), cmdName);
    view.scrollToEnd();
  } else {
    P.method(handler.bind(this))(parts[1])
      .then(function() { view.prompt() })
      .finally(view.scrollToEnd)
      .catch(function(err) {
        view.log(colors.red('Error:'), err, err.stack);
      });
  }
}

InteractiveController.prototype.command_read = function(stream) {
  this.showStreamPage(voxurl.toCanonicalUrl(stream));
}

InteractiveController.prototype.command_follow = function(stream) {
  var self = this;
  self.vox.subscribe(stream)
    .then(function(subscription) {
      if (self.activePage == self.inboxPage) {
        self.inboxPage.appendSubscription(subscription);
        self.view.prompt();
      }
    })
    .catch(function(error) {
      self.view.log(colors.red('Error %s'), error);
    });
}

InteractiveController.prototype.command_unfollow = function(stream) {
  var self = this;
  self.vox.unsubscribe(stream)
    .catch(function(error) {
      self.view.log(colors.red('Error %s'), error);
    })
    .then(function(){
      if (self.activePage == self.inboxPage) {
        self.inboxPage.removeSubscription(stream);
      } else if (self.streamPage.streamUrl == voxurl.toCanonicalUrl(stream)) {
        self.showInboxPage();
      } else if (self.streamPage.streamUrl == '__everything__') {
        self.showStreamPage('__everything__');
      }
    })
}

InteractiveController.prototype.command_help = function() {
  this.activePage.showHelp();
  var view = this.view;
  P.delay(100).then(function() { // TODO Ick.
    view.once('main.key', function() {
      view.hideHelp();
    });
  });
}

InteractiveController.prototype.command_quit = function() {
  var self = this;
  self.view.log('Goodbye!');
  self.vox.close();
  P.delay(500).then(function() {
    process.exit(0);
  });
}


////////////////
// Inbox Page //
////////////////

function InboxPage(controller, vox, view) {
  this.controller = controller;
  this.vox = vox;
  this.view = view;
  this.visible = false;
  this._unreadCounts = {};
  this._readStream = this.vox.createReadStream({
        type: 'MESSAGE',
        startSeq: 1,
        checkpointKey: SYNC_CHECKPOINT
    })
    .on('data', this._incrementUnreadCount.bind(this))
    .on('error', this._onReadStreamError.bind(this));
}

InboxPage.prototype.show = function() {
  var self = this;
  var view = this.view;
  view.setTitleLine('Inbox - the list the streams you\'ve followed');
  view.setModeLine('');
  self.showDefaultHelpLine();
  view.clearLines();
  view.setPrompt('');
  view.focusMainBox();
  view.scrollToTop();
  view.prompt();

  this.visible = true;

  view.appendLine(colors.bold.cyan('Everything'),
      '__everything__', { url: '__everything__' });
  view.selectLine(0);

  this.vox.listSubscriptions()
    .then(function(subscriptions) {
      if (!self.visible) {
        return;
      }
      if (!subscriptions.length) {
        view.log('No subscriptions.  Type :follow <nickname>.')
      }
      subscriptions.forEach(self.appendSubscription.bind(self));
      view.prompt();
    });
}

InboxPage.prototype.clearUnreadCount = function(stream) {
  this._unreadCounts[stream] = 0;
}

InboxPage.prototype.clearAllUnreadCounts = function() {
  this._unreadCounts = {};
}

InboxPage.prototype._incrementUnreadCount = function(stanza) {
  debug('Incrementing unread count for %s', stanza.stream);
  var count = this._unreadCounts[stanza.stream] || 0;
  count++;
  this._unreadCounts[stanza.stream] = count;
  if (!this.visible) {
    return;
  }
  var url = voxurl.toCanonicalUrl(stanza.stream);
  var item = this.view.getItem(url);
  if (!item || !item.itemData) {
    return;
  }
  item.content = this._formatSubscription(url, item.itemData.interchangeUrl, count);
  this.view.prompt();
}

InboxPage.prototype.appendSubscription = function(subscription) {
  var item = this.view.getItem(subscription.url);
  if (item != null) {
    return;
  }
  var count = this._unreadCounts[voxurl.toStream(subscription.url)] || 0;
  this.view.appendLine(
      this._formatSubscription(subscription.url, subscription.interchangeUrl, count),
      subscription.url, subscription);
}

InboxPage.prototype._formatSubscription = function(
    subscriptionUrl, interchangeUrl, unreadCount) {
  var host = urlparse.parse(interchangeUrl).host;
  var name = subscriptionUrl.replace('vox:', '@');
  if (unreadCount) {
    return colors.bold.yellow(name) +
        this.view.lightBlack(util.format(' (%s)', host)) +
        colors.bold.green(util.format(' [%d]', unreadCount));
  }
  return colors.bold.yellow(name) +
      this.view.lightBlack(util.format(' (%s)', host));
}

InboxPage.prototype.removeSubscription = function(stream) {
  this.view.removeLine(voxurl.toCanonicalUrl(stream));
  this.view.scrollToTop();
  this.view.prompt();
}

InboxPage.prototype._onReadStreamError = function(error) {
  this.view.log(colors.red('Read error: %s'), error);
}

InboxPage.prototype.hide = function() {
  this.visible = false;
}

InboxPage.prototype.onMainKey = function(char, key) {
  if (char == 'r' || char == 'o' || key.name == 'enter') {
    this.openSelectedStream();
  }
}

InboxPage.prototype.openSelectedStream = function() {
  var view = this.view;
  var item = view.getSelectedItem();
  if (!item) {
    view.setHelpLine(colors.red('No stream selected.'));
    return;
  }
  this.controller.showStreamPage(item.itemData.url);
}

InboxPage.prototype.showDefaultHelpLine = function() {
  this.view.setHelpLine([
      ':help',
      ':follow user[/stream]',
      ':unfollow user[/stream]',
  ].join(', '))
}

InboxPage.prototype.showHelp = function() {
  var g = colors.bold.green;
  this.view.showHelp([
    colors.bold.underline('Keys:'),
    g('j') + ' or ' + g('up') + ': move cursor up',
    g('k') + ' or ' + g('down') + ': move cursor down',
    g('o') + ' or ' + g('enter') + ': view stream',
    ].join('\n'));
}


/////////////////
// Stream Page //
/////////////////

function StreamPage(controller, vox, view) {
  this.visible = false;
  this._streamPrinted = null;
  this._messagePrinter = null;
  this.controller = controller;
  this.vox = vox;
  this.view = view;
  this.streamUrl = null;
  this.streamName = null;
  this._scrollLocked = false;
  this._readStream = null;
  this._checkpointStream = null;
}

StreamPage.prototype.show = function(url) {
  var view = this.view;
  this.streamUrl = url;
  this._streamPrinted = {};
  this._messagePrinter = new MessagePrinter(view);
  view.setTitleLine('Stream: ' + colors.bold.yellow(url));
  view.setModeLine('Connecting to interchange...');
  this.showDefaultHelpLine();
  view.clearLines();
  view.focusMainBox();
  view.prompt();

  this.visible = true;

  var stream;
  if (url == '__everything__') {
    stream = undefined;
    view.setTitleLine(colors.bold.cyan('All subscriptions'));
    view.setModeLine('Viewing all subscriptions');
    view.prompt();
  } else {
    stream = voxurl.toStream(url);
    // Set the title and modeline:
    this.vox.getInterchangeSession(voxurl.toSource(url))
      .then(function(conn) {
        view.setTitleLine('Stream: %s (%s)', colors.bold.green(url), conn.interchangeUrl);
        view.setModeLine('Reading %s', colors.bold.green(url));
        view.prompt();
      })
      .catch(function(err) {
        view.log(colors.red('Oops, could not view the stream %s: %s'), stream, err.message);
      })
  }

  // Populate the stream display:
  var self = this;
  this._readStream = this.vox.createReadStream({
      stream: stream,
      seqStart: -50,
      batchMode: true
  });
  this._readStream.on('data', function(stanzas) {
    if (!self.visible) {
      return;
    }
    stanzas.forEach(function(stanza) {
      if (stanza.type == 'MESSAGE') {
        self._messagePrinter.printMessage(stanza, self._streamPrinted);
      }
    });
    self.view.scrollToEnd();
  });
  this._readStream.on('error', function(error) {
    self.view.log(colors.red('Read error: %s'), error);
  })
  this._checkpointStream = this.vox.createCheckpointStream({ checkpointKey: SYNC_CHECKPOINT });
  this._readStream.pipe(this._checkpointStream);

  // view.on('main.underscroll', function(count) {
  //   var item = view.getLine(0);
  //   if (!item || !item.itemData) {
  //     return;
  //   }
  //   var seqLimit = item.itemData.seq;
  //   this.vox.createReadStream({
  //       stream: voxurl.toStream(url),
  //       limit: count,
  //       reverse: true,
  //       seqLimit: seqLimit,
  //       batchMode: true
  //   })
  //   .on('data', function(stanzas) {

  //   });
  // })
}

StreamPage.prototype.hide = function() {
  this.visible = false;
  this._readStream.close();
  this._readStream = null;
  if (this.streamUrl == '__everything__') {
    this.controller.inboxPage.clearAllUnreadCounts();
  } else {
    this.controller.inboxPage.clearUnreadCount(voxurl.toStream(this.streamUrl));
  }
}

StreamPage.prototype.onMainKey = function(char, key) {
  if (char == '\'') {
    this.promptForMessageInput();
  } else if (char == '@') {
    this.view.setInputLine('@');
    this.promptForMessageInput();
  } else if (char == 'r') {
    var item = this.view.getSelectedItem();
    if (item && item.itemData && item.itemData.type == 'MESSAGE') {
      this.promptForMessageInput({ replyTo: item.itemData });
    }
  } else if (char == 't') {
    var item = this.view.getSelectedItem();
    if (item && item.itemData && item.itemData.type == 'MESSAGE') {
      var stanza = item.itemData;
      var itemKey = voxurl.getStanzaUrl(stanza);
      var url = stanza.thread || stanza.replyTo || voxurl.getStanzaUrl(stanza);
      this.printThread(itemKey, url);
    }
  } else if (char == 'u') {
    this.controller.showInboxPage();
  }
}

StreamPage.prototype.promptForMessageInput = function(options) {
  var view = this.view;
  view.focusInput();
  view.setInputColor('white');
  if (options && options.replyTo) {
    var replyTo = options.replyTo;
    view.setHelpLine('Replying to ' +
        (colors.cyan(replyTo.nick) + ' ' + replyTo.text.substr(0, 60)));
    view.setPrompt('Reply> ');
    if (replyTo.nick != this.vox.nick) {
      view.setInputLine('@%s ', replyTo.nick);
    }
  } else {
    var streamName = this.streamUrl == '__everything__' ? this.vox.nick : this.streamUrl;
    view.setHelpLine('Posting to: %s', colors.bold.green(streamName));
    view.setPrompt('Say (%s)> ', streamName);
  }
  view.prompt();
  view.once('input.submit', this.handleMessageCommand.bind(this, options));
}

StreamPage.prototype.handleMessageCommand = function(options, line) {
  var view = this.view;
  view.focusMainBox();
  view.setPrompt('');
  this.showDefaultHelpLine();
  view.prompt();
  if (!line) {
    view.scrollToEnd();
    return;
  }
  var self = this;
  var stream = self.streamUrl == '__everything__' ? undefined : voxurl.toStream(self.streamUrl);
  var stanza = {
      stream: stream,
      text: line,
  };
  if (options && options.replyTo) {
    stanza.replyTo = voxurl.getStanzaUrl(options.replyTo);
    stanza.thread = options.replyTo.thread || stanza.replyTo;
  }
  this.vox.post(stanza)
    .then(function(message) {
      if (!self.visible) {
        return;
      }
      self._messagePrinter.printMessage(message, self._streamPrinted);
      var stanzaUrl = voxurl.getStanzaUrl(message);
      self.view.selectItem(stanzaUrl);
    })
    .finally(view.scrollToEnd)
    .catch(function(err) {
      view.log(colors.red('Error:'), err, err.stack);
    });
}

StreamPage.prototype.printThread = function(itemKey, threadUrl) {
  debug('Printing thread for %s', threadUrl);
  var self = this;
  // TODO Go through an interface for this:
  P.join(
    self.vox.db.getStanza(threadUrl),
    self.vox.db.listStanzas({
        thread: threadUrl
    }),
    function(root, stanzas) {
      self.view.log(colors.yellow('--- Thread (%s) ---------------------'), threadUrl);
      var mp = self._messagePrinter;
      var printedMessages = {};
      mp.clearReplyChain();
      if (root) {
        mp.printMessage(root, printedMessages);
      }
      stanzas.forEach(function(stanza) {
        mp.printMessage(stanza, printedMessages);
      });
      self.view.selectItem(itemKey);
      self.view.scrollToEnd();
    })
}

StreamPage.prototype.showDefaultHelpLine = function() {
  this.view.setHelpLine(util.format('Type %s or %s to post, %s to reply, %s to print a thread, %s for help', colors.green.bold("'"), colors.green.bold('@'), colors.green.bold('r'), colors.green.bold('t'), colors.green.bold(':help')))
}

StreamPage.prototype.showHelp = function() {
  var g = colors.bold.green;
  this.view.showHelp([
      colors.bold.underline('Keys:'),
      g('\'') + ' or ' + g('@') + ': post a new message',
      g('r') + ': reply to selected message',
      g('t') + ': print selected thread',
      g('j') + ' or ' + g('up') + ': move selection up',
      g('k') + ' or ' + g('down') + ': move selection down',
      g('b') + ': scroll up one page',
      g('space') + ': scroll down one page',
      g('g') + ': scroll to beginning',
      g('G') + ': scroll to end',
      g('u') + ': view list of subscriptions',
  ].join('\n'));
}

/////////////////////
// Message Printer //
/////////////////////

function MessagePrinter(view) {
  this.view = view;
  this.replyChain = [];
  this.cloneToMessageUrl = {};
  this.messages = {};
}

MessagePrinter.prototype.printMessage = function(message, opt_alreadyPrinted) {
  var view = this.view;
  var stanzaUrl = voxurl.getStanzaUrl(message)
  var url = message.clone || stanzaUrl;

  if (message.clone) {
    this.cloneToMessageUrl[stanzaUrl] = message.clone;
  }

  if (opt_alreadyPrinted) {
    if (url in opt_alreadyPrinted) {
      return;
    }
    opt_alreadyPrinted[url] = 1;
  }

  this.messages[stanzaUrl] = message;

  var formattedSyncedAt = moment(message.syncedAt).format('MMM D h:mm:ss A');
  var when = view.lightBlack(formattedSyncedAt);
  var author = colors.cyan.bold(message.nick);

  // TODO We _could_ escape UGC.

  if (message.title) {
    view.appendLine(
        util.format('%s %s %s', when, author, colors.green(message.title)),
        stanzaUrl, message);
    if (message.userUrl) {
      view.log('    %s', colors.underline(message.userUrl));
    }
    if (message.text) {
      message.text.split('\n').forEach(function(line) {
        view.log('    %s', line);
      })
    }
  } else  if (message.url) {
    view.appendLine(
        util.format('%s %s %s', when, author, colors.underline(message.userUrl)),
        stanzaUrl, message);
    if (message.text) {
      view.log('    %s', message.text);
    }
  } else {
    var indent = '';
    if (message.replyTo) {
      var replyTo = this.cloneToMessageUrl[message.replyTo] || message.replyTo;
      var i = this.replyChain.indexOf(replyTo);
      indent = colors.yellow('└ ');
      if (i != -1) {
        i = Math.min(i, 2);
        indent = ' '.repeat(i * 2) + colors.yellow('└ ');
        this.replyChain.splice(i + 1);
        this.replyChain.push(url);
      } else {
        var repliedTo = this.messages[replyTo];
        if (repliedTo) {
          var whenz = '-'.repeat(colors.stripColors(formattedSyncedAt).length - 2) + view.lightBlack('>>');
          this.printRepliedToMessage(repliedTo, whenz);
          this.replyChain = [replyTo, url];
        }
      }
    }
    if (!indent)  {
      this.replyChain = [url];
    }
    var line = util.format('%s %s%s %s', when, indent, author, message.text);
    view.appendLine(line, stanzaUrl, message);
  }
}

MessagePrinter.prototype.clearReplyChain = function() {
  this.replyChain = [];
}

MessagePrinter.prototype.printRepliedToMessage = function(message, when) {
  var prefix = util.format('%s %s ',
      when,
      message.nick);
  var text = message.title ? message.title : message.text;
  var quotedText = text.substr(0, this.view.columns() - (colors.stripColors(prefix).length + 3));
  if (quotedText.length != text.length) {
    quotedText += '...';
  }
  this.view.appendLine(this.view.lightBlack(
      prefix + quotedText,
      voxurl.getStanzaUrl(message),
      message));
}


function split2(line) {
  var i = line.indexOf(' ');
  if (i == -1) {
    return [line, ''];
  }
  return [line.substring(0, i), line.substring(i + 1).trim()];
}
