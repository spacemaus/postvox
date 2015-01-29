var colors = require('colors');
var P = require('bluebird');


exports = module.exports = function(context, args) {
  if (args[0]) {
    PrintCommandHelp(context, args[0]);
  } else {
    if (!context.interactive) {
      var log = context.view.log;
      log('This is a bare-bones Postvox command-line client.');
      log('It illustrates how a single-user Postvox client may be implemented.');
      log('');
      log('Run it in interactive mode like so:');
      log('');
      log('    $ vox');
      log('');
      log('The first time it is run, it will prompt you to create an account on the Hub.');
      log('It will create a private encryption key for you, and store it in your config');
      log('file.');
      log('');
      log('By default, it stores its config and database files in $HOME/.voxconfig.yaml');
      log('and $HOME/.voxhistory/vox-<nickname>.db.  If you\'d like to customize those');
      log('paths:');
      log('');
      log('    $ vox --configFile path/to/config.yaml --dbDir path/to/my/dir');
      log('');
      log('If you\'d like to see what the client is sending and receiving over the');
      log('network, set the DEBUG environment variable:');
      log('');
      log('    $ DEBUG=\'vox:interchangeclient\' vox');
      log('or');
      log('    $ DEBUG=\'vox:*\' vox');
      log('');
      log('To run a command in non-interactive mode:');
      log('');
      log('    $ vox %s %s', colors.underline('command-name'), colors.underline('argument'));
      log('');
      log('E.g.:');
      log('');
      log('    $ vox follow spacemaus');
      log('');
      log(colors.underline.bold('Commands:'));
      log('');
    }
    PrintAllHelp(context);
  }
  return P.resolve();
}

exports.help = 'Prints help for a specific command, or for all the available commands.';
exports.examples = [
    '/help follow'
];


function PrintCommandHelp(context, cmdName) {
  var view = context.view;
  var cmd = context.commands[cmdName];
  if (!cmd) {
    view.log(colors.red('No such command: %s'), cmdName);
    return;
  }
  var printName = context.interactive ? '/' + cmdName : cmdName;
  view.log(colors.yellow.bold(printName));
  if (cmd.help) {
    view.log(cmd.help);
  }
  if (cmd.examples) {
    view.log(colors.dim('Examples:'));
    cmd.examples.forEach(function(example) {
      view.log('    %s', example);
    });
  }
  if (cmd.flags) {
    view.log(colors.dim('Command-line flags:'));
    for (var name in cmd.flags) {
      var details = cmd.flags[name];
      view.log('    --%s', name);
      view.log('      %s', details.help);
      if (details.examples) {
        details.examples.forEach(function(example) {
          view.log(colors.dim('      e.g. --%s=%s'), name, example);
        });
      }
    }
  }
  view.log('');
}

function PrintAllHelp(context) {
  var names = Object.keys(context.commands).sort();
  names.forEach(PrintCommandHelp.bind(null, context));
}
