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

  self.titleLine = blessed.box({
      parent: self.rootBox,
      top: 0,
      height: 1,
      left: 0,
      width: '100%',
      bg: 'white',
      fg: 'black'
  })

  self.mainContentBox = blessed.box({
      parent: self.rootBox,
      top: 1,
      height: self.screen.height - 4,
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
  });

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
  });

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
    self.mainContentBox.height = self.modeLine.top - self.titleLine.height;

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

  self.mainContentBox.on('keypress', function(char, key) {
    self.emit('main.key', char, key);
    var box = self.mainContentBox;
    if (char == ' ' || key.name == 'pagedown') {
      var lines = self.mainContentBox.height;
      box.scroll(lines + 1);
      box.down(lines); // Probably broken with long lines.
    } else if (char == 'b' || key.name == 'pageup') {
      var lines = self.mainContentBox.height;
      var amount = -lines - 1;
      box.scroll(amount);
      box.up(lines);
      if (box.getScroll() - amount <= 0) {
        self.emit('main.underscroll');
      }
    } else if (char == 'g' || key.name == 'home') {
      box.setScrollPerc(0);
      box.select(0);
    } else if (char == 'G' || key.name == 'end') {
      box.setScrollPerc(100);
      box.select(box.children.length - 1);
    }
    self.screen.render();
  });

  self.mainContentBox.key(['down', 'j'], function() {
    var box = self.mainContentBox;
    box.scroll(1);
    box.down(1);
    self.screen.render();
  })

  self.mainContentBox.key(['up', 'k'], function() {
    var box = self.mainContentBox;
    var underscroll = box.getScroll() == 0;
    box.scroll(-1);
    box.up(1);
    self.screen.render();
    if (underscroll) {
      self.emit('main.underscroll');
    }
  })

  self.attach = function() {
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
    self.appendLine(util.format.apply(null, arguments));
  }

  self.clearLines = function() {
    self.mainContentBox.clearItems();
  }

  self.appendLine = function(val, itemKey, itemData) {
    self.mainContentBox.addItem(val, itemKey, itemData);
    // TODO Only flash when new line is offscreen.
    self.modeLine.style.bg = 'yellow';
    setTimeout(function() {
      self.modeLine.style.bg = 'white';
      self.screen.render();
    }, 300);
    self.screen.render();
  }

  self.removeLine = function(itemKey) {
    self.mainContentBox.removeItem(itemKey);
  }

  self.getItem = function(itemKey) {
    return self.mainContentBox.getItem(itemKey);
  }

  self.selectItem = function(itemKey) {
    self.mainContentBox.selectItem(itemKey);
  }

  self.getSelectedItem = function() {
    return self.mainContentBox.getSelectedItem();
  }

  self.getLine = function(n) {
    self.mainContentBox.children[n];
  }

  self.selectLine = function(n) {
    self.mainContentBox.select(n);
  }

  self.scrollToTop = function() {
    self.mainContentBox.setScrollPerc(0);
  }

  self.scrollToEnd = function() {
    var box = self.mainContentBox;
    var item = box.getSelectedItem();
    if (!item || box.getScrollHeight() - box.height <= item.rtop) {
      box.setScrollPerc(100);
      self.screen.render();
    }
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

  self.setPrompt = function(var_args) {
    self.inputPrompt.setContent(util.format.apply(util, arguments));
  }

  self.setTitleLine = function(var_args) {
    self.titleLine.content = util.format.apply(util, arguments);
  }

  self.setModeLine = function(var_args) {
    self.modeLine.content = util.format.apply(util, arguments);
  }

  self.setHelpLine = function(var_args) {
    self.helpLine.content = util.format.apply(util, arguments);
  }

  self.setInputLine = function(var_args) {
    self.inputBox.clearValue();
    self.inputBox.setValue(util.format.apply(util, arguments));
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

  self.lightBlack = function(s) {
    return '{light-black-fg}' + s + '{/light-black-fg}';
  }

  self.columns = function() {
    return self.screen.width;
  }

  self.mainRows = function() {
    return self.mainContentBox.height;
  }

  return self;
}


/**
 * blessed's List widget doesn't seem to support lines that need to wrap, so we
 * implement something like it here.
 */
function attachSelectionMethods(box) {
  box.selected = 0;

  var nextTop = 0;
  var items = {};

  box.layout = function() {
    nextTop = 1;
    box.children.forEach(function(child) {
      child.top = nextTop;
      child.height = child.getScreenLines().length;
      nextTop += child.height;
    })
  }

  box.addItem = function(text, itemKey, itemData) {
    var node = blessed.text({
        left: 0,
        right: 0,
        top: nextTop,
        height: 1,
        tags: true,
        content: text
    });
    node.itemData = itemData;
    items[itemKey] = node;
    box.append(node);
    node.height = node.getScreenLines().length;
    nextTop += node.height;
  }

  box.getItem = function(itemKey) {
    return items[itemKey];
  }

  box.selectItem = function(itemKey) {
    var item = box.getItem(itemKey);
    if (!item) {
      return;
    }
    var i = box.children.indexOf(item);
    if (i == -1) {
      return;
    }
    box.select(i);
  }

  box.removeItem = function(itemKey) {
    var item = items[itemKey];
    if (!item) {
      return;
    }
    delete items[itemKey];
    item.detach();
    box.layout();
  }

  box.clearItems = function() {
    box.children.slice().forEach(function(child) {
      child.detach();
    });
    box.selected = -1;
    nextTop = 0;
    items = {};
  }

  box.up = function(n) {
    if (box.selected == -1) {
      box.select(box.children.length - 1);
    } else {
      n = n === undefined ? 1 : n;
      box.select(box.selected - n);
    }
  }

  box.down = function(n) {
    if (box.selected == -1) {
      box.select(box.children.length - 1);
    } else {
      n = n === undefined ? 1 : n;
      box.select(box.selected + n);
    }
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

  box.getSelectedItem = function() {
    return box.children[box.selected];
  }

  function highlight(n, on) {
    var item = box.children[n];
    if (!item) {
      return;
    }
    item.style.inverse = on;
  }
}
