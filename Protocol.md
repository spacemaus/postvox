Postvox Protocol
===================

*STATUS: Draft/Proof-of-concept*
*VERSION: 0.0.1*

Postvox: A modern social network in the classical style.

The protocol is meant to be:

- Open.  Any client or server can participate in the network.

- Distributed.  No single entity should control the flow of information through
  the network.

- Simple to implement.  It should be relatively easy to create a new client or
  server.

- Extensible.  Implementations should be able to layer new functionality on top
  of the protocol without breaking backwards compatibility.

- Secure.  Encryption should be built in.


Table of contents
--------------------

- [0. Overview](#0-overview)
  - [Postvox streams](#postvox-streams)
  - [Data philosophy](#data-philosophy)
- [1. Interchange server protocol](#1-interchange-server-protocol)
  - [Synchronization](#synchronization)
  - [Timestamps](#timestamps)
  - [Input limits, validation, normalization](#input-limits-validation-normalization)
- [2. Authentication and encryption](#2-authentication-and-encryption)
  - [Public and private encryption keys](#public-and-private-encryption-keys)
  - [Signing stanzas](#signing-stanzas)
  - [Encrypted stanzas](#encrypted-stanzas)
  - [Private streams](#private-streams)
- [3. Accessing interchange endpoints](#3-accessing-interchange-endpoints)
- [4. Interchange endpoints](#4-interchange-endpoints)
  - [Begin or resume a session](#begin-or-resume-a-session)
  - [Request push notifications for stanzas published to a stream](#request-push-notifications-for-stanzas-published-to-a-stream)
  - [Append a stanza to a stream](#append-a-stanza-to-a-stream)
  - [Read a list of stanzas from a stream](#read-a-list-of-stanzas-from-a-stream)
  - [Read a specific stanza from a stream](#read-a-specific-stanza-from-a-stream)
- [5. Stanzas](#5-stanzas)
  - [Common fields](#common-fields)
  - [Stanza URLs](#stanza-urls)
  - [Message stanza](#message-stanza)
  - [UserProfile stanza](#userprofile-stanza)
  - [UserStatus stanza](#userstatus-stanza)
  - [Vote stanza](#vote-stanza)
  - [Settings stanza](#settings-stanza)
  - [Invite stanza](#invite-stanza)
  - [Envelope stanza](#envelope-stanza)


0. Overview
==============
The Postvox network is a network of databases and end-user clients. Each
database (called an **interchange server**) stores one or more streams of
"posts" to or from users, plus user metadata.

![Postvox architecture diagram](architecture-diagram.png)

- Each user owns one or more **streams**, which are time-ordered lists of
  stanzas (messages, invitations, and other notifications).
- All the streams for a single user are hosted on an **interchange
  server**<sup>1</sup>.
- One interchange server can host one or more users and their streams.

The feature that makes Postvox a "social" network (as opposed to a point-to-
point messaging protocol) is that users can *subscribe* to messages published by
and sent to other users.  This makes it easy and natural to be a part of larger,
loosely-connected conversations.

Furthermore, a "user" doesn't even have to correspond to a real person.  It's
possible (and reasonable) to create a "user" that is just a gathering point for
a community or topical discussion.  For example, one could create a user named
"technews".  Anyone who wished could then direct messages to @technews, and the
messages would be pushed to anyone who followed @technews.

<sup>1</sup><small>For the purposes of this document, an "interchange server" is
any service that can be identified by and reached via a single URL.  That means
an "interchange server" may actually be a cluster of load-balanced, distributed
servers behind that one URL.  It makes no difference to the protocol.</small>


Postvox streams
------------------
A Postvox stream is an ordered list of [stanzas](#5-stanzas).

There are three main actions a client can perform on the Postvox network:

1. Append a stanza to a stream.
2. Read stanzas from a stream.
3. Subscribe to or unsubscribe from a stream.

Streams are identified by a Postvox URL.  A typical Postvox URL looks like this:

    vox:<owner>/<stream-name>

e.g.:

    vox:spacemaus/friends

or, for the default public stream:

    vox:spacemaus

The `<owner>` part of the URL is a user's nickname.  It is translated into a
real internet hostname by looking it up at the Hub.  See
[Hub protocol](Hub-Protocol.md) for details.

(One might reasonably ask why the nickname isn't just a real hostname to begin
with.  The reason is so that your nickname [and therefore your identity] is not
tied to any particular host or service provider.  The extra level of indirection
means that you can move your hosting provider freely without losing your history
or connections.)

If `<stream-name>` is omitted from a URL, it refers to the owner's default
public stream.

Each stream can have its own privacy settings.  Private streams can be
encrypted.


Data philosophy
------------------
Some simple guidelines:

1. When you as a user do anything, you should publish the fact to (a) your own
   interchange server, and (b) the interchange server of the target of that
   action. *E.g., if you've subscribed to a stream, you might publish a
   VOTE stanza to that stream and to your own public stream.*

2. If you have a stanza you want someone else to see, you should push it to
   their interchange server.  *E.g., if you've @mentioned someone, you should
   publish that message to your own server, then clone it to their server.*

3. If you are interested in a stream, you are responsible for ensuring your view
   of that stream is up-to-date.  *E.g., the server may push messages to a
   client, but the client is responsible for checking that there are no gaps in
   the stream.*



1. Interchange server protocol
=================================
The protocol is REST-shaped, although in the typical case most of the transport
happens over a socket interface rather than via raw HTTP requests.

An interchange server stores and serves the streams for one or more users.
Clients (applications and other interchange servers) can "subscribe" to receive
push messages when a user publishes new stanzas to a stream.

Whenever a client wants to see a certain user's stream, they will connect to
that user's registered interchange server.

Whenever a client wants to direct a stanza to a certain user, they will push the
stanza directly to that user's registered interchange server.

A single stanza may be copied to multiple places in the network:

- On the author's interchange server.
- On the interchange server's of the author's followers.
- On the client devices of the author and the followers.

In addition, a message may be "cloned" when the author directs it to one or more
other users (e.g., via "@yourname").  In this case, the clones will have a
reference to the original message's URL, but will otherwise be independent of
each other.

It is the responsibility of the *client* program to ensure that a message is
pushed to the interchange servers of its explicit addressees.


Synchronization
------------------
When an interchange client is connected to an interchange server, the *client*
is responsible for ensuring that its view of the server's resources is up to
date. That is, if an interchange server queues a message for delivery to a
connected client, but the connection is broken before the client received the
message, it is the client's responsibility to (a) reconnect to the server, and
(b) request any messages it may have missed.

Each stanza in a stream has a `seq` field assigned by the server.  The `seq`
values in a stream are consecutive integers starting from 1.

If a client finds a gap in the `seq` values it has for a stream, then it can
send a read request for the stanzas in the missing interval.

When stanzas are updated or deleted, the interchange should store a "tombstone"
at the `seq` of the old version.


Timestamps
-------------
All timestamps are represented as UNIX timestamps in milliseconds.
Implementations should reserve at least 48 bits for timestamp values.

Timestamps that are named `createdAt`, `updatedAt`, or `deletedAt` are assigned
by *client* programs.  Thus they are subject to whatever clock values each
client may provide, and are not necessarily reliable values for sorting stanzas
from different clients.  The only assumption is that for any given nickname, the
`updatedAt` timestamps will be monotonically increasing.

Timestamps named `syncedAt` are assigned by the receiving interchange server.
Thus clients may sort stanzas by their `syncedAt` timestamps, as long as those
stanzas come from the same interchange server.


Input limits, validation, normalization
------------------------------------------
The protocol does not currently specify any particular limits on the size of
inputs or rate of requests.  Interchange servers may respond with a status of
`413: Request Entity Too Large` or `503 Service Unavailable`, respectively.

Nicknames must adhere to the [Hub protocol](Hub-Protocol.md).

URLs are normalized to their Unicode lowercase form.



2. Authentication and encryption
===================================

Public and private encryption keys
-------------------------------------
When a user registers a nickname at the Hub, they must include a public
encryption key: an RSA key with modulus = 2048 and exponent = 65537. (TODO is
it necessary and sufficient to spec this?)

Any user can then verify or decrypt messages from any other user by looking up
their public key at the Hub.

Interchange servers and the Hub will reject stanzas that claim to be from a
user, but whose signatures do not match the key on file with the Hub.


Signing stanzas
------------------
Every user-generated stanza is signed with the user's corresponding private key.
Interchange servers and clients must verify that the stanzas' signatures match
the key on record at the Hub, as of the `updatedAt` timestamp in the stanza.

Whenever `sig` appears in a stanza or parameter list, it is defined as the
concatenation of the other stanza fields, sorted in alphabetical order by the
field name, hashed with `SHA-1`, signed by the author's private key, and base64
encoded:

    values = sortAndConcatenateFields(stanza)
    sig = base64(privateKey.hashAndSign('sha1', values))

When concatenating fields:

- Each field value is terminated by '\x00'.
- Integer and timestamp values are decimal encoded.
- Boolean values are represented as `"true"` or `"false"`.

Interchange servers and clients must reject any stanza whose signature is
invalid.  If an interchange server receives stanza with an invalid signature, it
must respond with a status of `403: Forbidden`.


Encrypted stanzas
--------------------
If a user wishes to send a private, encrypted stanza to another user, they may
enclose it in an [Envelope stanza](#envelope-stanza).

- The envelope stanza specifies the minimum public information needed to route
  the message, along with the encrypted content stanza.
- The envelope may include the key needed to decode the contents, or it may omit
  the key if it was previously distributed via the process specified in the
  [Private streams](#private-streams) section.
- If the key is included, it is encoded with the intended recipient's registered
  public key.


Private streams
------------------
A stream may be marked as **private**.  When a stream is private, then the
interchange server will accept only [Envelope stanzas](#envelope-stanza) that
are signed with a user-generated, stream-specific key.

A user may create a private stream and invite others via this process:

1. User "A" generates a public/private keypair (`streamPubkey` and
   `streamPrivkey`) and a symmetric encryption key (`contentKey`).
2. User "A" sends a [Settings stanza](#settings-stanza) to the
   `vox:A/friendsonly` stream.  This stanza includes the *public* key from (1).
3. User "A" sends an [Envelope stanza](#envelope-stanza) to the streams of each
   of their friends ("B/private", "C/private", etc.).  This envelope contains:
   - contents = an [Invite stanza](#invite-stanza) with the `inviteTo` stream
     name, `streamPrivkey`, and `contentKey`.  The stanza is JSON-encoded and
     encrypted with `contentKey`.
   - contentKey = `publicKeyEncrypt(friendPubkey, contentKey)`

Now, when a user wishes to post to the private stream:

1. User "B" creates a stanza (e.g., a [Message](#message-stanza)).
2. User "B" looks up their invitation for the private stream and locates
   `streamPrivkey` and `contentKey` for the stream.
3. User "B" posts an [Envelope stanza](#envelope-stanza) with these fields:
    - nick = "__private__"
    - stream = "A/friendsonly" (for example)
    - contents = `symmetricEncrypt(contentKey, stanza)`


3. Accessing interchange endpoints
=====================================
Endpoints can be accessed over a socket connection (currently whatever is
implemented by `socket.io`) or via an HTTP request:

#### Socket commands

When sending a command over a socket connection, the command stanza must have a
event name that matches the HTTP method name (i.e., "GET", "POST", "SUBSCRIBE",
or "UNSUBSCRIBE"), and its data must be a JSON object with these fields:

Name | Type | Details
:----|:-----|:-------
url     | URL | The `vox:` URL being requested, e.g. "vox:spacemaus/friends".
payload | Object | The data payload of the command.  See the **Parameters** sections in the documentation for the individual endpoints below.

For example, to fetch recent stanzas from `spacemaus`'s "friends" stream (in
Node.js):

```js
var io = require('socket.io-client');
var socket = io.connect(interchangeUrl, { transports: ['websocket'] };
socket.emit('GET', {
    url: 'vox:spacemaus/friends',
    payload: {
        type: 'MESSAGE',
        seqAfter: 100,
        limit: 20
    }},
    function(reply) {
      console.info('Got reply status: %d, number of stanzas: %d',
          reply.status,
          reply.stanzas ? reply.stanzas.length : 0);
    });
```


#### HTTP commands

When sending a command via an HTTP request, the URL must have these query
parameters:

Name | Type | Details
:----|:-----|:-------
method | String | The Postvox method name, if the Postvox method is not POST or GET.  E.g., "SUBSCRIBE vox:spacemaus" translates to a URL like "POST http://vanilla.postvox.net?owner=spacemaus&method=SUBSCRIBE"

#### Status codes
Status codes for both the socket and HTTP endpoints are HTTP status codes.

Common codes:

- 200: OK.
- 400: Client error.  Probably a missing or poorly-formatted parameter.
- 404: Not found.  Either a non-existent user, or a non-existent endpoint.
- 403: Not authorized.  The `sig` field does not match the expected signature.
- 409: Conflict.  Either a too-old `updatedAt` timestamp or a duplicate transaction ID was provided.
- 500: Server error.
- 503: Not available.  Possibly due to rate-limiting.

#### NOTE

The Postvox protocol does not specify endpoints for certain things that
a end-user client would probably like (for example, muting replies to a thread).
Those are the purview of an end-client protocol, which may or may not be a
superset of the interchange protocol.  The interchange protocol is specifically
for services that are needed for the peer-to-peer exchange of streams and user
metadata.



4. Interchange endpoints
===========================

- [Begin or resume a session](#begin-or-resume-a-session)
- [Request push notifications for stanzas published to a stream](#request-push-notifications-for-stanzas-published-to-a-stream)
- [Append a stanza to a stream](#append-a-stanza-to-a-stream)
- [Read a list of stanzas from a stream](#read-a-list-of-stanzas-from-a-stream)
- [Read a specific stanza from a stream](#read-a-specific-stanza-from-a-stream)


Begin or resume a session
-----------------------------
Socket form:

    POST vox:__session__/session[/<sessionId>]

HTTP form:

    POST /session[/<sessionId>]

A "session" is a relationship between an interchange server and client.  It is
meant to be long-lived.  If a client wants to receive push messages from the
server, it needs to first establish a session.  Whenever the client reconnects
to the server, it can reestablish that same session to resume receiving push
messages.

#### Parameters

Name | Type | Details
:----|:-----|:-------
version   | String | The version of the Postvox protocol that the client understands.
agent     | String | The client's agent string.  Contents are unspecified.
[webhook] | URL | If specified, then messages will be pushed by making a POST request to this URL.  May not be supported by all servers.

#### Returns

Name | Type | Details
:----|:-----|:-------
status         | int | The status code of the result.  See [Status codes](#status-codes).
version        | String | The version of the Postvox protocol that the server understands.
agent          | String | The server's agent string.  Contents are unspecified.
terms          | String | A link to the server's terms of service.
[newSessionId] | String | If a new session was created, then its ID is returned.  Even if a client passes a `sessionId` in its request, it is not guaranteed that the server will be able to resume that session.  Thus, clients must always check this parameter and -- if it is set -- reissue any `ROUTE` commands it may need.
[error]        | String | If `status` is not 200, a string describing the error.



Request push notifications for stanzas published to a stream
---------------------------------------------------------------
Socket form:

    SUBSCRIBE vox:<owner>[/<stream-name>]
    UNSUBSCRIBE vox:<owner>[/<stream-name>]

HTTP form:

    POST /[<stream-name>]?source=<owner>&method=[SUBSCRIBE|UNSUBSCRIBE]

Requests push notifications for any stanzas published to the given stream. The
client must first create a session before requesting notifications.

UNSUBSCRIBE does the opposite of SUBSCRIBE.

#### Parameters

Name | Type | Details
:----|:-----|:-------
sessionId | String | The session ID assigned by a previous call to [/session](#begin-or-resume-a-session).
updatedAt | Timestamp (ms) | The timestamp of the request.  For a given `sessionId` and stream URL, the server will accept only commands with a timestamp larger than the largest `updatedAt` received for the given URL so far.

#### Returns

Name | Type | Details
:----|:-----|:-------
status  | int | The status code of the result.  See [Status codes](#status-codes).
[error] | String | If `status` is not 200, a string describing the error.



Append a stanza to a stream
------------------------------
Socket form:

    POST vox:<owner>[/<stream-name]

HTTP form:

    POST /[<stream-name>]?source=<owner>

#### Parameters

Name | Type | Details
:----|:-----|:-------
stanza | A [Stanza](#5-stanzas) | The stanza to append.

#### Returns

Name | Type | Details
:----|:-----|:-------
status  | int | The status code of the result.  See [Status codes](#status-codes).
stanza  | A [Stanza](#5-stanzas) | The stanza that was posted.  Servers may choose to return a subset of the stanza that contains only the fields assigned by the server (for example, `seq`).
[error] | String | If `status` is not 200, a string describing the error.

#### Publishes

The stanza will be published to any clients that have subscribed to the stream.



Read a list of stanzas from a stream
---------------------------------------
Socket form:

    GET vox:<owner>[/<stream-name>]

HTTP form:

    GET /[<stream-name>]?source=<owner>

#### Parameters

Name | Type | Details
:----|:-----|:-------
[limit]     | int | The maximum number of stanzas to return.  Defaults to 40.
[seqStart]  | int | Return only stanzas with `seq` equal to or larger than this value.  Defaults to 1.
[seqLimit]  | int | Return only stanzas with `seq` less than this value.  Defaults to infinity.
[reverse]   | bool | Return stanzas in reverse `seq` order.
[nick]      | String | If set, then returns the messages that have this `nick` value.
[stanzaUrl] | String | If set, then returns the stanza that has this `stanzaUrl` value.
[thread]    | String | If set, then returns the messages that have this `thread` value.  Valid only for requests where `type` = "MESSAGE".
[replyTo]   | String | If set, then returns the messages that have this `replyTo` value.  Valid only for requests where `type` = "MESSAGE".
[opSeq]     | String | If set, then returns the stanzas that have this `opSeq` value.

#### Returns

Name | Type | Details
:----|:-----|:-------
status  | int | The status code of the result.  See [Status codes](#status-codes).
stanzas | Array of [Stanzas](#5-stanzas) | The requested stanzas.
[error] | String | If `status` is not 200, a string describing the error.

> TODO specify `auth` for private streams.


Read a specific stanza from a stream
---------------------------------------
Socket form:

    GET vox:<owner>[/<stream-name>]/<seq>

HTTP form:

    GET /[<stream-name>/]<seq>?source=<owner>

Note that if a client wishes to retrieve the most recent version of a message,
they should send a request for that message URL.

#### Parameters

*None*

#### Returns

Name | Type | Details
:----|:-----|:-------
status  | int | The status code of the result.  See [Status codes](#status-codes).
stanza  | A [Stanza](#5-stanzas) | The requested stanza.
[error] | String | If `status` is not 200, a string describing the error.



5. Stanzas
=============
Stanzas are the chunks of content that users read from and write to streams.

- [Common fields](#common-fields)
- [Stanza URLs](#stanza-urls)
- [Message stanza](#message-stanza)
- [UserProfile stanza](#userprofile-stanza)
- [UserStatus stanza](#userstatus-stanza)
- [Vote stanza](#vote-stanza)
- [Settings stanza](#settings-stanza)
- [Invite stanza](#invite-stanza)
- [Envelope stanza](#envelope-stanza)


Common fields
-----------------
Every stanza has these fields.

Name | Type | Details
:----|:-----|:-------
type      | String | The type of the stanza.
nick      | String | The nickname of the author of the stanza.
stream    | String | The stream that the stanza belongs to.
updatedAt | Timestamp (ms) | The (client-provided) timestamp of the stanza.
seq       | int | The sequence value of the stanza in its stream.  Assigned by the interchange server.
[op]      | String | The operation to apply to the stream.  One of "POST", "PUT", or "DELETE".  Defaults to "POST".
[opSeq]   | int | The `seq` value of the stanza that is the target of a "PUT" or "DELETE" `op`.
sig       | String | The Base64 encoded signature of the author (see [Authentication](#2-authentication-and-encryption)).


Stanza URLs
--------------
Each stanza has a unique URL of the form `vox:<owner>[/<stream-name>]/<seq>`.
For example: "vox:spacemaus/friends/3".



Message stanza
-----------------
A MESSAGE stanza is a user-to-user communication.  A message always exists in
only one stream.  A message may have "clones" in other streams that refer to it.
(Clones are used when one user wants to direct another user's attention back to
the original message.)

Name | Type | Details
:----|:-----|:-------
type        | String | `"MESSAGE"`.
nick        | String | The nickname of the author.  E.g., `spacemaus`.
stream      | String | The stream, identical to `<owner>/<stream-name>` in `messageUrl`.  This is included for authentication purposes.  `messageUrl` is assigned by the server and therefore cannot be signed by the author beforehand.
clone       | URL | The URL of the original message from which this message was cloned.  See [Stanza URLs](#stanza-urls).
thread      | URL | The URL of the first message in a thread of replies.  See [Stanza URLs](#stanza-urls).
replyTo     | URL | The URL of the message being replied to.  See [Stanza URLs](#stanza-urls).
text        | String | The body text of the message.
title       | String | The user-visible title of the message.
userUrl     | String | An arbitrary URL associated with the message.
etc         | String | An optional message payload.  Can be used by clients to extend the message.  Probably JSON encoded.
updatedAt   | Timestamp (ms) | The (client-provided) timestamp of the stanza.
createdAt   | Timestamp (ms) | The timestamp of when the stanza was created.
[deletedAt] | Timestamp (ms) | The timestamp of when the stanza was deleted.  Unset if the stanza has not been deleted.
sig         | String | The Base64 encoded signature of the author (see [Authentication](#2-authentication-and-encryption)).
syncedAt    | Timestamp (ms) | The timestamp at which the interchange server received the message.
seq         | int | The sequence number assigned by the interchange server.
[op]        | String | The operation to apply to the stream.  One of "POST", "PUT", or "DELETE".  Defaults to "POST".
[opSeq]     | int | The `seq` value of the stanza that is the target of a "PUT" or "DELETE" `op`.


#### `sig` fields

- clone
- deletedAt
- etc
- nick
- op
- opSeq
- replyTo
- stream
- text
- thread
- title
- type
- updatedAt
- userUrl



UserProfile stanza
---------------------

Name | Type | Details
:----|:-----|:-------
type           | String | `"USER PROFILE"`.
nick           | String | The nickname of the user.
stream         | String | The stream that the profile was posted to.  For UserProfiles, this should always be `"<nick>"`.
interchangeUrl | URL | The URL of the user's interchange server.
pubkey         | String | The user's public key.
about          | String | Details about the user.  Probably a string in JSON format.
updatedAt      | Timestamp (ms) | The (client-provided) timestamp of the stanza.
hubCreatedAt   | Timestamp (ms) | The timestamp when this profile was first received by the Hub.
hubSyncedAt    | Timestamp (ms) | The timestamp that the profile was received by the Hub.
syncedAt       | Timestamp (ms) | The timestamp that the profile was received by the interchange server.
sig            | String | The Base64 encoded signature of the author (see [Authentication](#2-authentication-and-encryption)).
hubSig         | String | The Base64 encoded signature from the Hub (see [Authentication](#2-authentication-and-encryption)).
seq            | int | The sequence number assigned by the interchange server.
[op]           | String | **For UserProfiles, this should always be unset.**
[opSeq]        | int | **For UserProfiles, this should always be unset.**

#### `sig` fields

- about
- interchangeUrl
- nick
- op
- opSeq
- pubkey
- stream
- type
- updatedAt

**NOTE**: When the user's `pubkey` has changed, the `UserProfile.sig` field
notifying others of the change MUST be signed with the user's **previous**
private key.

**NOTE**: This stanza notifies others about updates to a user's profile details
(e.g. `pubkey` and `interchangeUrl`), which should change rarely.  There is a
sibling stanza [UserStatus](#UserStatus-stanza) that updates a user's current
status, which may change frequently.

**NOTE**: This is an exact copy of the data registered at the Hub.  Posting it
to the Hub and to the user's interchange server notifies any of the user's
followers of the update immediately, which is important when either the user's
`pubkey` or `interchangeUrl` change.

#### `hubSig` fields

When the Hub receives a profile update, it signs these fields with its keys and
stores the signature in `hubSig`.

- about
- hubCreatedAt
- hubSyncedAt
- interchangeUrl
- nick
- op
- opSeq
- pubkey
- sig
- stream
- type
- updatedAt



UserStatus stanza
--------------------

Name | Type | Details
:----|:-----|:-------
type       | String | `"USER_STATUS"`.
nick       | String | The nickname of the user.
stream     | String | The stream that the status was posted to.  E.g., "spacemaus/friends".
statusText | String | The user-provided status text.
isOnline   | bool | Whether the user is online.
updatedAt  | Timestamp (ms) | The (client-provided) timestamp of the stanza.
sig        | String | The Base64 encoded signature of the author (see [Authentication](#2-authentication-and-encryption)).
seq        | int | The sequence number assigned by the interchange server.
[op]   | String | The operation to apply to the stream.  One of "POST", "PUT", or "DELETE".  Defaults to "POST".
[opSeq] | int | The `seq` value of the stanza that is the target of a "PUT" or "DELETE" `op`.

#### `sig` fields

- isOnline
- nick
- op
- opSeq
- statusText
- stream
- type
- updatedAt



Vote stanza
--------------

Name | Type | Details
:----|:-----|:-------
type      | String | `"VOTE"`.
nick      | String | The nickname of the voter.
stream    | String | The stream that the vote was posted to.  E.g., "spacemaus/friends".
voteUrl   | URL | The URL that is the subject of the vote.  E.g., "vox:spacemaus/1234".
tag       | String | The aggregation tag.  Clients may interpret this value however they like.  Max 64 chars.
score     | int | The value of the vote.  Clients may interpret this value however they like.
updatedAt | Timestamp (ms) | The (client-provided) timestamp of the stanza.
sig       | String | The Base64 encoded signature of the author (see [Authentication](#2-authentication-and-encryption)).
seq       | int | The sequence number assigned by the interchange server.
[op]      | String | The operation to apply to the stream.  One of "POST", "PUT", or "DELETE".  Defaults to "POST".
[opSeq]   | int | The `seq` value of the stanza that is the target of a "PUT" or "DELETE" `op`.

#### `sig` fields

- nick
- op
- opSeq
- score
- stream
- tag
- type
- updatedAt
- voteUrl



Settings stanza
------------------
Clients can post SETTINGS stanzas to a stream in order to control how the
interchange server will respond to requests sent to that stream.

Name | Type | Details
:----|:-----|:-------
type                 | String | `"SETTINGS"`.
nick                 | String | The nickname of the user.
stream               | String | The stream that the settings are for.
options              | String | A JSON-encoded object.  It is an encoded object so that future additions to the protocol do not alter the `sig` fields.
options.streamPubkey | String | The public key that will be used to sign [Envelope stanzas](#envelope-stanza) sent by `"__private__"`.
options.allowPublic  | bool | Whether the interchange server will allow public stanzas.  If false, then it will only accept [Envelope stanzas](#envelope-stanza) signed by `"__private__"`.
sig                  | String | The Base64 encoded signature of the author (see [Authentication](#2-authentication-and-encryption)).
updatedAt            | Timestamp (ms) | The (client-provided) timestamp of the stanza.
seq                  | int | The sequence number assigned by the interchange server.
[op]                 | String | The operation to apply to the stream.  One of "POST", "PUT", or "DELETE".  Defaults to "POST".
[opSeq]              | int | The `seq` value of the stanza that is the target of a "PUT" or "DELETE" `op`.

#### `sig` fields

- nick
- op
- opSeq
- options
- stream
- type
- updatedAt



Invite stanza
----------------
Clients can send INVITE stanzas to invite other users to private, encrypted
streams. INVITE stanzas MUST always be enclosed in an [Envelope stanza](#envelope-stanza).

Name | Type | Details
:----|:-----|:-------
type          | String | `"INVITE"`.
nick          | String | The nickname of the inviter.
stream        | String | The stream that the invitation was posted to.  E.g., "spacemaus/private".
inviteTo      | String | The name of the stream that the invitation is to.
contentKey    | String | The symmetric key used to encrypt and decrypt envelope contents in the `inviteTo` stream.
streamPrivkey | String | The private key that is used to sign envelopes in the `inviteTo` stream.
sig           | String | The Base64 encoded signature of the author (see [Authentication](#2-authentication-and-encryption)).
updatedAt     | Timestamp (ms) | The (client-provided) timestamp of the stanza.
seq           | int | The sequence value of the stanza in its stream.  Usually unset, since invites are sent in envelopes.
[op]          | String | The operation to apply to the stream.  One of "POST", "PUT", or "DELETE".  Defaults to "POST".
[opSeq]       | int | The `seq` value of the stanza that is the target of a "PUT" or "DELETE" `op`.

#### `sig` fields

- contentKey
- inviteTo
- nick
- op
- opSeq
- stream
- streamPrivkey
- type
- updatedAt



Envelope stanza
------------------
Clients can use ENVELOPE stanzas to enclose private, encrypted stanzas.

Name | Type | Details
:----|:-----|:-------
type       | String | `"ENVELOPE"`.
nick       | String | The nickname of the author.  This may be `"__private__"` if the contents of the envelope have been signed with a stream key instead of a user key.
stream     | String | The stream that the stanza belongs to.
contents   | String | The encrypted contents of the envelope.  Generally, this will be a JSON-encoded stanza.
contentKey | String | The symmetric key used to encrypt envelope contents.  The key is itself encrypted with the public key of the intended recipient.  In most cases, this field will only be set when the contents are an Invite stanza.
updatedAt  | Timestamp (ms) | The (client-provided) timestamp of the stanza.
seq        | int | The sequence value of the stanza in its stream.  Assigned by the interchange server.
[op]       | String | The operation to apply to the stream.  One of "POST", "PUT", or "DELETE".  Defaults to "POST".
[opSeq]    | int | The `seq` value of the stanza that is the target of a "PUT" or "DELETE" `op`.
sig        | String | The Base64 encoded signature.  **NOTE** If `nick` is `"__private__"`, then the private key used to sign an envelope is NOT the key of the author of the contents of the envelope.  Instead, it is the private key received via an [Invite stanza](#invite-stanza).  (See [Authentication](#2-authentication-and-encryption)).

#### `sig` fields

- contentKey
- contents
- nick
- op
- opSeq
- stream
- type
- updatedAt

