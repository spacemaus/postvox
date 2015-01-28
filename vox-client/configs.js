var fs = require('fs');
var jsonFormat = require('json-format');


exports.parse = function(filename) {
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}


exports.getUserConfig = function(filename, nick) {
  var configSet;
  try {
    configSet = exports.parse(filename);
  } catch(err) {
    console.error('No config found at %s', filename);
    return { nick: nick };
  }

  var profiles = configSet['profiles'];
  if (!profiles) {
    return { nick: nick };
  }

  if (!nick) {
    nick = configSet['defaultNick'];
  }

  var config;
  if (nick) {
    config = profiles[nick];
    if (!config) {
      console.error('No nickname "%s" in config %s', nick, filename);
    }
  }

  return config || { nick: nick };
}


exports.update = function(filename, config) {
  var configSet;
  try {
    configSet = exports.parse(filename);
  } catch (e) {
    if (e.code != 'ENOENT') {
      throw e;
    }
    configSet = {};
  }
  var profiles = configSet.profiles;
  if (!profiles) {
    profiles = configSet.profiles = {};
  }
  profiles[config.nick] = config;
  if (!configSet.defaultNick) {
    configSet.defaultNick = config.nick;
  }
  var s = jsonFormat(configSet);
  fs.writeFileSync(filename, s, {
      mode: 0600,
      flag: 'w'
  });
}
