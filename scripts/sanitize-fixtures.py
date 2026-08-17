#!/usr/bin/env python3
"""Fixture sanitizer and PII scanner for fixtures/anonymized/*.eml.

Raw grep is the wrong tool for email: base64 attachments, quoted-printable
soft breaks that split words mid-name (evanpurk=\nhiser), and =3D escapes
inside URL params all hide content from it while looking clean. Everything
here therefore works on DECODED MIME part content and re-encodes in the
part's original transfer encoding. Python stdlib only.

  python3 scripts/sanitize-fixtures.py --scan
      Report anything that looks personal: addresses on personal mail
      domains, real (non-stub) PDF attachments, private IPs, and
      high-entropy runs (>=40 chars, Shannon >=4.2) that no benign-asset
      pattern explains. Exit 1 on findings — suitable for CI.

  python3 scripts/sanitize-fixtures.py [--replace FROM=TO ...]
      Scrub: replace real PDF/ICS attachments with synthetic stubs, redact
      any URL query carrying a high-entropy parameter, zlib deeplink
      payloads (/c/eJx…), ESP per-message tags, personal-Gmail message-ids
      and private IPs — plus any FROM=TO pairs given (use these for names
      and addresses --scan surfaced; case variants are NOT inferred).

Intake rule: every fixture cut from a real mailbox goes through --scan
before it is committed, and again after any scrub. What --scan cannot know
is a human name spelled in prose — read the decoded body once yourself.
"""
import argparse, base64, email, math, os, quopri, re, sys
from collections import Counter

ROOT = os.path.join(os.path.dirname(__file__), "..", "fixtures", "anonymized")

STUB_PDF = (
    b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\n"
    b"trailer<</Root 1 0 R>>\n%%EOF\n"
)
STUB_ICS = (
    "BEGIN:VCALENDAR\r\nPRODID:-//fixture//synthetic//EN\r\nVERSION:2.0\r\n"
    "BEGIN:VEVENT\r\nUID:fixture-{n}@example.com\r\nDTSTAMP:20260101T000000Z\r\n"
    "SUMMARY:Flight (XX0000)\r\nDTSTART:20260101T000000Z\r\nDTEND:20260101T010000Z\r\n"
    "ATTENDEE:mailto:bob.test@example.com\r\nSTATUS:CONFIRMED\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
)

PERSONAL_DOMAINS = r"(?:gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|proton|protonmail|gmx|web)\.(?:com|de|net)"
URL_RX = re.compile(r"(https?://[^\s\"'<>()\\]+?)\?([^\s\"'<>()\\]+)")
SCRUB_RXS = [
    (re.compile(r"/eJ[wx][A-Za-z0-9%+/=_\-]{12,}"), "/REDACTED"),  # zlib deeplinks
    (re.compile(r"02000000[0-9a-z]{8}-[0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12}-000000"),
     "0200000000000000-00000000-0000-0000-0000-000000000000-000000"),  # SES tags
    (re.compile(r"(?<=-000000/)[A-Za-z0-9_\-]{8,}"), "REDACTED"),  # SES link signatures
    (re.compile(r"m_-?\d{10,}"), "m_0"),  # Gmail per-message class prefix
    (re.compile(r"<[^<>@\s]+@mail\.gmail\.com>"), "<fixture@example.com>"),
    (re.compile(r"\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b"), "192.0.2.1"),
    (re.compile(r"\b192\.168\.\d{1,3}\.\d{1,3}\b"), "192.0.2.1"),
]
BENIGN_RUN = re.compile(
    r"(assets/m/|assets/images|/lib/fe|blt[0-9a-f]|xhtml1|TMPL|_mkt_|pmweb/"
    r"|responsysimages|/wpm/|orbit|%%|REDACTED|example\.com|\.png|\.gif|\.jpg"
    r"|Dreamliner|banner|initialize-session|/itinerary/)",
    re.I,
)


def entropy(s: str) -> float:
    c = Counter(s)
    n = len(s)
    return -sum(v / n * math.log2(v / n) for v in c.values())


def parts(msg):
    """(part, content_type, cte, decoded_text_or_None, raw_payload)"""
    for part in msg.walk():
        ct = part.get_content_type()
        cte = part.get("Content-Transfer-Encoding", "").lower()
        payload = part.get_payload()
        if not isinstance(payload, str) or not payload.strip():
            continue
        decoded = None
        if ct.startswith("text/") or "calendar" in ct or ct == "application/ics":
            try:
                if cte == "base64":
                    decoded = base64.b64decode("".join(payload.split())).decode("utf-8", "replace")
                elif cte == "quoted-printable":
                    decoded = quopri.decodestring(payload.encode("utf-8", "surrogateescape")).decode("utf-8", "replace")
                else:
                    decoded = payload
            except Exception:
                decoded = None
        yield part, ct, cte, decoded, payload


