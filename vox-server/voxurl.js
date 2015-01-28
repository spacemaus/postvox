var urlparse = require('url');


/**
 * Reduces a URL like "vox://name/path/123" to "vox://name".
 */
exports.ToSourceUrl = function(url) {
  var parsed = urlparse.parse(url);
  parsed.pathname = '';
  return urlparse.format(parsed);
}
