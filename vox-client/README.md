Postvox client library
=========================
This is a client library for the Postvox network.  The package also includes a(n
awful) terminal client for the network.

- [Using vox-client](#using-vox-client)
  - [VoxClient methods](#voxclient-methods)
    - [`new VoxClient(options)`](#new-voxclientoptions)
    - [`VoxClient.connect()` -> `Promise`](#voxclientconnect---promise)
    - [`VoxClient.subscribe(stream)` -> `Promise`](#voxclientsubscribestream---promise)
    - [`VoxClient.unsubscribe(stream)` -> `Promise`](#voxclientunsubscribestream---promise)
    - [`VoxClient.listSubscriptions()` -> `Promise>`](#voxclientlistsubscriptions---promise)
    - [`VoxClient.post(message](#, options)
    - [`VoxClient.postVote(stanza)` -> `Promise`](#voxclientpostvotestanza---promise)
    - [`VoxClient.postUserStatus(stanza)` -> `Promise`](#voxclientpostuserstatusstanza---promise)
    - [`VoxClient.postUserProfile(stanza)` -> `Promise`](#voxclientpostuserprofilestanza---promise)
    - [`VoxClient.createReadStream(options)` -> `stream.Readable`](#voxclientcreatereadstreamoptions---streamreadable)
    - [`VoxClient.createCheckpointStream(options)` -> `stream.Transform`](#voxclientcreatecheckpointstreamoptions---streamtransform)
    - [`VoxClient.close()`](#voxclientclose)
- [Terminal client](#terminal-client)


Using vox-client
===================
Fetch the library with NPM:

    $ npm install vox-client vox-common

Use it:

```js
var VoxClient = require('vox-client')
var voxurl = require('vox-common/voxurl')

var client = new VoxClient({
    agentString: 'My client agent',
    nick: 'myclientnickname'
})

client.connect()
  .then(function() {
    client.post({ text: 'Hello!' })
  })
```

VoxClient methods
--------------------

### `new VoxClient(options)`
Creates a new VoxClient.

#### Options fields

Name | Type | Details
:----|:-----|:-------
options.nick                  | String | The Postvox nickname to use.  Must have been registered with the network.  The nickname's credentials must be accessible from `options.profilesDir` or `options.config`.  Use `vox init --nick <nickname>` to register a new nickname with the network.  Defaults to `--nick`.
options.profilesDir           | String | If set, then read profile configs and store the local databases in this directory.  Defaults to `--profilesDir` if set, or `~/.voxprofiles` otherwise.
options.config                | Object | If set, then use this config object instead of reading from disk.
options.config.nick           | String | The Postvox nickname to use.  Required if `config` is given.
options.config.privkey        | String | The user's private key in RSA PEM format.  Required if `config` is given.
options.config.interchangeUrl | String | The URL to the user's home interchange server.  Required if `config` is given.
hubUrl                        | String | The Hub url to use.  Defaults to `--hubUrl` if set, or `http://hub.postvox.net` otherwise.
agentString                   | String | The agent to send to servers.  Defaults to `'voxbot :)'`.


### `VoxClient.connect()` -> `Promise`
Initialized the client object and connects to the interchange servers for any
saved subscriptions.

Must be called before any other operations.


### `VoxClient.subscribe(stream)` -> `Promise`
Subscribes the user to the given stream.  The subscription is saved locally, and will be restored for future connections.

If any read streams are open, the new subscription will be added to those streams.

`stream` must be a valid stream identifier: `'[vox:]<nickname>[/streamname]'` or
`'@<nickname>[/streamname]'`.  The following are valid stream identifiers:

- vox:spacemaus
- vox:spacemaus/friends
- @spacemaus
- @spacemaus/friends
- spacemaus
- spacemaus/friends


### `VoxClient.unsubscribe(stream)` -> `Promise`
Does the opposite of `.subscribe(stream)`.


### `VoxClient.listSubscriptions()` -> `Promise<Array<Subscription>>`
Returns an array of the user's locally-saved subscriptions.


### `VoxClient.post(message[, options])` -> `Promise<Message>`
Posts a message to a stream.

#### Message fields

Name | Type | Details
:----|:-----|:-------
stream  | String | The stream to post the message to.  See [`.subscribe()`](#voxclientsubscribestream---promise) for valid stream names.
text    | String | The text of the message.
title   | String | A title for the message.
userUrl | String | A URL to publish with the message
etc     | Object | Miscellaneous payload.  Will be JSON encoded, if present.
thread  | String | The message URL of the first message in a thread.  Use `voxurl.getStanzaUrl(stanza)` to get the URL of a MESSAGE stanza.
replyTo | String | The message URL of the message to reply to.  Use `voxurl.getStanzaUrl(stanza)` to get the URL of a MESSAGE stanza.

#### Options fields

Name | Type | Details
:----|:-----|:-------
cloneToMentions | bool | If true, the message will be cloned to the servers of any nicknames that were "@mentioned" in the message's text.  Defaults to true.
cloneTo | String[] | The nicknames to clone the message to.  The message will be cloned to their interchange servers.


### `VoxClient.postVote(stanza)` -> `Promise<Vote>`
Posts a vote to a stream.

#### Stanza fields
See [Vote stanza](../Protocol.md#vote-stanza).


### `VoxClient.postUserStatus(stanza)` -> `Promise<UserStatus>`
Posts a user status to a stream.

#### Stanza fields
See [UserStatus stanza](../Protocol.md#userstatus-stanza).


### `VoxClient.postUserProfile(stanza)` -> `Promise<UserProfile>`
Posts a user profile to a stream.

#### Stanza fields
See [UserProfile stanza](../Protocol.md#userprofile-stanza).


### `VoxClient.createReadStream(options)` -> `stream.Readable`
Creates a Readable stream for one or more Postvox streams.

#### Options fields

Name | Type | Details
:----|:-----|:-------
type          | String | If given, only stanzas of this type will be read.  One of 'MESSAGE', 'USER_STATUS', 'USER_PROFILE', 'VOTE'.
stream        | String | If given, only stanzas posted to this stream will be read.  If not given, then all subscribed streams will be read.
seqStart      | int | If given, the stream will start reading from the stanza with this `seq` value.  If this value is not specified, then the stream will only return stanzas received after this Readable stream is created.  If negative, the stream will start from that number of most-recent stanzas (e.g., `seqStart: –20` starts from the 20th most recent stanza).
seqLimit      | int | If given, the stream will stop reading just before the stanza with this `seq` value.
checkpointKey | String | A key used to load stream checkpoints.  Overrides `seqStart`, if the checkpoint is in the database.
batchMode     | bool | If true, then the stream will return arrays of stanzas.  If false, the stream will return single stanzas.
batchSize     | int | The target size of batches to fetch from the database/network.


### `VoxClient.createCheckpointStream(options)` -> `stream.Transform`
Creates a Transform stream that writes checkpoints for the stanzas that pass
through it.

#### Options fields

Name | Type | Details
:----|:-----|:-------
checkpointKey | String | The key to use to write stream checkpoints to the local database.


### `VoxClient.close()`
Closes the client and any connections.



Terminal client
==================

    $ npm install -g vox-client
    $ vox init --nickname <mynickname>
    # Follow instructions to register a new nickname

    $ vox --nickname <mynickname>
    > :help
