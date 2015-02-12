var assert = require('assert');
var voxurl = require('../voxurl');


describe('voxurl', function() {
  it('.toSource() parses streams', function() {
    assert.equal('spacemaus', voxurl.toSource('spacemaus'));
    assert.equal('spacemaus', voxurl.toSource('@spacemaus'));
    assert.equal('spacemaus', voxurl.toSource('vox:spacemaus'));
    assert.equal('spacemaus', voxurl.toSource('vox://spacemaus/123?asdf'));
    assert.equal('spacemaus', voxurl.toSource('spacemaus/friends'));
    assert.equal('spacemaus', voxurl.toSource('@spacemaus/friends'));
    assert.equal('spacemaus', voxurl.toSource('vox:spacemaus/friends'));
    assert.equal('spacemaus', voxurl.toSource('vox:spacemaus/friends?asdf'));
    assert.equal('spacemaus', voxurl.toSource('vox://spacemaus/friends?asdf'));
  })

  it('.toStream() parses streams', function() {
    assert.equal('spacemaus', voxurl.toStream('spacemaus'));
    assert.equal('spacemaus', voxurl.toStream('@spacemaus'));
    assert.equal('spacemaus', voxurl.toStream('vox:spacemaus'));
    assert.equal('spacemaus', voxurl.toStream('vox://spacemaus/123?asdf'));
    assert.equal('spacemaus/friends', voxurl.toStream('spacemaus/friends'));
    assert.equal('spacemaus/friends', voxurl.toStream('@spacemaus/friends'));
    assert.equal('spacemaus/friends', voxurl.toStream('vox:spacemaus/friends'));
    assert.equal('spacemaus/friends', voxurl.toStream('vox:spacemaus/friends?asdf'));
    assert.equal('spacemaus/friends', voxurl.toStream('vox://spacemaus/friends?asdf'));
  })

  it('.toCanonicalUrl() parses streams', function() {
    assert.equal('vox:spacemaus', voxurl.toCanonicalUrl('spacemaus'));
    assert.equal('vox:spacemaus', voxurl.toCanonicalUrl('@spacemaus'));
    assert.equal('vox:spacemaus', voxurl.toCanonicalUrl('vox:spacemaus'));
    assert.equal('vox:spacemaus', voxurl.toCanonicalUrl('vox://spacemaus/123?asdf'));
    assert.equal('vox:spacemaus/friends', voxurl.toCanonicalUrl('spacemaus/friends'));
    assert.equal('vox:spacemaus/friends', voxurl.toCanonicalUrl('@spacemaus/friends'));
    assert.equal('vox:spacemaus/friends', voxurl.toCanonicalUrl('vox:spacemaus/friends'));
    assert.equal('vox:spacemaus/friends', voxurl.toCanonicalUrl('vox:spacemaus/friends?asdf'));
    assert.equal('vox:spacemaus/friends', voxurl.toCanonicalUrl('vox://spacemaus/friends?asdf'));
  })
})
