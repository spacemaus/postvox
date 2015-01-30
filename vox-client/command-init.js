var colors = require('colors');
var commandFollow = require('./command-follow');
var configs = require('./configs');
var errors = require('vox-common/errors');
var path = require('path');
var ursa = require('ursa');
var voxcommon = require('vox-common');



exports = module.exports = function(context) {
  if (context.privkey) {
    return UpdateExistingConfig(context);
  }
  return InitNewConfig(context);
}

exports.help = 'Registers a new user with the Postvox network and initializes the local config.  This must be run before any other commands.';
exports.examples = [
    '/init'
];


function InitNewConfig(context) {
  var view = context.view;
  var argv = context.argv;

  view.log('Ok, we\'re initializing your Vox config at %s%s',
      colors.dim('--configFile='),
      colors.bold(argv.configFile));
  view.log(path.resolve(argv.configFile));
  view.log('Upon completion, your new identity will be registered at the Hub.');
  view.log('---------------------------------------');

  var config = {};

  function AskForNickname() {
    if (argv.nick) {
      view.log('   (Using nickname from --nick flag)');
      return CheckForNickname(argv.nick)
        .then(function(nick) {
          if (!nick) {
            view.log(colors.red('Please try another value for --nick'));
            process.exit(1);
          } else {
            view.log('---------------------------------------');
            view.log('   Hi, %s!', colors.bold(nick));
            view.log('---------------------------------------');
            return nick;
          }
        });
    } else {
      view.log('1. What %s would you like to register?', colors.bold('nickname'));
      view.log(colors.dim('(Between 6 and 64 characters.  Must contain only letters or numbers.)'));
      return view.question('Nickname> ')
        .then(CheckForNickname)
        .then(function(nick) {
          if (!nick) {
            view.log('   Let\'s try again...');
            return AskForNickname();
          } else {
            view.log('---------------------------------------');
            view.log('   Hi, %s!', colors.bold(nick));
            view.log('---------------------------------------');
            return nick;
          }
        });
    }
  }

  function CheckForNickname(nick) {
    view.log('   Checking for availability...');
    return context.hubClient.GetUserProfileFromHub(nick)
      .then(
        function(entity) {
          view.log(colors.red('   Whoops, looks like that nickname has already been registered.'));
          return null;
        },
        function(err) {
          if (err.statusCode == 404) {
            view.log('   It\'s available!');
            return nick;
          } else if (err.statusCode == 400) {
            view.log(colors.red('   Whoops, looks like "%s" is not a valid nickname.'), nick);
            return null;
          } else {
            view.log(colors.red('Some kind of problem:'), err, err.stack);
            process.exit(1);
          }
        });
  }

  return AskForNickname()
    .then(function(nick) {
      config.nick = nick;
      return context.ReopenDatabaseForConfig(config);
    })
    .then(function() {
      privateKey = ursa.generatePrivateKey();
      config.pubkey = privateKey.toPublicPem('utf8');
      config.privkey = privateKey.toPrivatePem('utf8');
      context.SetPrivkey(config.privkey);
      view.log('   Your private key has been generated.  It is stored in:');
      view.log('   %s', colors.bold(argv.configFile));
      view.log(colors.bold('   This is the key to your identity, so don\'t lose it!'));
      view.log('---------------------------------------');
      view.log('');
      view.log('2. Next, where would you like to store your online data?');
      view.log('   This is where your posts will be stored.  It can be any Postvox-compatible server.  You can change this at any time by running %s again.', colors.bold('vox init'));
      view.log('   This should be a URL like %s', colors.bold('"http://example.com"'));
      view.log('   (Press ENTER to use the default server : %s)', colors.dim(argv.defaultInterchangeUrl));

      return view.question('Home server> ')
        .then(function(interchangeUrl) {
          config.interchangeUrl = interchangeUrl.trim();
          if (!config.interchangeUrl) {
            config.interchangeUrl = argv.defaultInterchangeUrl.trim();
          }
          config.interchangeUrl = MakeCanonicalInterchangeUrl(config.interchangeUrl);
          view.log('---------------------------------------');
          view.log('3. Finally, enter a line about yourself.  This will be seen by anyone who follows you.');
          return view.question('About ' + config.nick + '> ');
        })
        .then(function(aboutText) {
          config.about = { text: aboutText };
          view.log('---------------------------------------');
          view.log('Saving identity to disk...');
          configs.update(argv.configFile, config);
          view.log('Sending identity to the Hub...');
          return context.hubClient.RegisterUserProfile(
              IdentityConfigToUserProfile(config),
              config.privkey);
        })
        .then(function(userProfile) {
          view.log('OK!  Identity created!');
          context.config = config;
          context.nick = config.nick;
          context.privkey = ursa.createPrivateKey(config.privkey);
          view.log('Sending profile to home server');
          return SendProfileToInterchange(context, userProfile.interchangeUrl, userProfile);
        })
        .then(function() {
          return commandFollow.Follow(context, context.nick, 1);
        })
        .return(config);
    })
    .catch(function(err) {
      view.log('Oops! ', err, err.stack);
      process.exit(1);
    });
}


