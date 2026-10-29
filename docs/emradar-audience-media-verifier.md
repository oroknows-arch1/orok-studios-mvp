# Verified owner-review graphic bytes

This isolated component validates a graphic against an allowlisted HTTPS origin and the SHA-256 of the bytes returned by an injected trusted media loader. It refuses untrusted URLs, missing bytes, oversized files and mismatched digests.

The loader must obtain immutable bytes from a trusted archive or storage layer and must not follow redirects to untrusted hosts. An ordinary network fetch without redirect and content controls is **not** a trusted loader. This module does not itself fetch or render media.

Before production use, integrate this verification into the visual review approval eligibility and confirm that the bytes uploaded to X are exactly those verified. The visual review currently only checks metadata shape; do not treat its `ready_for_authenticated_approval` flag as a complete media verification. No production integration or live publishing.
