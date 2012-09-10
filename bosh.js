var ltx = require('ltx');
var net = require('net');
var xmpp = require('node-xmpp');

var sessions = {};

var currentID = 0;

function bosh() {
    return function bosh(req, res) {
        var tree;
        var session;

        function error(message) {
            stat("HTTP!", message);
            res.statusCode = 400;
            res.end(message);
        }

        function handleFrame() {
            stat('HTTP>', tree);
            if (!tree.is('body')) return error('opening tag should be body');

            if (!tree.attrs.sid) {
                startSession();
            } else {
                if (!session) return error('no such session');
                passFrame();

                if (session.queue.length) {
                    send();
                }
            }
        }

        function passFrame() {
            var stanza;
            for (var i in tree.children) {
                stanza = tree.children[i];
                stanza.parent = null;
                stat("XMPP>", stanza);
                session.connection.send(stanza);
            }
        }

        function startSession() {
            var sid = currentID++;

            session = sessions[sid] = { hold: tree.attrs.hold, wait: tree.attrs.wait, ver: tree.attrs.ver, waiting: [res], queue: [] };

            var c = net.connect({port: 5222, host: tree.to || 'localhost'}, function() {
                var xc = sessions[sid].connection = new xmpp.Connection.Connection(c);

                xc.streamTo = tree.to || 'localhost';

                xc.on('rawStanza', function(stanza) {
                    stat("XMPP<", stanza);
                    queue(stanza);
                    send();
                });
                
                xc.on('close', function() {
                    stat("XMPP.");
                });

                xc.on('error', function(err) {
                    stat("XMPP!", err);
                });

                stat("XMPP=", "connected");

                xc.startStream();
                xc.startParser();

                passFrame(tree);

                send(new ltx.Element('body', {
                    xmlns: 'http://jabber.org/protocol/httpbind', sid: sid, wait: 60, hold: 1
                }));
            });

            stat("Starting session", sid);
        }

        function queue(stanza) {
            session.queue.push(stanza);
        }

        function send(body) {
            var res = session.waiting.shift();
            if (res) {
                if (!body) {
                    body = new ltx.Element('body', { xmlns: 'http://jabber.org/protocol/httpbind' });
                }
                body.children = session.queue;
                for (var k in body.children) {
                    body.children[k].parent = body;
                }

                session.queue = [];

                stat('HTTP<', body);

                res.setHeader('Content-Type', 'text/xml; charset=utf-8');
                var responseText = body.toString();
                res.setHeader('Content-Length', Buffer.byteLength(responseText, 'utf-8'));
                res.end(responseText);
            }
        }

        var parser = new ltx.Parser();
        req.on('data', function(data) {
            parser.write(data);
        });

        req.on('end', function() {
            parser.end();
        });

        parser.on('error', function(err) {
            res.statusCode = 400;
            res.end(err);
        });

        parser.on('tree', function(t) {
            tree = t;
            session = sessions[tree.attrs.sid];
            if (session) {
                session.waiting.push(res);
            }
            handleFrame();
        });

        function stat(context, obj) {
            if (session) {
                console.log({ queue: session.queue.length, waiting: session.waiting.length });
            } else {
                console.log("No session");
            }
            if (obj) {
                console.log(context, obj);
            } else {
                console.log(context);
            }
        }
    };
}

module.exports = bosh;
