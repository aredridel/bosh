var http = require('http');
var bosh = require('./bosh.js');

http.createServer(bosh()).listen(5280);
