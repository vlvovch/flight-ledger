/*
 * mbox → raw emails, for bulk import (design: onboarding).
 *
 * Gmail can't bulk-download .eml, but Google Takeout exports a label as one
 * mbox file — so "label your United mail, Takeout the label, drop the file"
 * becomes the whole onboarding story. An mbox is just messages concatenated
 * behind "From ..." separator lines, with body lines that begin with "From "
 * escaped by prefixing ">" (and ">From" escalating to ">>From", the mboxrd
 * convention). This splitter undoes exactly that and nothing more; each
 * piece feeds the same parseEml → twenty-three-format pipeline as a dropped
 * .eml file.
 */

/** How many messages one import may carry.
 *
 * ONE constant, imported by the modal and by the route: they disagreed once
 * (the modal accepted 5,000, the server refused above 1,000) and the user
 * met a rejection the interface had just promised would work. */
export const MAX_BATCH_MESSAGES = 5000;

export function splitMbox(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const messages: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    /* The separator is an envelope line, not a header: "From " followed by a
       sender and date, at line start, outside any message body (bodies have
       theirs escaped). Requiring the space-delimited shape keeps a stray
       unescaped body line from splitting a message in half. */
    if (/^From \S+ .+$/.test(line)) {
      current = [];
      messages.push(current);
      continue;
    }
    if (current == null) continue; // preamble before the first separator
    // mboxrd unescape: ">From " → "From ", ">>From " → ">From ", …
    current.push(line.replace(/^(>+)(From )/, (_, gt, from) => gt.slice(1) + from));
  }
  return messages
    .map((m) => m.join("\n").trim())
    .filter((m) => m.length > 0);
}
