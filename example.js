var connect = require('connect');
var urlrouter = require('urlrouter');

var app = connect();

var bosh = require('./bosh.js');

var router = urlrouter(function(app) {
    var boshHandler = bosh();
    app.post('/http-bind/', boshHandler);
    app.get('/http-bind/', boshHandler);
});

app.use(connect.logger({ immediate: true, format: 'dev' }));

app.use(router);

app.listen(5280);
