var P = require('bluebird');
var InteractiveController = require('./interactive-controller');


/**
 * Starts an interactive session.
 */
exports = module.exports = function(context, args) {
  context.interactive = true;
  var controller = new InteractiveController(context);
  controller.start();
  return(new P(function(resolve) {})); // Never resolves, so we stay alive foreeever.
};
