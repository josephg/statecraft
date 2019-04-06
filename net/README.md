# Statecraft networking

The goal of this module is to allow clients to transparently use remote statecraft stores as if they were local.

There are currently two transports available:

- TCP (generally for node <-> node communication)
- WebSockets (for node <-> browser communication)

(I'd also like to add an ICP based comms layer implementation here for multi-language support).

With each transport one computer must act as the network server, and one must act as the client. But that decision is orthogonal to which of the two machines exposes a statecraft store to its remote.

You can have:

- Network server exposes a store which each client consumes. This is the most common architecture and currently the most tested & supported.
- Each network client exposes a store. The server consumes all the client stores (TODO: Document how to do this)
- The server and each client create and expose a store. This is useful for example to have clients expose some local state back to a governing SC server. This architecture works but is currently lacking an easy way to automatically reconnect. See the bidirectional example on how to implement this.

