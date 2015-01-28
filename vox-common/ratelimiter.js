var debug = require('debug')('vox:ratelimiter');
var eyes = require('./eyes');
var ForgetfulCounter = require('./forgetfulcounter');
var lruCache = require('lru-cache');
var P = require('bluebird');


/**
 * Creates a middleware function that will rate limit requests based on the
 * requester's IP and request rate.
 *
 * - Set `options.sustainedRate` to set the acceptable sustained rate of requests.
 * - Set `options.burstCredit` to set the acceptable burst rate.
 *
 * @param {Object} options
 * @param {Number} options.sustainedRate Refill each client's request budget at
 *     this rate per second.
 * @param {Number} options.burstCredit Allow the client to exceed their
 *     sustained rate temporarily by this many requests.
 * @param {Number} options.baseDelayMs The base number of milliseconds to delay
 *     when the client is over their burst credit.
 * @param {Number} options.maxDelayMs The maximum number of millseconds to delay
 *     a request.  Blocks requests if they would delay more than this.
 * @param {Number} options.uniqueCounters The maximum number of unique IP
 *     addresses to track.
 * @param {String[]} options.whitelist The IPs to exempt from ratelimiting.
 */
module.exports = function(options) {
  var sustainedRate = options.sustainedRate || 1;
  var burstCredit = options.burstCredit || 20;
  var baseDelayMs = options.baseDelayMs || 1000;
  var maxDelayMs = options.maxDelayMs || 10000;
  var blockAfter = options.blockAfter || 20;
  var uniqueCounters = options.uniqueCounters || 1e4;
  var whitelist = {};
  (options.whitelist || []).forEach(function(ip) {
    whitelist[ip] = true;
  });

  var counter = new ForgetfulCounter(uniqueCounters, sustainedRate);

  return function(req, res, next) {
    if (req.remoteAddress in whitelist) {
      next();
      return;
    }
    var count = counter.inc(req.remoteAddress);
    if (count > burstCredit) {
      var e = count - burstCredit;
      var ms = Math.pow(2, e) * baseDelayMs;
      if (ms > maxDelayMs) {
        eyes.mark('ratelimiter.blocked');
        res.sendStatus(429, 'Too many requests');
      } else {
        eyes.mark('ratelimiter.delayed');
        debug('Delaying request by %d', ms);
        P.delay(ms).then(next);
      }
    } else {
      eyes.mark('ratelimiter.allowed');
      next();
    }
  }
}
