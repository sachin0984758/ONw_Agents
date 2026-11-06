# Optional Socket.IO example

`frontend.tsx` and `server.ts` are a paired integration example, not an App Router
page or a background service started by AgentHub. The frontend expects the
optional Caddy `XTransformPort` proxy. Its Socket.IO dependencies and independent
service setup are not installed by the local web-app workflow. Kept as unique
example code; this path is not included in verified application behavior.
