Postvox Server
=================

This is a basic implementation of a Postvox server.  It implements (most of) the
[Postvox protocol](../Protocol.md).  It stores its data on local disk.  It
doesn't do any fancy clustering.

It can be found running in the wild at http://vanilla.postvox.net.


Running in production
========================

    $ export DEBUG='vox:*'
    $ export NODE_ENV='production'
    $ node vox-server.js \
        --dbDir=/path/to/dir \
        --port=9001 \
        --metricsPort=9002

**or**

Modify `pm2-process.json` and:

    $ pm2 start pm2-process.json
    $ pm2 logs



Running in development
=========================

    $ export DEBUG='vox:*'
    $ export NODE_ENV='development'
    $ # TODO: run fakehub
    $ node vox-server.js \
        --dbDir=/path/to/dir \
        --port=9001 \
        --metricsPort=9002

Using `nodemon` is very convenient for development:

    $ npm install -g nodemon
    $ nodemon vox-server.js <flags>


Flags
========

Name | Example | Description
:----|:--------|:-----------
--dbDir | /home/user/vox-server-db | The on-disk location of the server's database.  This is where message streams and metadata will be stored.
--port | 9001 | The port to bind to.
--metricsPort | 9002 | The port to bind the internal metrics server to.
--hubUrl | http://hub.postvox.net | The URL of the Hub.  The Hub is like DNS, but for users' nicknames.  If you point to a different Hub, you also need to update the expected public key in vox-common/authentication.js.


TODO
=======

[] Implement the rest of the protocol.
[] Make it easy to run fakehub in development mode.
