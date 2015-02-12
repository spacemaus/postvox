Postvox Hub Protocol
=======================

*STATUS: Draft/Proof-of-concept*
*VERSION: 0.0.1*

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

> TODO: Spec out name recovery, private data.
>
> Some ideas:
> - private email/info field.
> - trusted signers.  A private mapping of { trustedNick: trustVal }.  A profile
>   update will be accepted iff it has been signed by enough trusted signers so
>   that the sum of trustVal >= 100.  Trusted signers cannot be removed unless
>   the removal request is signed by the account owner AND the trustedNick (to
>   prevent stolen keys from locking out an account).

> TODO: Spec out delegated authority.
> - Public mapping of { delegatedNick: [permission, ...] }
> - Alt: { permission: [delegatedPubkey, ...] }


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
A user's profile is stored as a [UserProfile stanza](Protocol.md#userprofile-stanza).


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

