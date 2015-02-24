var colors = require('colors');
var configs = require('./configs');
var errors = require('vox-common/errors');
var P = require('bluebird');
var path = require('path');
var ursa = require('ursa');
var voxcommon = require('vox-common');


exports = module.exports = function(context) {
  if (context.config.isRegistered) {
    return updateExistingConfig(context);
  }
  return initNewConfig(context);
}

exports.help = 'Registers a new user with the Postvox network and initializes the local config.  This must be run before any other commands.';
exports.examples = [
    '/init'
];


function initNewConfig(context) {
  var view = context.view;
  var argv = context.argv;
  var configFile = context.profileFilenames.configFile;

  view.log('Ok, we\'re initializing your Vox config at %s',
      colors.bold(configFile));
  view.log(path.resolve(configFile));
  view.log('Upon completion, your new identity will be registered at the Hub.');
  view.log('---------------------------------------');

  var config = context.config || {};

  return askForNickname(context, config)
    .then(function() {
      return context.reinitWithConfig(config)
        .then(function() {
          return registerNewConfig(context, config);
        })
    })
    .catch(function(err) {
      view.log('Oops! ', err, err.stack);
      process.exit(1);
    });
}


function askForNickname(context, config) {
  var view = context.view;
  var argv = context.argv;
  var configFile = context.profileFilenames.configFile;

  if (argv.nick) {
    view.log('   (Using nickname from --nick flag)');
    return checkForNickname(context, config, argv.nick)
      .then(function(nick) {
        if (!nick) {
          view.log(colors.red('Please try another value for --nick'));
          process.exit(1);
        } else {
          view.log('---------------------------------------');
          view.log('   Hi, %s!', colors.bold(nick));
          view.log('---------------------------------------');
          if (!config.privkey) {
            generatePrivateKey(context, config);
          }
          config.nick = nick;
          return nick;
        }
      });
  } else {
    view.log('1. What %s would you like to register?', colors.bold('nickname'));
    view.log(colors.dim('(Between 6 and 64 characters.  Must contain only letters or numbers.)'));
    return view.question('Nickname> ')
      .then(function(nick) {
        return checkForNickname(context, config, nick);
      })
      .then(function(nick) {
        if (!nick) {
          view.log('   Let\'s try again...');
          return askForNickname();
        } else {
          view.log('---------------------------------------');
          view.log('   Hi, %s!', colors.bold(nick));
          view.log('---------------------------------------');
          generatePrivateKey(context, config);
          config.nick = nick;
          return nick;
        }
      });
  }
}


function generatePrivateKey(context, config) {
  var view = context.view;
  var privateKey = ursa.generatePrivateKey();
  config.pubkey = privateKey.toPublicPem('utf8');
  config.privkey = privateKey.toPrivatePem('utf8');
  view.log('New key fingerprint: %s', privateKey.toPublicSshFingerprint('hex'));
  context.voxClient.setPrivkey(config.privkey);

  view.log('   Your private key has been generated.  It is stored in:');
  view.log('   %s', colors.bold(context.profileFilenames.configFile));
  view.log(colors.bold('   This is the key to your identity, so don\'t lose it!'));
}


function checkForNickname(context, config, nick) {
  var view = context.view;

  view.log('   Checking for availability...');
  return context.voxClient.hubClient.getUserProfileFromHub(nick)
    .then(
      function(entity) {
        if (entity.pubkey == config.pubkey) {
          view.log('   It\'s already registered, but it looks like you have the key for it.');
          return nick;
        }
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


function registerNewConfig(context, config) {
  var view = context.view;
  var argv = context.argv;
  var configFile = context.profileFilenames.configFile;

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
      config.interchangeUrl = makeCanonicalInterchangeUrl(config.interchangeUrl);
      view.log('---------------------------------------');
      view.log('3. Finally, enter a line about yourself.  This will be seen by anyone who follows you.');
      return view.question('About ' + config.nick + '> ');
    })
    .then(function(aboutText) {
      config.about = { text: aboutText };
      view.log('---------------------------------------');
      view.log('Saving identity to disk...');
      config.isRegistered = false;
      configs.write(configFile, config);
      view.log('Sending identity to the network...');
      return context.voxClient.postUserProfile(
          identityConfigToUserProfile(config), config.privkey);
    })
    .then(function(userProfile) {
      view.log('OK!  Identity created!');
      config.isRegistered = true;
      configs.write(configFile, config);
      context.config = config;
      context.nick = config.nick;
    })
    .then(function() {
      return context.voxClient.subscribe(context.nick);
    })
    .return(config);
}


function updateExistingConfig(context) {
  var view = context.view;
  var argv = context.argv;
  var configFile = context.profileFilenames.configFile;
  var config = context.config;
  var oldInterchangeUrl = config.interchangeUrl;

  view.log('Ok, we\'re updating your Vox config at %s',
      colors.bold(configFile));
  view.log('---------------------------------------');
  view.log('Nickname: %s', colors.bold(context.nick));
  view.log('---------------------------------------');
  view.log('1. Where would you like to store your online data?');
  view.log('   This is where your posts will be stored.  It can be any Postvox-compatible server.  You can change this at any time by running %s again.', colors.bold('vox init'));
  view.log('   This should be a URL like %s', colors.bold('"http://example.com"'));
  view.log('   (Press ENTER to keep the existing value: %s)', colors.dim(context.config.interchangeUrl));
  return view.question('Home server> ')
    .then(function(interchangeUrl) {
      var newInterchangeUrl = interchangeUrl.trim();
      if (newInterchangeUrl) {
        config.interchangeUrl = makeCanonicalInterchangeUrl(newInterchangeUrl);
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
      config.isRegistered = false;
      configs.write(configFile, config);
      view.log('Sending identity to the network...');
      return context.voxClient.postUserProfile(
          identityConfigToUserProfile(config), config.privkey);
    })
    .then(function() {
      config.isRegistered = true;
      configs.write(configFile, config);
      view.log('OK!  Identity updated!');
    })
    .return(config);
}


function makeCanonicalInterchangeUrl(interchangeUrl) {
  if (!interchangeUrl.toLowerCase().startsWith('http://')) {
    interchangeUrl = 'http://' + interchangeUrl;
  }
  return interchangeUrl;
}


function identityConfigToUserProfile(identity) {
  return {
      'about': JSON.stringify(identity.about),
      'nick': identity.nick,
      'interchangeUrl': identity.interchangeUrl,
      'pubkey': identity.pubkey,
      'updatedAt': identity.updatedAt || Date.now(),
  };
}
