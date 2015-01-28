var colors = require('colors');
var commandFollow = require('./command-follow');
var configs = require('./configs');
var errors = require('vox-common/errors');
var path = require('path');
var ursa = require('ursa');
var voxcommon = require('vox-common');



exports = module.exports = function(context) {
  if (context.nick) {
    return UpdateExistingConfig(context);
  }
  return InitNewConfig(context);
}

exports.help = 'Registers a new user with the Postvox network and initializes the local config.  This must be run before any other commands.';
exports.examples = [
    '/init'
];


function InitNewConfig(context) {
  var term = context.term;
  var argv = context.argv;

  term.log('Ok, we\'re initializing your Vox config at %s%s',
      colors.dim('--configFile='),
      colors.bold(argv.configFile));
  term.log(path.resolve(argv.configFile));
  term.log('Upon completion, your new identity will be registered at the Hub.');
  term.log('-----');
  term.log('1. What %s would you like to register?', colors.bold('nickname'));
  term.log(colors.dim('(Between 6 and 64 characters.  Must contain only letters or numbers.)'));
  var config = {};

  function AskForNickname() {
    return term.question('Nickname> ')
      .then(function(nickname) {
        config.nick = nickname;
        term.log('   Checking for availability...');
        return context.hubClient.GetUserProfile(nickname)
      })
      .then(
        function(entity) {
          term.log('   Whoops, looks like that nickname has already been registered.');
          term.log('   Let\'s try again...');
          return AskForNickname();
        },
        function(err) {
          if (err.statusCode == 404) {
            term.log('   It\'s available!');
            term.log('   Hi, %s!', colors.bold(config.nick));
            return config.nick;
          } else if (err.statusCode == 400) {
            term.log(colors.red('   Whoops, looks like "%s" is not a valid nickname.'), config.nick);
            term.log('   Let\'s try again...');
            term.log(colors.dim('(Between 6 and 64 characters.  Must contain only letters or numbers.)'));
            return AskForNickname();
          } else {
            term.log(colors.red('Some kind of problem:'), err, err.stack);
            process.exit(1);
          }
        });
  }

  return AskForNickname()
    .then(function() {
      privateKey = ursa.generatePrivateKey();
      config.pubkey = privateKey.toPublicPem('utf8')
      config.privkey = privateKey.toPrivatePem('utf8')
      term.log('   Your private key has been generated.  It is stored in %s',
          argv.configFile);
      term.log(colors.bold('   This is the key to your identity, so don\'t lose it!'));
      term.log('-----');
      term.log('2. Next, where would you like to store your online data?');
      term.log('   This is where your posts will be stored.  It can be any Postvox-compatible server.  You can change this at any time by running %s again.', colors.bold('vox init'));
      term.log('   This should be a URL like %s',
          colors.bold('"http://example.com"'));
      term.log('   (Press ENTER to use the default server)');
      return term.question('Home server [' + argv.defaultInterchangeUrl + ']> ')
        .then(function(interchangeUrl) {
          config.interchangeUrl = interchangeUrl.trim();
          if (!config.interchangeUrl) {
            config.interchangeUrl = argv.defaultInterchangeUrl.trim();
          }
          config.interchangeUrl = MakeCanonicalInterchangeUrl(config.interchangeUrl);
          term.log('-----');
          term.log('3. Finally, enter a line about yourself.  This will be seen by anyone who follows you.');
          return term.question('About ' + config.nick + '> ');
        })
        .then(function(aboutText) {
          config.about = { text: aboutText };
          term.log('-----');
          term.log('Saving identity to disk...');
          configs.update(argv.configFile, config);
          term.log('Sending identity to the Hub...');
          return context.hubClient.RegisterUserProfile(
              IdentityConfigToUserProfile(config),
              config.privkey);
        })
        .then(function(userProfile) {
          term.log('OK!  Identity created!');
          context.config = config;
          context.nick = config.nick;
          context.privkey = ursa.createPrivateKey(config.privkey);
          term.log('Sending profile to home server');
          return SendProfileToInterchange(context, userProfile.interchangeUrl, userProfile);
        })
        .then(function() {
          return commandFollow.Follow(context, context.nick, 1);
        })
        .return(config);
    })
    .catch(function(err) {
      term.log('Oops! ', err, err.stack);
      process.exit(1);
    });
}


function UpdateExistingConfig(context) {
  var term = context.term;
  var argv = context.argv;
  var config = context.config;
  var oldInterchangeUrl = config.interchangeUrl;

  term.log('Ok, we\'re updating your Vox config at %s%s',
      colors.dim('--configFile='),
      colors.bold(argv.configFile));
  term.log('Nickname: %s', colors.bold(context.nick));
  term.log('1. Where would you like to store your online data?');
  term.log('   This is where your posts will be stored.  It can be any Postvox-compatible server.  You can change this at any time by running %s again.', colors.bold('vox init'));
  term.log('   This should be a URL like %s',
      colors.bold('"http://example.com"'));
  term.log('   (Press ENTER to use the existing value)');
  return term.question('Home server [' + context.config.interchangeUrl + ']> ')
    .then(function(interchangeUrl) {
      var newInterchangeUrl = interchangeUrl.trim();
      if (newInterchangeUrl) {
        config.interchangeUrl = MakeCanonicalInterchangeUrl(newInterchangeUrl);
      }
      term.log('-----');
      term.log('2. Finally, enter a line about yourself.  This will be seen by anyone who follows you.');
      term.log('   (Press ENTER to use the existing value)');
      return term.question('About ' + config.nick + '> ');
    })
    .then(function(aboutText) {
      if (aboutText) {
        config.about = { text: aboutText };
      }
      term.log('-----');
      term.log('Saving identity to disk...');
      configs.update(argv.configFile, config);
      term.log('Sending identity to the Hub...');
      return context.hubClient.RegisterUserProfile(
          IdentityConfigToUserProfile(config),
          config.privkey);
    })
    .then(function(userProfile) {
      term.log('OK!  Identity updated!');
      var p = SendProfileToInterchange(context, userProfile.interchangeUrl, userProfile);
      if (oldInterchangeUrl && oldInterchangeUrl != userProfile.interchangeUrl) {
        p.then(function() {
          term.log('Notifying followers at %s of your new home server.', oldInterchangeUrl);
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
      'updatedAt': identity.updatedAt || new Date().getTime(),
  };
}
