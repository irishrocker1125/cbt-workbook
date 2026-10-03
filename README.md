# CBT Workbook

A self-reflection workbook for cognitive-behavioral exercises: thought records and behavioral experiments, with guided questions, a searchable journal, and trend charts.

**Open it:** https://irishrocker1125.github.io/cbt-workbook/

It is a self-reflection tool, not therapy or a substitute for professional care. If you're in crisis, call or text 988 (US).

## Your data stays in your browser

- Entries are saved in this browser's local storage (IndexedDB) on this device. Nothing is sent to a server.
- Each address has its own storage. The hosted site and a downloaded copy opened from disk keep separate journals. Use **Import / Export → Export JSON backup** in one and **Import** in the other to move entries.
- Browsers can clear storage without warning, so export a JSON backup regularly.

## Run it offline

`index.html` is a single file with no dependencies. Download it and open it in a desktop browser.

## Development

Open `index.html#selftest` to run the built-in checks: data format, import/export round-trips, CSV, prompt rules, UI flows, safety copy, accessibility, and the 150 KB size budget. The harness lives in `selftest.js` and is loaded only on that URL.
