var assert = require('assert');

/**
 * Asserts that two arrays are deeply equal, ignoring the order of items in the
 * outermost array.
 *
 * The array elements must be sortable.
 */
exports.sortedArraysEqual = function(a, b) {
  a.sort();
  b.sort();
  assert.deepEqual(a, b);
}