function UpdateExistingConfig(context) {
  var view = context.view;
  var argv = context.argv;
  var config = context.config;
  var oldInterchangeUrl = config.interchangeUrl;

  view.log('Ok, we\'re updating your Vox config at %s%s',
      colors.dim('--configFile='),
      colors.bold(argv.configFile));
  view.log('---------------------------------------');
  view.log('Nickname: %s', colors.bold(context.nick));
  view.log('---------------------------------------');
  view.log('1. Where would you like to store your online data?');
  view.log('   This is where your posts will be stored.  It can be any Postvox-compatible server.  You can change this at any time by running %s again.', colors.bold('vox init'));
  view.log('   This should be a URL like %s',
      colors.bold('"http://example.com"'));
  view.log('   (Press ENTER to keep the existing value: %s)', colors.dim(context.config.interchangeUrl));
  return view.question('Home server> ')
    .then(function(interchangeUrl) {
      var newInterchangeUrl = interchangeUrl.trim();
      if (newInterchangeUrl) {
        config.interchangeUrl = MakeCanonicalInterchangeUrl(newInterchangeUrl);
      }
      view.log('---------------------------------------');
      view.log('2. Finally, enter a line about yourself.  This will be seen by anyone who follows you.');
      var aboutText = context.config.about ? context.config.about.text : '';
      view.log('   (Press ENTER to keep the existing value: %s)', colors.dim(aboutText));
      return view.question('About ' + config.nick + '> ');
    })
    .then(function(aboutText) {
      if (aboutText) {
        config.about = { text: aboutText };
      }
      view.log('---------------------------------------');
      view.log('Saving identity to disk...');
      configs.update(argv.configFile, config);
      view.log('Sending identity to the Hub...');
      return context.hubClient.RegisterUserProfile(
          IdentityConfigToUserProfile(config),
          config.privkey);
    })
    .then(function(userProfile) {
      view.log('OK!  Identity updated!');
      var p = SendProfileToInterchange(context, userProfile.interchangeUrl, userProfile);
      if (oldInterchangeUrl && oldInterchangeUrl != userProfile.interchangeUrl) {
        p.then(function() {
          view.log('Notifying followers at %s of your new home server.', oldInterchangeUrl);
          return SendProfileToInterchange(context, oldInterchangeUrl, userProfile)
              .then(function() {
                return commandFollow.Follow(context, context.nick, 1);
              })
        });
      }
      return p;
    })
    .return(config);
}


function MakeCanonicalInterchangeUrl(interchangeUrl) {
  if (!interchangeUrl.toLowerCase().startsWith('http://')) {
    interchangeUrl = 'http://' + interchangeUrl;
  }
  return interchangeUrl;
}


function SendProfileToInterchange(context, interchangeUrl, userProfile) {
  var conn = context.connectionManager.ConnectByUrl(interchangeUrl)
  return conn.POST('vox://' + userProfile.nick + '/profile', userProfile);
}


function IdentityConfigToUserProfile(identity) {
  return {
      'about': JSON.stringify(identity.about),
      'nick': identity.nick,
      'interchangeUrl': identity.interchangeUrl,
      'pubkey': identity.pubkey,
      'updatedAt': identity.updatedAt || Date.now(),
  };
}
