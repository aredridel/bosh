Introduction
============

This is a simple BOSH middleware (for anything with a connect-like API), or can
be used as a connection handler function for the raw node HTTP server.


Example
=======

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

Caveats
=======

It implements just enough of the connection manager protocol at this point to
pass through an XMPP session. Correctness is left for a later pass through the
code. There is little to no error handling.
