# Security policy

## Supported version

Security fixes are applied to the latest release on `main`.

## Reporting a vulnerability

Please use GitHub's private **Report a vulnerability** flow for this repository. Do not include OAuth tokens, private email content, local database files, or other personal data in a public issue.

## Local security model

Control Center is designed for one trusted operator and has no account login. By default
it binds to loopback and rejects foreign API Host/Origin headers.

`CONTROL_CENTER_HOST` allows binding to one non-loopback address, and
`CONTROL_CENTER_ALLOWED_HOSTS` names the additional hostnames the API answers on. These
exist for a private network the operator controls — a tailnet, typically. Understand what
each one does: the bind address is the access boundary, because only traffic that can
reach that address reaches the app. The host allowlist defends against DNS rebinding,
where a page you visit points a hostname at the app's address; the browser then sends the
attacker's hostname in `Host` and the request is refused. It is not a defence against a
direct request from a host already on the network, which can set any `Host` header. For
that reason binding to `0.0.0.0` or `::` is refused unless
`CONTROL_CENTER_ALLOW_ANY_INTERFACE=1` asserts that something in front is doing the
access control.

Every device that can reach the bound address can read the entire dashboard, including
stored newsletter content and the editorial trail. Do not expose it to a LAN you do not
control, or to the public internet, without an authenticated reverse proxy and a separate
security review.

OAuth credentials, optional audience-provider tokens, and optional AI provider keys are stored in the local data directory and are not encrypted at rest. They are written owner-readable on POSIX systems and are never returned by the public Settings response. Protect the operating-system account and treat full backups as secret-bearing files.

Only the AI provider explicitly selected in Settings can be called. Environment variables remain inert until the matching provider is selected. Cloud API origins are fixed; a local endpoint never receives a cloud provider's credentials. Industry prompts contain configured niche text and bounded public discovery metadata; cloud Mention discovery prompts contain configured public identity signals. Mention curation uses independently verified, bounded page excerpts. Daily Brief, task, reminder, and private connector content is not sent to these jobs.

Newsletter intelligence requires a configured cloud or local AI model. Matching Gmail issue text is read with the user-authorized read-only scope and sent only to the selected provider for story extraction and deduplication. Email addresses are masked and subscriber-specific source URLs are replaced with internal link references before the model request; model-returned references must match an observed email link. Raw bodies are not written to SQLite. The local database stores issue metadata, a body hash, extracted story summaries/source links, priority scores, and deduplicated topic state. Public tracking redirects are resolved with the same DNS validation and address pinning used by Industry sources.

LM Studio and Ollama endpoints must be numeric loopback URLs, with `localhost` normalized to loopback, and cannot redirect. Only loaded text-generation models are offered; recognizable remote/cloud aliases are excluded. The app never downloads or loads a model. A loopback destination does not prove the separate runtime processes data locally: disable LM Link or other remote forwarding if computer-only processing is required. Control Center cannot audit another runtime's internal routing. Optional local-server tokens are separate from cloud API keys; `OLLAMA_API_KEY` is never treated as a local token.

User-configured Industry sources are limited to public HTTP and HTTPS addresses. DNS answers are validated and the request is pinned to the validated public address; redirects repeat the same validation. Private, loopback, local-link, and reserved network destinations are rejected. These controls are defense in depth for a local application, not authorization to expose the dashboard as a public URL-fetching service.
