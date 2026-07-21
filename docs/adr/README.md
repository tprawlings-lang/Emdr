# Architecture Decision Records

Short records of the decisions that shape Steady. Each is immutable once
accepted; supersede rather than edit.

| # | Decision | Status |
|---|---|---|
| [0001](0001-wellness-lane-posture.md) | Launch in the wellness lane, not the medical/HIPAA lane | Accepted |
| [0002](0002-app-layer-field-encryption.md) | App-layer AES-256-GCM field encryption + fail-fast secrets | Accepted |
| [0003](0003-security-headers-and-csp.md) | Security headers & CSP (`'unsafe-inline'` now, nonce later) | Accepted |
| [0004](0004-single-instance-architecture.md) | Single-instance runtime; in-process scheduler & rate limiter | Accepted |
| [0005](0005-tamper-evident-audit-chain.md) | Tamper-evident audit log via hash chain | Accepted |
| [0006](0006-stateless-hmac-sessions.md) | Stateless HMAC sessions; revocation via account status | Accepted |
