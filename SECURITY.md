# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.0.x | Yes |

## Reporting a vulnerability

If you find a security vulnerability, please **do not** open a public issue.

Instead, report it privately via [GitHub Security Advisories](https://github.com/draenger/whisperio/security/advisories/new).

I use Whisperio daily for my own work, so I care about keeping it solid. I'll do my best to review reports and fix things, but this is a side project maintained in spare time. If I don't respond within 48 hours — sorry, I might just be unavailable. No SLA, no support contracts.

## Scope

Whisperio handles API keys and audio data. Security issues we care about:

- API key exposure (storage, transmission, logging)
- Arbitrary code execution
- Unauthorized access to microphone or system audio
- Insecure IPC between main and renderer processes

## Disclaimer

This software is provided as-is under the MIT license. Use at your own risk. We don't guarantee timely fixes, ongoing maintenance, or support for every platform or configuration.
