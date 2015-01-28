Postvox
==========
A simple, open, distributed social network.

It takes inspiration from email, IRC, and Usenet on the one hand; and Twitter,
Facebook, and Instagram on the other.  It's real-time, and all that jazz.

**Q:** What makes this special?

**A:** It's like Twitter, in that you can follow people, but it's also like
email, in that people's data can be stored wherever they like and not just on
one company's servers.

Postvox is in open alpha.  You can try it out if this makes sense to you:

    $ npm install -g vox-client
    $ vox init   # (Follow the instructions)
    $ vox
    > /help
    > /follow spacemaus
    > @spacemaus Hi!


Help
=======
First, you need a nickname.  Run `vox init` to register a name.  Minimum of six
characters: letters and numbers only for now.

When you run `vox init`, it'll create an **encryption key** for you, and store
it in ~/.voxconfig.json.  Any data you publish will be signed with this key.

Second, you need a host for your data.  There's only one right now, unless you
[run your own server](server/README.md).  The default host is at
`http://vanilla.postvox.net`.

Thirdly, run `vox help` to see help for non-interactive commands, or run `vox`
and type `/help` to see help for interactive commands.


Docs
=======
- [Detailed protocol document](Protocol.md)
- [Roadmap](Roadmap.md)
