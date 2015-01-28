/**
 * Wrapper around the metrics package.  Contains convenience functions for
 * updating metrics in a global instance.  Serves a metrics status page via
 * HTTP.
 */


var debug = require('debug')('vox:eyes');
var http = require('http');
var metrics = require('metrics');


/**
 * Initializes the metrics server.
 */
exports.Init = function(serverPort) {
  if (exports.isInitialized) {
    throw new Error('Eyes metrics server is already initialized!');
  }
  return new MetricsCollector(serverPort);
}


exports._globalCollector = null;
exports.isInitialized = false;
exports.inc = function() {};
exports.dec = function() {};
exports.mark = function() {};
exports.observe = function() {};
exports.start = function() {};
exports.close = function() {};


function MetricsCollector(serverPort) {
  exports._globalCollector = this;

  this.metricsServer = new MetricsServer(serverPort);
  this.metrics = {};
  exports.inc = this.inc.bind(this);
  exports.dec = this.dec.bind(this);
  exports.mark = this.mark.bind(this);
  exports.observe = this.observe.bind(this);
  exports.start = this.start.bind(this);
  exports.close = this.close.bind(this);
  exports.isInitialized = true;
}

/**
 * Increments a counter.  If you never need to decrement the counter, then you
 * probably want `mark()` instead.
 */
MetricsCollector.prototype.inc = function(name) {
  var metric = this.metrics[name];
  if (!metric) {
    metric = new metrics.Counter();
    this.metrics[name] = metric;
    this.metricsServer.addMetric(name, metric);
  }
  metric.inc();
  this.mark(name + '.inc_rate');
}

/**
 * Decrements a counter.
 */
MetricsCollector.prototype.dec = function(name) {
  var metric = this.metrics[name];
  if (!metric) {
    metric = new metrics.Counter();
    this.metrics[name] = metric;
    this.metricsServer.addMetric(name, metric);
  }
  metric.dec();
  this.mark(name + '.dec_rate');
}

/**
 * Marks an event.
 */
MetricsCollector.prototype.mark = function(name) {
  var metric = this.metrics[name];
  if (!metric) {
    metric = new metrics.Meter();
    this.metrics[name] = metric;
    this.metricsServer.addMetric(name, metric);
  }
  metric.mark();
}

/**
 * Observes a value and stuffs it into a histogram.
 */
MetricsCollector.prototype.observe = function(name, val, opt_unit) {
  var metric = this.metrics[name];
  if (!metric) {
    metric = new metrics.Histogram.createUniformHistogram();
    this.metrics[name] = metric;
    this.metricsServer.addMetric(name, metric, opt_unit || '');
  }
  metric.update(val);
}

/**
 * Starts a timer.
 *
 * @return {function(opt_itemCount)} A function that stops the timer and reports
 *     the delta. May be called multiple times.  If `opt_itemCount` is given,
 *     then an additional metric ".avg_per_item" is added, with the total time
 *     divided by the item count.
 */
MetricsCollector.prototype.start = function(name) {
  var metric = this.metrics[name];
  if (!metric) {
    metric = new metrics.Timer();
    this.metrics[name] = metric;
    this.metricsServer.addMetric(name, metric);
  }
  var start = process.hrtime();
  var self = this;
  return function(opt_itemCount) {
    var delta = process.hrtime(start);
    var ns = delta[0] * 1e9 + delta[1];
    var ms = ns / 1e6;
    metric.update(ms);
    if (opt_itemCount) {
      var perItemMs = ms / opt_itemCount;
      var perItemName = name + '.avg_per_item';
      var itemMetric = self.metrics[perItemName];
      if (!itemMetric) {
        itemMetric = new metrics.Timer();
        self.metrics[perItemName] = itemMetric;
        self.metricsServer.addMetric(perItemName, itemMetric);
      }
      itemMetric.update(perItemMs);
    }
  }
}

MetricsCollector.prototype.close = function() {
  this.metricsServer.server.close();
  exports._globalCollector = null;
  exports.isInitialized = false;
}



/**
 * A simple server for metrics.  Serves a metrics report in a text format on the
 * path "/eyes".
 */
function MetricsServer(port) {
  this.servedMetrics = [];
  this.sorted = true;
  this.startTime = new Date();
  this.server = http.createServer(this._handleRequest.bind(this));
  this.server.listen(port);
  debug('Serving metrics on localhost:%d/eyes', port);
}


var TIMER_PERCENTILES = [0.5, 0.9, 0.99];
var OBSERVER_PERCENTILES = [0.1, 0.25, 0.5, 0.75, 0.9, 0.99];


MetricsServer.prototype.addMetric = function(name, metric, opt_unit) {
  this.servedMetrics.push([name, metric, opt_unit]);
  this.sorted = false;
}


MetricsServer.prototype._handleRequest = function(req, res) {
  if (req.url != '/eyes' || req.method != 'GET') {
    res.statusCode = 404;
    res.write('ok');
    res.end();
    return;
  }
  res.writeHead(200, {
      'Content-Type': 'text/plain'
  });
  res.write('Started ' + this.startTime);
  res.write('\nUptime ' + process.uptime() + ' seconds');
  res.write('\nNow ' + (new Date().getTime()));
  var memoryUsage = process.memoryUsage();
  res.write('\nRSS ' + memoryUsage.rss / 1e3);
  res.write('K\nheapUsed ' + memoryUsage.heapUsed / 1e3);
  res.write('K\nheapTotal ' + memoryUsage.heapTotal / 1e3);
  res.write('K\n=================\n');

  if (!this.sorted) {
    this.servedMetrics.sort(function(a, b) { return a[0].localeCompare(b[0]) });
    this.sorted = true;
  }

  for (var i = 0; i < this.servedMetrics.length; i++) {
    var tuple = this.servedMetrics[i];
    res.write(tuple[0] + ':');
    var metric = tuple[1];
    if (metric instanceof metrics.Counter) {
      res.write('\n    count ' + metric.count);
    } else if (metric instanceof metrics.Meter) {
      writeMeter(res, metric);
    } else if (metric instanceof metrics.Timer) {
      writeMeter(res, metric.meter);
      writeHistogram(res, metric.histogram, TIMER_PERCENTILES, ' ms');
    } else if (metric instanceof metrics.Histogram) {
      writeHistogram(res, metric, OBSERVER_PERCENTILES, ' ' + tuple[2]);
    }
    res.write('\n');
  }
  res.end();
}


function writeMeter(res, meter) {
  res.write('\n    count ' + meter.count);
  res.write('\n    1m_rate ' + meter.m1Rate.rate().toFixed(3));
  res.write('/s\n    5m_rate ' + meter.m5Rate.rate().toFixed(3));
  res.write('/s\n    15m_rate ' + meter.m15Rate.rate().toFixed(3));
  res.write('/s');
}


function writeHistogram(res, histogram, percentiles, suffix) {
  if (!histogram.count) {
    return;
  }
  res.write('\n    var ' + histogram.variance().toFixed(3));
  res.write(suffix);
  res.write('\n    mean ' + histogram.mean().toFixed(3));
  res.write(suffix);
  var scores = histogram.percentiles(percentiles);
  for (var i = 0; i < percentiles.length; i++) {
    var p = percentiles[i];
    res.write('\n    ');
    res.write((p * 100).toFixed(0) + '% ' + scores[p].toFixed(3));
    res.write(suffix);
  }
}
