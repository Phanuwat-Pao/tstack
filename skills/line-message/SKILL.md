---
name: line-message
description: Trigger this if the user says 'line message'.
---

# LINE message

The user wants one Thai message they can copy and paste into LINE. Write it
and reply with that message and nothing more.

## What goes in it

- Text after "line message" is the topic or the reader, for example
  "line message to the Cryoviva team about tonight's maintenance". Follow it.
- With no text after it, turn the latest result in this thread into a message
  for the people affected: what changed, what they need to do, and when.
- Write for the reader, not for an engineer reading the logs. Leave out file
  paths, PIDs, commit hashes, Vault paths and internal tool names unless the
  reader needs them to act. Keep host names, URLs, times and the exact values
  they have to type in.
- Include a password, key or token only when the user's request names it.
- Times are Bangkok time, written like `21:00 น.` with a Thai date such as
  `26 พ.ย. 2569`.

## How it is written

- Thai, polite and plain. Polite particle: ครับ. Keep English for product
  names, commands and values the reader types.
- LINE shows plain text. No Markdown: no `**`, `#`, tables or links in
  brackets. Use line breaks, `1.` `2.` for steps and `•` for lists. Paste URLs
  bare so LINE makes them tappable.
- Short lines. A blank line between parts. No emoji unless the user asks.
- Exactly one message. Never split it into parts, and never add "ส่วนที่ 1".

## Length

LINE counts UTF-16 code units. Thai letters, vowels and tone marks count one
each; most emoji count two. The app allows 10,000 per message and the
Messaging API allows 5,000. Stay at 5,000 or under so the text also fits a
bot or Official Account message.

1. Write the message to `~/.cache/line-message/<timestamp>.txt`.
2. Run `node <this skill's directory>/scripts/count.mjs <file>` (use its
   absolute path). It prints `<count> / 5000`.
3. If it exits non-zero, tighten the wording and count again. Cut repetition
   and background first. Keep every fact the reader must act on. Only if it
   still does not fit, tell the user in one line what you left out.

## Reply format

Reply with the message in one `text` code block so the copy button takes all
of it, then one line with the count:

    ```text
    <the message>
    ```
    1,234 / 5,000

No heading, no preamble, no explanation after the count.
