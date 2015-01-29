var argv = require('./argv');
var fs = require('fs');
var util = require('util');


var original = {
  warn: console.warn,
  error: console.error,
}


exports.redirectConsoleOutput = function() {
  var out = fs.createWriteStream(argv.stderrLogsPath, { flags: 'w+' });
  function writer(var_args) {
    out.write(util.format.apply(null, arguments));
    out.write('\n');
  }
  console.info = console.warn = console.error = writer;
}
