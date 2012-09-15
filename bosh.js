/*jshint node:true */
var ltx = require('ltx');
var net = require('net');
var xmpp = require('node-xmpp');
var idgen = require('idgen');

function bosh(options) {
    "use strict";
    var sessions = {};

    if (!options) options = {};

    function debug () {
        if (options.debug) {
            console.log.apply(console, arguments);
        }
    }

    function Session(options) {
        if (!this instanceof Session) {
            return new Session(options);
        }

        this.sid = idgen();

        sessions[this.sid] = this;

        this.options = options;
        this.waiting = [];
        this._queue = [];

        var session = this;

        var c = net.connect({port: 5222, host: options.to}, function() {
            var xc = session.connection = new xmpp.Connection.Connection(c);

            xc.streamTo = options.to;

            xc.on('rawStanza', function(stanza) {
                debug("XMPP<", stanza.toString());
                session.queue(stanza);
                session.send();
            });
            
            xc.on('close', function() {
                debug("XMPP.");
                session.error('closed');
            });

            xc.on('error', function(err) {
                session.error(err);
            });

            debug("XMPP=", "connected");

            xc.startStream();
            xc.startParser();

            session.send(new ltx.Element('body', {
                xmlns: 'http://jabber.org/protocol/httpbind', sid: session.sid, wait: 60, hold: 1
            }));
        });

        c.on('error', function(err) {
            session.error(err);
        });

        debug("Starting session", session.sid);
    }

    Session.forTree = function getSession(tree) {
        var sid = tree.attrs.sid;

        if (sid) {
            return sessions[sid];
        } else {
            return new Session({hold: parseInt(tree.attrs.hold, 10), wait: parseInt(tree.attrs.wait, 10), ver: tree.attrs.ver, to: tree.attrs.to});
        }
    };

    Session.prototype = {
        send: function send(body) {
            var res = this.waiting.shift();
            if (res) {
                if (!body) {
                    body = new ltx.Element('body', { xmlns: 'http://jabber.org/protocol/httpbind' });
                }
                body.children = this._queue;
                for (var k in body.children) {
                    body.children[k].parent = body;
                }

                this._queue = [];

                var responseText = body.toString();

                debug('HTTP<', responseText);

                res.writeHeader(200, 'OK', {
                    'Content-Type': 'text/xml; charset=utf-8',
                    'Content-Length': Buffer.byteLength(responseText, 'utf-8')
                });

                res.end(responseText);
            }
            this.rescheduleTimeout();
        },

        rescheduleTimeout: function rescheduleTimeout() {
            if (this.timeout) {
                clearTimeout(this.timeout);
            }

            this.timeout = setTimeout(this.send.bind(this), this.options.wait * 1000);
        },

        queue: function queue(stanza) {
            this._queue.push(stanza);
            var session = this;
            process.nextTick(this.send.bind(this));
        },

        error: function die(err) {
            debug("XMPP!", err);
            this.send(new ltx.Element('body', {
                xmlns: 'http://jabber.org/protocol/httpbind', 
                condition: 'remote-connection-failed',
                type: 'terminate',
                "xmlns:stream": 'http://etherx.jabber.org/streams'
            }));
            delete sessions[this.sid];
        }
    };

    return function bosh(req, res) {
        var tree;
        var session;

        if (req.method != 'POST') {
            res.writeHead(400, 'OK, But...', {
                "Content-Type": "text/html"
            });
            return res.end("<!doctype html><style>body { width: 300px; margin: 50px auto; } </style> <h1>That worked, but ...</h1><p>This is a BOSH server endpoint. Connecting with a web browser won't accomplish much. You'll need a Jabber server to connect to, and then direct your Jabber client to this endpoint.</p>");
        }

        function handleFrame() {
            debug('HTTP>', tree.toString());
            if (!tree.is('body')) return error(res, 'opening tag should be body');

            var session = Session.forTree(tree);
            if (!session) return error(res, 'no such session');

            session.waiting.push(res);

            var stanza;
            for (var i in tree.children) {
                stanza = tree.children[i];
                stanza.parent = null;
                debug("XMPP>", stanza.toString());
                session.connection.send(stanza);
            }
        }

        var parser = new ltx.Parser();
        req.on('data', function(data) {
            parser.write(data);
        });

        req.on('end', parser.end.bind(parser));

        parser.on('error', function(err) {
            return error(res, err);
        });

        parser.on('tree', function(t) {
            tree = t;
            session = sessions[tree.attrs.sid];
            if (session) {
                session.waiting.push(res);
            }
            handleFrame();
        });

        function error(res, message) {
            debug("HTTP!", message);

            res.statusCode = 400;
            var type = /^text\/xml/;
            if (type.test(req.headers['Content-Type']) || type.test(req.headers['Content-Encoding'])) {
                res.end("XML");
            } else {
                res.end(message);
            }
        }
    };
}

module.exports = bosh;