def reencode(text: str, cte: str) -> str:
    if cte == "base64":
        b = base64.b64encode(text.encode()).decode()
        return "\r\n".join(b[i : i + 76] for i in range(0, len(b), 76)) + "\r\n"
    if cte == "quoted-printable":
        return quopri.encodestring(text.encode()).decode()
    return text


def scan() -> int:
    findings = 0
    for f in sorted(os.listdir(ROOT)):
        if not f.endswith(".eml"):
            continue
        msg = email.message_from_file(open(os.path.join(ROOT, f), encoding="utf-8", errors="surrogateescape"))
        rows = []
        header_blob = str(msg.items())
        for part, ct, _cte, decoded, payload in parts(msg):
            if ct == "application/pdf" and len("".join(payload.split())) > 1500:
                rows.append("real PDF attachment (replace with stub)")
            if decoded is None:
                continue
            blob = decoded + header_blob
            for m in sorted(set(re.findall(rf"[A-Za-z0-9._%+-]+@{PERSONAL_DOMAINS}", blob, re.I))):
                if "example" not in m and "fixture" not in m:
                    rows.append(f"personal address: {m}")
            for ip in sorted(set(re.findall(r"\b(?:10|192\.168)\.\d{1,3}\.\d{1,3}(?:\.\d{1,3})?\b", blob))):
                if ip.count(".") == 3:
                    rows.append(f"private IP: {ip}")
            for run in sorted(set(re.findall(r"[A-Za-z0-9%+/=_\-]{40,}", decoded))):
                if entropy(run) >= 4.2 and re.search(r"\d", run) and re.search(r"[A-Za-z]", run) and not BENIGN_RUN.search(run):
                    rows.append(f"high-entropy run: {run[:60]}…")
        for r in sorted(set(rows)):
            print(f"{f} → {r}")
            findings += 1
    print(f"\n{findings} finding(s)" if findings else "clean")
    return 1 if findings else 0


def scrub(pairs) -> None:
    def scrub_text(text: str) -> str:
        def url_repl(m):
            base, query = m.group(1), m.group(2)
            for p in re.split(r"&(?:amp;)?", query):
                v = p.split("=", 1)[1] if "=" in p else p
                if len(v) >= 24:
                    return base + "?REDACTED"
            return m.group(0)

        out = URL_RX.sub(url_repl, text)
        for rx, r in SCRUB_RXS:
            out = rx.sub(r, out)
        for a, b in pairs:
            out = out.replace(a, b)
        return out

    for f in sorted(os.listdir(ROOT)):
        if not f.endswith(".eml"):
            continue
        path = os.path.join(ROOT, f)
        raw = open(path, encoding="utf-8", errors="surrogateescape").read()
        msg = email.message_from_string(raw)
        out = raw
        ics_n = 0
        for part, ct, cte, decoded, payload in parts(msg):
            if ct == "application/pdf" and len("".join(payload.split())) > 1500:
                b = base64.b64encode(STUB_PDF).decode()
                assert payload in out
                out = out.replace(payload, "\n".join(b[i : i + 76] for i in range(0, len(b), 76)) + "\n")
                continue
            if (ct == "application/ics" or "calendar" in ct) and len("".join(payload.split())) > 400:
                ics_n += 1
                b = base64.b64encode(STUB_ICS.format(n=ics_n).encode()).decode()
                assert payload in out
                out = out.replace(payload, "\n".join(b[i : i + 76] for i in range(0, len(b), 76)) + "\n")
                continue
            if decoded is None:
                continue
            s = scrub_text(decoded)
            if s == decoded:
                continue
            assert payload in out, f"payload not verbatim in {f}"
            out = out.replace(payload, reencode(s, cte))
        for a, b in pairs:  # headers are plain ASCII
            out = out.replace(a, b)
        if out != raw:
            open(path, "w", encoding="utf-8", errors="surrogateescape").write(out)
            print(f"scrubbed {f}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--scan", action="store_true")
    ap.add_argument("--replace", action="append", default=[], metavar="FROM=TO")
    args = ap.parse_args()
    if args.scan:
        sys.exit(scan())
    scrub([r.split("=", 1) for r in args.replace])
