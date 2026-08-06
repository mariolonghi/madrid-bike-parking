# Security Policy

Found a security problem? Please report it **privately** — don't open a public issue.

👉 **[Report a vulnerability](https://github.com/mariolonghi/madrid-bike-parking/security/advisories/new)** — this goes straight to me and stays private.

No GitHub account? Email **madrid-bike-parking@mariolonghi.com** instead.

I'll get back to you within **a few days**, and fix anything real as fast as I can. Thanks for helping keep this safe.

---

## More details

### What to include
- What the problem is, and where (a URL, a file, or a line of code).
- How to reproduce it, step by step.
- What someone could actually do with it (the impact).
- A proof of concept, if you have one.

### What's in scope
This is a small, **static** web map — no backend, no accounts, no user data. It reads public open data directly in the browser. Reports about **this repository's code** are welcome, for example:
- How the Google Maps API key is handled (each visitor supplies their own key, kept only in their browser).
- Anything that could run unintended code in the page (XSS), leak a visitor's data, or tamper with what's displayed.

### What's out of scope
Please report these to whoever owns them, not here:
- The third-party services the map relies on — `datos.madrid.es`, OpenStreetMap, Google Maps, BiciMAD / GBFS, and Cloudflare (the host).
- Missing "best-practice" HTTP headers, raw scanner output, or issues that only work if a visitor disables their own browser protections — unless you can show real impact.

### Please report in good faith
- Don't run tests that harm visitors, degrade the site, or hammer the upstream data services.
- Only touch data that's already public; don't access anything that isn't yours.
- Give me a reasonable chance to fix it before you share it publicly.

Report in good faith along these lines and I won't pursue anything against you for it.

### No bug bounty
This is a personal, non-commercial project, so there's no payment — but I'm glad to credit you when a fix ships, if you'd like.
