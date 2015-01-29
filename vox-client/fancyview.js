var blessed = require('blessed');
var consoleRedirect = require('./console-redirect');
var events = require('events');
var P = require('bluebird');
var util = require('util');


exports.FancyView = function() {
  var self = new events.EventEmitter();

  self.screen = blessed.screen({
      ignoreLocked: ['C-c'],
  });

  self.rootBox = blessed.box({
      parent: self.screen,
      width: '100%',
      height: '100%'
  });

  self.mainContentBox = blessed.list({
      parent: self.rootBox,
      top: 0,
      height: self.screen.height - 3,
      left: 0,
      width: '100%',
      align: 'left',
      fg: 'white',
      selectedBg: 'cyan',
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
  });

  self.helpBox = blessed.box({
      parent: self.rootBox,
      left: 'center',
      top: 'center',
      align: 'center',
      valign: 'middle',
      border: {
          type: 'line',
          fg: 3
      },
      padding: 1,
      tags: true,
      hidden: true,
      shrink: true
  });

  self.modeLine = blessed.box({
      parent: self.rootBox,
      top: self.screen.height - 3,
      height: 1,
      left: 0,
      width: '100%',
      bg: 'white',
      fg: 'black',
      tags: true,
      content: 'connecting...'
  })

  self.helpLine = blessed.box({
      parent: self.rootBox,
      top: self.screen.height - 2,
      height: 1,
      left: 0,
      width: '100%',
      bg: 'white',
      fg: 'black',
      tags: true,
      content: ''
  })

  self.inputBox = blessed.textbox({
      parent: self.rootBox,
      top: self.screen.height - 1,
      height: 1,
      left: 3,
      right: 0,
  });

  self.inputPrompt = blessed.text({
      parent: self.rootBox,
      top: self.screen.height - 1,
      height: 1,
      left: 0,
      width: 3,
      content: '...',
      fg: 'green'
  });

  function layout() {
    self.inputBox.top = self.screen.height - self.inputBox.height;
    self.helpLine.top = self.inputBox.top - self.helpLine.height;
    self.modeLine.top = self.helpLine.top - self.modeLine.height;
    self.mainContentBox.height = self.modeLine.top;

    self.inputPrompt.width = self.inputPrompt.content.length;
    self.inputBox.left = self.inputPrompt.getText().length;
    self.inputBox.width = self.screen.width - self.inputBox.left;
  }

  var render = self.render = function() {
    layout();
    self.screen.render();
  }

  self.screen.on('resize', render);

  self.inputBox.key(['C-c'], function(ch, key) {
    return process.exit(0);
  });

  self.screen.key(['C-c'], function(ch, key) {
    return process.exit(0);
  });

  self.inputBox.on('submit', function(val) {
    self.emit('input.submit', val);
    self.inputBox.clearValue();
  });

  self.inputBox.on('cancel', function(val) {
    self.emit('input.cancel', val);
    self.inputBox.clearValue();
  });

  self.mainContentBox.on('keypress', function(key) {
    self.emit('main.key', key);
  });

  self.Attach = function() {
    consoleRedirect.redirectConsoleOutput();
    self.mainContentBox.clearItems();
    render();
  }

  self.showHelp = function(text) {
    self.helpBox.setContent(text);
    self.helpBox.show();
    self.screen.render();
  }

  self.hideHelp = function() {
    self.helpBox.hide();
    self.screen.render();
  }

  var lines = 0;
  self.log = function(var_args) {
    var val = util.format.apply(null, arguments);
    self.mainContentBox.setLine(lines++, val);
    self.mainContentBox.setScrollPerc(100);
    self.screen.render();
  }

  self.question = function(question) {
    self.setPrompt(question);
    return new P(function(resolve, reject) {
      self.once('inputsubmit', function(text) {
        resolve(text)
      });
    })
  }

  self.prompt = function() {
    render();
  }

  self.setPrompt = function(prompt) {
    self.inputPrompt.setContent(prompt);
  }

  self.setModeLine = function(text) {
    self.modeLine.content = text;
  }

  self.setHelpLine = function(text) {
    self.helpLine.content = text;
  }

  self.setInputLine = function(line) {
    self.inputBox.clearValue();
    self.inputBox.setValue(line);
  }

  self.focusInput = function() {
    self.inputBox.focus();
    self.inputBox.readInput();
  }

  self.focusMainBox = function() {
    self.mainContentBox.focus();
  }

  // TODO doesn't work:
  // self.setInputColor = function(color) {
  //   self.inputBox.fg = blessed.colors.convert(color);
  // }

  return self;
}

