Postvox
==========
A simple, open, distributed newsfeed network.

It takes inspiration from email, IRC, and Usenet on the one hand; and Twitter,
Facebook, and Instagram on the other.  It's real-time, and all that jazz.

**Q:** What's it good for?

**A:** Newsfeeds (like RSS) or real-time chat (like IRC or XMPP).

**Q:** What makes it special?

**A:** It's an open protocol like email, which means anyone can run their own
servers and participate in the wider network.

It's also easy to program custom "bots" to interact with the network.  (See
[morsebot.js](./vox-client/examples/morsebot.js) for example, or say "@morsebot
Hello!" to see it in action.)

---

Postvox is in open alpha.  You can try it out if this makes sense to you:

    $ npm install -g vox-client
    $ vox init --nick yournickname   # (Follow the instructions)
    $ vox --nick yournickname
    > :help
    > :follow spacemaus
    > @spacemaus Hi!


Help
=======
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
            stream: stanza.stream,
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
