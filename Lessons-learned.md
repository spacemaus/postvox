Lessons learned
==================
Notes on lessons learned from the initial implementation of Postvox.


Design notes
---------------

### Everything-is-a-file can be a nice way to model an API

- There was a choice between a proliferation of stream types that could each
  contain only homogenous elements *or* uniform streams that could contain
  heterogenous elements.
- the former ("resource-oriented") is more REST-y.
- the latter ("file-oriented") is more UNIX-y.
- a resource-oriented design is more sensible when it sits closer to the UI
 layer.
- a file-oriented design is a more flexible model, and is more appropriate
 the further down the stack you go.

Earlier design iterations started with the REST-y model.  Switching to a UNIX-y
model greatly simplified the design and implementation of the server.  It also
made the edges of the API easier to reason about.


### Pushing complexity to the client

One design goal was to make the protocol scalable by shifting complexity from
the server to the client.

A major result: the server doesn't track per-client, per-stanza delivery state.
It just fires stanzas to interested clients, and doesn't bother to verify that
each client has received them.

As a consequence, the client code for ensuring a consistent, ordered view of a
stream is much more complicated than it otherwise would be.  In fact, it's kind
of a buggy mess right now. Open question: are the storage/CPU savings on the
server side of the protocol offset by the increased chattiness from clients
validating their stream views?


### Public-key cryptography and distributed systems

- Public-key cryptography is fun to play with.

- It's very interesting to have per-user-action signatures (stanza `sig`s in the
  protocol).  It makes these things easy:

    - Distributed, untrusted storage of stanzas (stanza sigs cannot be forged).
      Like a bittorrent packet, it doesn't matter where the stanza came from:
      you can tell whether it is authentic.  (However, you can't tell if you
      have a complete list of an author's stanzas without consulting some
      trusted authority.)

    - Delegation of authority.  The central keystore can accept and serve a list
      of `(authorized-action, public-key, as-of-time)` tuples for each account.
      That way, a user can delegate and revoke authority to third parties
      without ever having to surrender credentials.


Implementation notes
-----------------------

1. Node streams, promises, event-emitters, and callbacks make for a complicated
   mix that can be difficult to reason about.  I still don't have a good handle
   on it.  It's like using git: at the start, it can be difficult to figure out
   what is going on, but eventually you learn how to think about the underlying
   model and how to not shoot yourself in the foot (or distribute shots to each
   of your branched feet).

   Two examples of common patterns:

   - Serializing access to memory or resources across callbacks/promise-chains,
     especially for read-modify-write patterns. Similar to using
     `synchronized{}` in Java, it feels like the wrong thing to do.

   - Checking for closed-state in each step of a promise-chain.

2. Error handling in Node:

    - Only throw or reject() with instances of Error or subclasses.

    - Promises can swallow errors sometimes.  Make sure you're always returning
      or `.catch()`ing the results of functions that return Promises.

    - Event handler callbacks can swallow errors.  Make sure they don't.

    - Your default behavior should be to kill the process when an error happens.

    - There are three ways of propagating errors: (1) throwing an exception, (2)
      rejecting a promise, and (3) emitting an 'error' event.  A complex class
      may need to use all three.

3. Making a terminal client is *not* necessarily faster than making a web UI and
   frontend.  It's fun for a while, but after a few speedbumps the time/value
   tradeoff becomes questionable.

4. Making a simple command-line client is completely worthwhile when developing
   a server and API.

5. The NPM ecosystem is pretty great.  If Python is "batteries included" then
   Node is "subscription to Batteries Warehouse included".
