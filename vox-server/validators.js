/**
 * Input validators.
 */

var urlparse = require('url');
var voxcommon = require('vox-common');


/**
 * Creates a middleware function for checking the request payload.
 *
 * @param {Object} params The parameters to validate.
 * @param {function(v): bool} params.<name> The validator for the parameter
 *     with the given name.
 */
exports.CheckPayload = function(params) {
  var names = Object.keys(params);
  for (var name in params) {
    var validator = params[name];
    if (!(validator instanceof Function)) {
      throw new Error('Invalid validator for parameter: ' + name + ': ' + validator);
    }
  }
  return function(req, res, next) {
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var validator = params[name];
      var value = req.payload[name];
      if (!validator(value)) {
        var message;
        if (value === undefined && !validator.isOptional) {
          message = 'Missing parameter';
        } else {
          message = 'Invalid parameter';
        }
        message += ': ' + name + '; ' + validator.validatorName + '(' + value + ')';
        next({
            statusCode: 400,
            message: message
        });
        return;
      }
    }
    next();
  }
}

exports.isValidNick = function(name) {
  if (!name) {
    return false;
  }
  return voxcommon.validation.IsValidName(name);
}

exports.isValidSource = function(source) {
  return exports.isValidNick(source);
}

exports.isValidVersion = function(version) {
  return typeof(version) == 'string' && version.length < 64;
}

exports.isValidAgent = function(agent) {
  return typeof(agent) == 'string' && agent.length < 64;
}

exports.isValidSessionId = function(sessionId) {
  // It's probably a UUIDv4, but we don't need to be very strict with the check.
  return typeof(sessionId) == 'string' && sessionId.length < 256;
}

exports.isValidUrl = function(url) {
  return !!tryParseUrl(url);
}

exports.isValidVoxUrl = function(url) {
  var parsedUrl = tryParseUrl(url);
  if (!parsedUrl) {
    return false;
  }
  return parsedUrl.protocol == 'vox:';
}

exports.isValidRouteUrl = function(url) {
  return exports.isValidVoxUrl(url);
}

exports.isValidSubscriptionUrl = function(url) {
  return exports.isValidVoxUrl(url);
}

exports.isValidMessageUrl = function(url) {
  var parsedUrl = tryParseUrl(url);
  if (!parsedUrl) {
    return false;
  }
  return parsedUrl.protocol == 'vox:' && /^\/messages\/.+/.test(parsedUrl.pathname);
}

exports.isValidTimestamp = function(ts) {
  return typeof(ts) == 'number' && ts > 0;
}

exports.isValidWeight = function(weight) {
  return typeof(weight) == 'number';
}

exports.isValidLimit = function(limit) {
  return typeof(limit) == 'number' && limit > 0 && limit <= 50;
}

exports.isValidOffset = function(offset) {
  return typeof(limit) == 'number' && offset >= 0;
}

exports.isValidStatusText = function(text) {
  return typeof(text) == 'string' && text.length < 256;
}

exports.isValidMessageTitle = function(title) {
  return typeof(title) == 'string' && title.length < 256;
}

exports.isValidMessageText = function(text) {
  return typeof(text) == 'string' && text.length < 4096;
}

exports.isValidBoolean = function(bool) {
  var t = typeof(bool);
  return t == 'boolean' || t == 'number';
}

exports.isValidPubkey = function(pubkey) {
  return typeof(pubkey) == 'string';
}

function tryParseUrl(text) {
  if (!typeof(text) == 'string') {
    return null;
  }
  var url = urlparse.parse(text);
  if (!url.protocol && url.hostname) {
    return null;
  }
  return url;
}


// Add `.optional` to validators:
for (var name in exports) {
  if (!name.startsWith('is')) {
    continue;
  }
  var fn = exports[name];
  if (!(fn instanceof Function)) {
    continue;
  }
  attachOptional(fn);
}


function attachOptional(fn) {
  fn.validatorName = name;
  fn.optional = function(v) {
    if (v === undefined || v === null) {
      return true;
    }
    return fn(v);
  }
  fn.optional.validatorName = name;
  fn.optional.isOptional = true;
}
