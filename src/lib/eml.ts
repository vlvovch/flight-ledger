/**
 * Minimal RFC-822/MIME email (.eml) decoder — dependency-free, covering the
 * practical subset airline emails use: multipart/alternative|mixed|related,
 * quoted-printable and base64 transfer encodings, RFC 2047 encoded-word
 * headers, utf-8/latin1/windows-1252 charsets. Attachments are surfaced as
 * metadata only (design doc §10.3: sources stay inspectable; parsing happens
 * on the decoded text/HTML bodies).
 */

export interface ParsedEml {
  subject: string | null;
  from: string | null;
  to: string | null;
  /** Date: header as received (raw string; receipts carry their own dates) */
  date: string | null;
  headers: Record<string, string>;
  /** decoded text/plain body (first found, depth-first) */
  text: string | null;
  /** decoded text/html body (first found, depth-first) */
  html: string | null;
  attachments: { filename: string; contentType: string; size: number }[];
}

/* ------------------------------ decoding ------------------------------- */

function decodeCharset(buf: Buffer, charset: string | null): string {
  const cs = (charset ?? "utf-8").toLowerCase().replace(/["']/g, "");
  try {
    return new TextDecoder(cs).decode(buf);
  } catch {
    return buf.toString("latin1");
  }
}

function decodeQuotedPrintable(input: string): Buffer {
  const cleaned = input.replace(/=\r?\n/g, ""); // soft line breaks
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(cleaned.slice(i + 1, i + 3))) {
      bytes.push(parseInt(cleaned.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(c.charCodeAt(0) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function decodeBody(
  body: string,
  transferEncoding: string | null,
  charset: string | null
): string {
  const enc = (transferEncoding ?? "").toLowerCase().trim();
  if (enc === "base64") {
    return decodeCharset(Buffer.from(body.replace(/\s+/g, ""), "base64"), charset);
  }
  if (enc === "quoted-printable") {
    return decodeCharset(decodeQuotedPrintable(body), charset);
  }
  return body;
}

/** RFC 2047: =?charset?B|Q?data?= */
function decodeEncodedWords(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
    (_m, charset: string, kind: string, data: string) => {
      if (kind.toLowerCase() === "b") {
        return decodeCharset(Buffer.from(data, "base64"), charset);
      }
      // Q encoding: underscore is space
      return decodeCharset(
        decodeQuotedPrintable(data.replace(/_/g, " ")),
        charset
      );
    }
  );
}

/* ------------------------------- headers ------------------------------- */

function splitHeadersBody(raw: string): { headerBlock: string; body: string } {
  const m = raw.match(/\r?\n\r?\n/);
  if (!m || m.index == null) return { headerBlock: raw, body: "" };
  return {
    headerBlock: raw.slice(0, m.index),
    body: raw.slice(m.index + m[0].length),
  };
}

function parseHeaders(headerBlock: string): Record<string, string> {
  const headers: Record<string, string> = {};
  // unfold continuation lines first
  const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    // first occurrence wins (Received: etc. repeat; we don't need them)
    if (!(key in headers)) headers[key] = decodeEncodedWords(value);
  }
  return headers;
}

function headerParam(headerValue: string | undefined, param: string): string | null {
  if (!headerValue) return null;
  const re = new RegExp(`${param}\\s*=\\s*("[^"]*"|[^;\\s]+)`, "i");
  const m = headerValue.match(re);
  return m ? m[1].replace(/^"|"$/g, "") : null;
}

/* -------------------------------- parts -------------------------------- */

interface Part {
  headers: Record<string, string>;
  body: string;
}

function splitMultipart(body: string, boundary: string): Part[] {
  const parts: Part[] = [];
  const chunks = body.split(new RegExp(`(?:^|\\r?\\n)--${escapeRe(boundary)}(?:--)?[ \\t]*(?:\\r?\\n|$)`));
  // first chunk is the preamble, last (after closing boundary) the epilogue
  for (const chunk of chunks.slice(1)) {
    if (chunk.trim() === "") continue;
    const { headerBlock, body: partBody } = splitHeadersBody(chunk);
    parts.push({ headers: parseHeaders(headerBlock), body: partBody });
  }
  return parts;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function walkPart(
  part: Part,
  out: { text: string | null; html: string | null; attachments: ParsedEml["attachments"] }
): void {
  const ctype = part.headers["content-type"] ?? "text/plain";
  const mime = ctype.split(";")[0].trim().toLowerCase();
  const disposition = part.headers["content-disposition"] ?? "";
  const filename =
    headerParam(disposition, "filename") ?? headerParam(ctype, "name");

  if (mime.startsWith("multipart/")) {
    const boundary = headerParam(ctype, "boundary");
    if (!boundary) return;
    for (const child of splitMultipart(part.body, boundary)) {
      walkPart(child, out);
    }
    return;
  }

  if (filename || /attachment/i.test(disposition)) {
    out.attachments.push({
      filename: filename ?? "(unnamed)",
      contentType: mime,
      size: part.body.length,
    });
    return;
  }

  if (mime === "text/plain" || mime === "text/html") {
    const decoded = decodeBody(
      part.body,
      part.headers["content-transfer-encoding"] ?? null,
      headerParam(ctype, "charset")
    );
    if (mime === "text/plain" && out.text == null) out.text = decoded;
    if (mime === "text/html" && out.html == null) out.html = decoded;
  }
}

/* -------------------------------- main --------------------------------- */

export function parseEml(raw: string): ParsedEml {
  const { headerBlock, body } = splitHeadersBody(raw.replace(/^﻿/, ""));
  const headers = parseHeaders(headerBlock);
  const out: Pick<ParsedEml, "text" | "html" | "attachments"> = {
    text: null,
    html: null,
    attachments: [],
  };
  walkPart({ headers, body }, out);
  return {
    subject: headers["subject"] ?? null,
    from: headers["from"] ?? null,
    to: headers["to"] ?? null,
    date: headers["date"] ?? null,
    headers,
    ...out,
  };
}

/* ----------------------------- html → text ----------------------------- */

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", hellip: "…", bull: "•", middot: "·",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** Very small HTML→text: drops style/script, breaks lines on block elements,
 *  collapses whitespace. Good enough to run value-extraction regexes over. */
export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(style|script|head)[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section|header|footer)\s*>/gi, "\n")
    .replace(/<td[^>]*>/gi, " \t")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  return s
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line, i, arr) => line !== "" || arr[i - 1] !== "")
    .join("\n")
    .trim();
}
