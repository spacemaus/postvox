Postvox Hub Protocol
=======================

*STATUS: Draft/Proof-of-concept*
*VERSION: 0.0.0*

0. Overview
==============
The Hub is a global name server.  It maps a user's nickname to a profile record.
The profile record tells everyone on the Postvox network:

- The user's public encryption key.
- Where the user's "home" interchange is located.
- Misc. metadata.

> TODO: The Hub is a weak part of the Postvox design, since the it is completely
> centralized.
>
> There's nothing stopping servers and clients from using their own Hub.  They
> only need to give a command-line flag and a public key.  Nevertheless, the
> design would be stronger if the name service authority were distributed.


1. User profiles
===================

Nicknames
------------
A user's nickname must be:

- At least 6 characters long.
- At most 64 characters long.
- Contain only Unicode lowercase letters or numbers.

The Hub will reject any nickname that does not meet those criteria.


UserProfile records
----------------------
A user's profile contains these fields:

Name | Type | Details
:----|:-----|:-------
nick           | String | The nickname of the user.
interchangeUrl | URL | The URL of the user's interchange server.
pubkey         | String | The user's public key, in RSA PEM format.
about          | String | Details about the user.  Max 4096 characters.  Probably a string in JSON format.
updatedAt      | Timestamp (ms) | The user-provided timestamp of the most recent update.
hubCreatedAt   | Timestamp (ms) | The timestamp when this profile was first received by the Hub.
hubSyncedAt    | Timestamp (ms) | The timestamp that the profile was most recently received by the Hub.
sig            | String | The Base64 encoded signature (see [Authentication](Protocol.md/#2Authentication-and-encryption)).
hubSig         | String | The Base64 encoded signature from the Hub (see [Authentication](Protocol.md/#2Authentication-and-encryption)).

#### `sig` fields

- about
- interchangeUrl
- nick
- pubkey
- updatedAt

**NOTE** When the user's `pubkey` has changed, the `UserProfile.sig` field
notifying others of the change MUST be signed with the user's **previous**
private key.

#### `hubSig` fields

(Note that this order is not alphabetical, but is instead the list of `sig`
fields with the list of Hub-specific fields appended.)

- about
- interchangeUrl
- nick
- pubkey
- updatedAt
- hubCreatedAt
- hubSyncedAt
- sig


2. Endpoints
===============

Retrieve a user's profile
----------------------------

    GET /profiles/<nickname>

#### Query parameters

Name | Type | Details
:----|:-----|:-------
[updatedBefore] | Timestamp (ms) | If given, then return the version of the user's profile with the largest `updatedAt` timestamp that is less than this value.

#### Returns

A JSON object:

Name | Type | Details
:----|:-----|:-------
userProfile | UserProfile | The UserProfile stanza.


Create or update a user's profile
------------------------------------

    POST /profiles/<nickname>

#### Post body contents

A JSON object:

Name | Type | Details
:----|:-----|:-------
interchangeUrl | URL | The URL of the user's interchange server.
about          | String | An arbitrary "about" string, probably JSON encoded.  Max 2048 characters.
pubkey         | String | The user's public key in RSA PEM format.
updatedAt      | Timestamp (ms) | A client-specified timestamp
sig            | String | The Base64 encoded signature (see [Authentication](#2Authentication-and-encryption)).

**NOTE**: When the profile already exists, then the `sig` field must be signed
with the private key corresponding to the previously-registered public key.
When the profile does not exist yet, then the `sig` field must be signed with
the private key corresponding to the given `pubkey`.

#### Returns

A JSON object:

Name | Type | Details
:----|:-----|:-------
userProfile | UserProfile | The UserProfile stanza.  This will have the `hubSig` and other hub fields set.

