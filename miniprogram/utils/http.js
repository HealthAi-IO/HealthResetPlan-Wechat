const request = require('./request');

module.exports = Object.assign({ http: request }, request);
