/**
 * Interface to the terminal (command line).
 *
 * It's a thin wrapper around the readline module.  Adds support for bluebird
 * Promises.
 *
 * It has the same interface as fancyview.js, but is less fancy.
 */


var colors = require('colors');
var P = require('bluebird');
var readline = require('readline');
var events = require('events');


exports.TermView = function() {
  var self = new events.EventEmitter();

  self.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer: function(line, callback) {
        if (!self.completer) {
          return;
        }
        return self.completer(line, callback);
      }
  });

  var rl = self.rl;

  self.setPrompt = rl.setPrompt.bind(rl);

  self.prompt = function() {
    rl.prompt();
    var end = colors.stripColors(rl._prompt + rl.line).length;
    readline.cursorTo(rl.output, end);
    rl.cursor = colors.stripColors(rl.line).length;
  }
  self.completer = null;

  /**
   * Asks the user a question. Returns a Promise with the user's response.
   */
  self.question = function(prompt) {
    return new P(function(resolve, reject) {
      self.focusInput();
      rl.question(prompt, function(reply) {
        resolve(reply);
      });
    });
  }

  /**
   * Write a message to the terminal, ensuring that the prompt line stays where
   * it's supposed to.
   */
  self.log = function() {
    if (process.stdout.clearLine) {
      process.stdout.clearLine();
      process.stdout.cursorTo(0);
    }
    console.log.apply(null, arguments);
  }

  self.err = function() {
    self.log.apply(null, arguments);
  }

  self.showHelp = function(text) {
    self.log(text)
  }
  self.hideHelp = function() {}

  self.setModeLine = function() {}
  self.setHelpLine = function() {}
  self.scrollToEnd = function() {}
  self.setInputColor = function() {}
  self.render = function() {}

  self.lightBlack = function(s) {
    return colors.dim(s);
  }

  self.setInputLine = function(text) {
    rl.line = text;
    self.prompt();
  }

  var focused = 'main';

  self.focusInput = function() {
    focused = 'input';
  }

  self.focusMainBox = function() {
    focused = 'main';
  }

  process.stdin.on('keypress', function(key) {
    if (focused != 'input') {
      rl.line = '';
    }
    self.emit(focused + '.key', key);
  })

  rl.on('line', function(text) {
    self.emit('input.submit', text);
  });

  rl.on('close', function() {
    process.exit(0);
  });

  return self;
}

