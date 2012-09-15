var http = require('http');
var bosh = require('./bosh.js');

http.createServer(bosh({debug: true})).listen(5280);
