const U = require('../ux.js'), assert = require('assert');
assert.equal(U.swipeDir(-80, 10, false), 1);
assert.equal(U.swipeDir(80, 10, false), -1);
assert.equal(U.swipeDir(-50, 5, false), 0);
assert.equal(U.swipeDir(-50, 5, true), 1);
assert.equal(U.swipeDir(-90, 80, false), 0);
const pts = U.ringPoints(100, 100, [10]); assert.equal(pts.length, 8); assert.deepEqual(pts[0], [110, 100]);
console.log('ux ok');
