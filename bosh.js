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
        if (options.debug) console.log.apply(console, arguments);
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
            xc.xmlns[''] = 'jabber:client';
            xc.xmppVersion = "1.0";

            xc.streamTo = options.to;

            xc.on('rawStanza', function(stanza) {
                debug("\tXMPP<", stanza.toString());
                session.queue(stanza);
            });
            
            xc.on('close', function() {
                debug("XMPP.");
                session.terminate();
            });

            xc.on('error', function(err) {
                debug("XMPP!");
                session.error(err);
            });

            debug("XMPP=", "connected");

            xc.startStream();
            xc.startParser();

            //session.queue(new ltx.Element('stream:features', {'xmlns:stream': 'http://etherx.jabber.org/streams'}).c('mechanisms', {xmlns: 'urn:ietf:params:xml:ns:xmpp-sasl'}).c('mechanism').t('PLAIN').up());
            //session.queue(new ltx.Element('stream:features', {'xmlns:stream': 'http://etherx.jabber.org/streams'}).c('bind', {xmlns: 'urn:ietf:params:xml:ns:xmpp-bind'}));
            session.send(new ltx.Element('body', {
                xmlns: 'http://jabber.org/protocol/httpbind',
                "xmlns:xmpp": "urn:xmpp:xbosh",
                "xmpp:restartlogic": "true",
                sid: session.sid,
                wait: 60,
                hold: 1
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
        } else if (tree.attrs.to) {
            return new Session({hold: parseInt(tree.attrs.hold, 10), wait: parseInt(tree.attrs.wait, 10), ver: tree.attrs.ver, to: tree.attrs.to});
        } else {
            return false;
        }
    };

    Session.prototype = {
        send: function send(body) {
            delete this.sendScheduled;
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
            } else {
                debug("HTTP:", "No connection available, leaving queued: ", this._queue.length);
            }

            if (this.waiting.length > this.options.hold) {
                this.send();
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
            this._queue.push(stanza.root());
            var session = this;
            if (!this.sendScheduled) {
                process.nextTick(this.send.bind(this));
                this.sendScheduled = true;
            }
        },

        error: function die(err) {
            debug("XMPP!", err.toString());
            this.send(new ltx.Element('body', {
                xmlns: 'http://jabber.org/protocol/httpbind', 
                condition: 'remote-connection-failed',
                type: 'terminate',
                "xmlns:stream": 'http://etherx.jabber.org/streams'
            }));
            delete sessions[this.sid];
        },

        terminate: function terminate() {
            debug("HTTP."); 
            this.send(new ltx.Element('body', {
                xmlns: 'http://jabber.org/protocol/httpbind', 
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

        function handleFrame(tree) {
            debug('HTTP>', tree.toString());
            if (!tree.is('body')) return error(res, 'opening tag should be body');

            var session = Session.forTree(tree);
            if (!session) return error(res, 'item-not-found');

            session.waiting.push(res);

            if (tree.attrs['xmpp:restart'] == 'true') {
                console.log("XMPP ", "restarting");
                session.connection.stopParser();
                session.connection.startParser();
                session.connection.startStream();
            }

            var stanza;
            for (var i in tree.children) {
                stanza = tree.children[i];
                stanza.parent = null;
                debug("\tXMPP>", stanza.toString());
                session.connection.send(stanza);
            }

            if (session._queue.length) session.send();
        }

        var parser = new ltx.Parser();
        req.on('data', function(data) {
            parser.write(data);
        });

        req.on('end', parser.end.bind(parser));

        parser.on('error', function(err) {
            return error(res, 'not-well-formed');
        });

        parser.on('tree', handleFrame);

        function error(res, message) {
            debug("HTTP!", message);

            var type = /^(text|application)\/xml/;
            if (type.test(req.headers['content-type']) || type.test(req.headers['content-encoding'])) {
                var body = new ltx.Element('body', {
                    type: 'terminate', 
                    xmlns: 'http://jabber.org/protocol/httpbind',
                    condition: message
                });
                console.log("HTTP<", body.toString());
                res.end(body.toString());
            } else {
                res.statusCode = 400;
                res.end(message);
            }
        }
    };
}

module.exports = bosh;
