Postvox
==========
A simple, open, distributed newsfeed network.

It takes inspiration from email, IRC, and Usenet on the one hand; and Twitter,
Facebook, and Instagram on the other.  It's real-time, and all that jazz.

- [FAQ](#faq)
- [Terminal client](#terminal-client)
- [Stream mode](#stream-mode)
- [Clients and bots](#clients-and-bots)
- [Docs](#docs)


FAQ
======

**Q:** What's it good for?

**A:** Newsfeeds (like RSS) or real-time chat (like IRC or XMPP).

**Q:** What makes it special?

**A:** It's an open protocol like email, which means anyone can run their own
servers and participate in the wider network.

It's also easy to program custom "bots" to interact with the network.  (See
[morsebot.js](./vox-client/examples/morsebot.js) and
[elizabot.js](https://github.com/spacemaus/vox-elizabot) for example, or say
"@elizabot Hello!" to see it in action.)

**Q:** How do I connect to it?

**A:** Postvox is in open alpha.  You can try it out if this makes sense to you:

    $ npm install -g vox-client
    $ vox init --nick yournickname   # (Follow the instructions)
    $ vox --nick yournickname
    > :help
    > :follow spacemaus
    > @spacemaus Hi!

**Q:** How do I make a chatroom?

**A:** Register a new nickname with `vox init --nick nickname`, then `:follow nickname`.

**Q:** How do I subscribe to an RSS feed?

**A:** Write a bot.  See [hackernewsfeed.js](https://github.com/spacemaus/vox-hackernewsfeed) for example (which you can follow at @hackernewsfeed).  It'd be a pretty easy to create a bot that accepts commands to subscribe to and unsubscribe from RSS feeds.  (See [morsebot.js](./vox-client/examples/morsebot.js) for an example of a bot that responds to commands.)

**Q:** Why is the UI a lousy terminal client?  Why isn't there a mobile app/web
client/non-Node.js client?  Why is the server an unscalable single node with a
local database?  What about encryption, private messages, blocking, spam
preventions, upvotes, reshares, etc.?

**A:** Postvox is a side project.  *IF* it turns out to be useful to people,
then it would be tons of fun to build those things!  But, as with most side
projects, that's a pretty big *if*.  PRs happily accepted :)

**Q:** But why another distributed open-source social network clone?

**A:** This project comes out of a thought experiment:

What if you traveled back in time to 1985 and told the major players on the
Internet<sup>[1](#footnote-1)</sup> about modern "social networks" and "walled
gardens" and their collective billions of users and dollars?  What if they came
back with you to the year 2015<sup>[2](#footnote-2)</sup> and helped you design
something similar, but built on principles from the Dawning Age of the
Internet<sup>[3](#footnote-3)</sup>? How would it be similar to modern social
networks? How would it be different?

Postvox is a sketch of what such a system might look like.  (It was also a good
exercise for learning Node.js.)

<sup><a name="footnote-1"></a><sup>1</sup>Back then, they were called "denizens".  The term "netizen" hadn't been invented yet.</sup><br>
<sup><a name="footnote-2"></a><sup>2</sup>See this fascinating [alternate history documentary](http://backtothefuture.wikia.com/wiki/2015) for an exploration of a similar idea.</sup><br>
<sup><a name="footnote-3"></a><sup>3</sup>Principles like open protocols, freedom of information, distributed authority, and a resistance to nuclear attack.</sup>


Terminal client
==================
Install the client with `npm install -g vox-client`.

First, you need a nickname.  Run `vox init --nick <nickname>` to register a
name. Minimum of six characters, maximum of 64: letters and numbers only for
now.

When you run `vox init`, it'll create an **encryption key** for you, and store
it in ~/.voxprofiles.  Any data you publish will be signed with this key.

Second, you need a host for your data.  There's only one right now, unless you
[run your own server](vox-server/README.md).  The default host is at
`http://vanilla.postvox.net`.

Thirdly, run `vox --nick <nickname>` for interactive mode, or
`vox stream --nick <nickname>` for stream mode.

In interactive mode, type `:help` for help.


Stream mode
==============
If you like "command lines" and "pipes", you perhaps may like Postvox in stream
mode.

Pipe in JSON-encoded [stanzas](./Protocol.md#5-stanzas), one per line.  It
outputs JSON-encoded stanzas, one per line.

Example usage:

    $ vox init --nickname mynickname  # You only need to run this once.
    ...
    $ touch /tmp/stanzas-to-send
    $ tail -n0 -f /tmp/stanzas-to-send | vox stream --nickname mynickname &
    $ echo '{ "text": "hello!" }' >> /tmp/stanzas-to-send


**Optional Flags**

Name | Description
:----|:-----------
`--stream` | The name of the stream to read from and post to.  E.g., "nickname/stream".
`--seqStart` | Start reading from this stanza sequence number.
`--seqLimit` | Stop reading before this stanza sequence number.
`--type` | Only output this type of stanza.  One of "MESSAGE", "USER_PROFILE", "USER_STATUS", "VOTE".


Clients and bots
===================
It's pretty straightforward to write a Postvox bot.  See [pingbot.js](./vox-client/examples/pingbot.js) and [morsebot.js](./vox-client/examples/morsebot.js) for example.

Example:

```js
var VoxClient = require('vox-client')

var client = new VoxClient({
    agentString: 'My pingbot'
})

client.connect()
  .then(function() {
    client.post({ text: 'hello!' })
    client.createReadStream({ type: 'MESSAGE' })
      .on('data', function(stanza) {
        console.info('%s says %s', stanza.nick, stanza.text)
        if (stanza.nick == client.nick) {
          return;
        }
        client.post({
            text: 'Pong: ' + stanza.text,
            replyToStanza: stanza
        })
      })
  })
```


Docs
=======
- [Detailed protocol document](Protocol.md)
- [Lessons learned](Lessons-learned.md)
- [TODO](TODO.md)
