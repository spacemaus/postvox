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

  self.mainContentBox = blessed.box({
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
      scrollbar: {
          bg: 'yellow'
      }
  });
  attachSelectionMethods(self.mainContentBox);

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

  self.screen.on('resize', function() {
    self.mainContentBox.layout();
    layout();
  });

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
    var cb = self.mainContentBox;
    if (key == ' ') {
      var lines = self.mainContentBox.height;
      cb.scroll(lines);
      cb.down(lines); // Probably broken with long lines.
    } else if (key == 'b') {
      var lines = self.mainContentBox.height;
      cb.scroll(-lines);
      cb.up(lines);
    } else if (key == 'g') {
      cb.setScrollPerc(0);
      cb.select(0);
    } else if (key == 'G') {
      cb.setScrollPerc(100);
      cb.select(cb.children.length - 1);
    }
    updateScroll();
  });

  self.mainContentBox.key(['down', 'j'], function() {
    var cb = self.mainContentBox;
    cb.setScroll(cb.getScroll() + 1);
    cb.down(1);
    updateScroll();
  })

  self.mainContentBox.key(['up', 'k'], function() {
    var cb = self.mainContentBox;
    cb.setScroll(cb.getScroll() - 1);
    cb.up(1);
    updateScroll();
  })

  function updateScroll() {
    self.screen.render();
    self.scrollFollow = self.mainContentBox.selected == self.mainContentBox.children.length - 1;
  }

  self.scrollFollow = true;

  self.Attach = function() {
    consoleRedirect.redirectConsoleOutput();
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

  self.log = function(var_args) {
    var val = util.format.apply(null, arguments);
    self.mainContentBox.addItem(val);
    if (self.scrollFollow) {
      self.mainContentBox.select(self.mainContentBox.children.length - 1);
      self.mainContentBox.setScrollPerc(100);
    } else {
      // TODO Only flash when new line is offscreen.
      self.modeLine.style.bg = 'yellow';
      self.screen.render();
      setTimeout(function() {
        self.modeLine.style.bg = 'white';
        self.screen.render();
      }, 300);
    }
    self.screen.render();
  }

  self.scrollToEnd = function() {
    self.mainContentBox.select(self.mainContentBox.children.length - 1);
    self.mainContentBox.setScrollPerc(100);
    updateScroll();
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

  self.setInputColor = function(color) {
    self.inputBox.style.fg = blessed.colors.convert(color);
  }

  return self;
}


/**
 * blessed's List widget doesn't seem to support lines that need to wrap, so we
 * implement something like it here.
 */
function attachSelectionMethods(box) {
  box.selected = 0;

  var lines = 0;

  box.layout = function() {
    lines = 0;
    box.children.forEach(function(child) {
      child.top = lines;
      child.height = child.getScreenLines().length;
      lines += child.height;
    })
  }

  box.addItem = function(text) {
    var node = blessed.text({
        width: '100%',
        top: lines,
        height: 1,
        tags: true,
        content: text
    });
    box.append(node);
    node.height = node.getScreenLines().length;
    lines += node.height;
  }

  box.up = function(n) {
    n = n === undefined ? 1 : n;
    box.select(box.selected - n);
  }

  box.down = function(n) {
    n = n === undefined ? 1 : n;
    box.select(box.selected + n);
  }

  box.select = function(n) {
    highlight(box.selected, false);
    n = Math.max(0, Math.min(box.children.length - 1, n));
    if (n == -1) {
      return;
    }
    box.selected = n;
    highlight(n, true);
  }

  function highlight(n, on) {
    var item = box.children[n];
    if (!item) {
      return;
    }
    item.style.underline = on;
  }
}
