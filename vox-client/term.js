/**
 * Interface to the terminal (command line).
 *
 * It's a thin wrapper around the readline module.  Adds support for bluebird
 * Promises.
 */


var colors = require('colors');
var P = require('bluebird');
var readline = require('readline');


exports.rl = rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: completer
});

exports.getCursorPos = rl._getCursorPos.bind(rl);
exports.setPrompt = rl.setPrompt.bind(rl);
exports.prompt = rl.prompt.bind(rl);
exports.moveCursor = readline.moveCursor;
exports.completer = null;

function completer(line, callback) {
  if (!exports.completer) {
    return;
  }
  return exports.completer(line, callback);
}

/**
 * Asks the user a question. Returns a Promise with the user's response.
 */
exports.question = function(prompt) {
  return new P(function(resolve, reject) {
    rl.question(prompt, function(reply) {
      resolve(reply);
    });
  });
}

/**
 * Write a message to the terminal, ensuring that the prompt line stays where
 * it's supposed to.
 */
exports.log = function() {
  if (process.stdout.clearLine) {
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
  }
  console.log.apply(null, arguments);
}

exports.err = function() {
  exports.log.apply(null, arguments);
}
