var urlparse = require('url');


var STREAM_RE = /(?:@|vox:(?:\/\/)?)?([^\/]+)(\/[^\/?#]*[^\/?#\d][^\/?#]*)?/i;


/**
 * Returns the `<source>` portion of a stream identifier.
 *
 * Valid stream identifiers match this pattern:
 *
 *    "[vox:|@]<source>[/<stream-name>]"
 *
 * E.g.:
 * - vox:spacemaus
 * - spacemaus
 * - @spacemaus/friends
 *
 * @param {String} stream A stream identifier.
 * @return {String?} A nickname, or null if the stream identifier is invalid.
 */
exports.toSource = function(stream) {
  var match = STREAM_RE.exec(stream);
  if (!match) {
    return null;
  }
  return match[1];
}


/**
 * Returns the `<source>[/<stream-name>]` portion of a stream identifier.
 *
 * Valid stream identifiers match this pattern:
 *
 *    "[vox:|@]<source>[/<stream-name>]"
 *
 * E.g.:
 * - vox:spacemaus
 * - spacemaus
 * - @spacemaus/friends
 *
 * @param {String} stream A stream identifier.
 * @return {String?} A shortened stream identifier, or null if the stream
 *     identifier is invalid.
 */
exports.toStream = function(stream) {
  var match = STREAM_RE.exec(stream);
  if (!match) {
    return null;
  }
  return match[1] + (match[2] || '');
}


/**
 * Transforms a string identifier into a canonical vox: URL.
 *
 * Valid stream identifiers match this pattern:
 *
 *    "[vox:|@]<source>[/<stream-name>]"
 *
 * E.g.:
 * - vox:spacemaus
 * - spacemaus
 * - @spacemaus/friends
 *
 * @param {String} stream A stream identifier.
 * @return {String?} A vox: URL, or null if the stream identifier is invalid.
 */
exports.toCanonicalUrl = function(stream) {
  var match = STREAM_RE.exec(stream);
  if (!match) {
    return null;
  }
  return 'vox:' + match[1] + (match[2] || '');
}


/**
 * Gets the canonical URL for a stanza.
 *
 * @params {Object} stanza A valid stanza.
 * @return {String} The URL for the stanza, e.g., 'vox:spacemaus/friends/1234'.
 */
exports.getStanzaUrl = function(stanza) {
  return 'vox:' + stanza.stream + '/' + stanza.seq;
}


/**
 * Gets the canonical URL of the stanza, or the URL that it was cloned from if
 * applicable.
 */
exports.getOriginalStanzaUrl = function(stanza) {
  if (stanza.type != 'MESSAGE') {
    return exports.getStanzaUrl(stanza);
  }
  return stanza.clone ? stanza.clone : exports.getStanzaUrl(stanza);
}
