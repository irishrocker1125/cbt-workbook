// CBT Workbook self-test harness (development only).
// Loaded by index.html when opened as index.html#selftest; shares its globals.
// Keep this file next to index.html. The app itself never loads it.
"use strict";

/* =========================================================
 * SELF-TEST HARNESS  (open the file with #selftest)
 * Covers M1 round-trip + UI flows, M3 migration, M4 rules/safety/a11y, and the §9 spike timings.
 * Uses its own in-memory journal and a temporary IndexedDB database; never touches yours.
 * ========================================================= */
function fixtureDoc() {
  const t = (d, h) => `2026-09-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:15:00-04:00`;
  return {
    format: "cbt-workbook", formatVersion: 1, appVersion: "1.0.1", exportedAt: t(28, 16),
    entries: [
      // v1.0.1 shape: no underlyingBelief (additive default fills it).
      { id: "01J8Z3Q6T9M4K2R7V5X1B0C8DE", exercise: "thought-record", status: "complete", createdAt: t(28, 15), updatedAt: t(28, 15),
        situation: "Boss hasn't replied to my email in 5 hours.", emotions: [{ name: "anxiety", before: 80, after: 45 }, { name: "frustration", before: 40, after: 40 }, { name: "shame", before: 0, after: 10, "x-note": "kept" }],
        automaticThought: { text: "He thinks my work is \"terrible\".", beliefBefore: 85, beliefAfter: 40 },
        behavior: { urge: "Re-send the email", action: "Checked inbox repeatedly" }, thinkingPatterns: ["mind-reading", "catastrophizing"],
        evidenceFor: "No reply yet.", evidenceAgainst: "Back-to-back meetings,\nand he praised the project yesterday.",
        alternativePerspective: "He's busy; silence isn't a verdict.", nextAction: "Follow up tomorrow at 9.", "x-future-field": { kept: true } },
      { id: "01J8Y0000000000000000000AB", exercise: "thought-record", status: "partial", createdAt: t(27, 9), updatedAt: t(27, 10),
        situation: "Café meeting — naïve question 🙂", emotions: [{ name: "embarrassment", before: 60, after: null }],
        automaticThought: { text: "Everyone noticed.", beliefBefore: 70, beliefAfter: null },
        behavior: { urge: null, action: null }, thinkingPatterns: [], evidenceFor: null, evidenceAgainst: null, alternativePerspective: null, nextAction: null, underlyingBelief: "I'm not good enough." },
      { id: "01J8Z9000000000000000000EF", exercise: "behavioral-experiment", status: "complete", createdAt: t(29, 8), updatedAt: t(30, 18),
        linkedEntryId: "01J8Z3Q6T9M4K2R7V5X1B0C8DE", belief: { text: "If I ask for feedback, he'll say it's bad.", ratingBefore: 75, ratingAfter: 30 },
        prediction: "He'll list problems, \"frowning\".", plan: "Ask in Tuesday's 1:1.", plannedFor: "2026-09-30", safetyBehaviors: "Over-preparing a defence",
        alternativeBelief: { text: "He'll give mixed, mostly useful feedback.", ratingBefore: 30, ratingAfter: 70 },
        outcome: "He said two things were great,\none could be tighter.", learning: "Silence wasn't criticism.", nextStep: null }
    ]
  };
}

const ST = [];
const test = (name, fn) => ST.push({ name, fn });
class Skip extends Error {}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const memJournal = () => createJournal(createMemoryBackend());
const docText = (doc) => JSON.stringify(doc, null, 2);
const expectedCanonical = (entries) => entries.map(e => canonicalOrder(withAdditiveDefaults(e))).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

async function withTempIdb(fn) {
  const name = `cbtworkbook-selftest-${Date.now()}`;
  let db;
  try { db = await openIdb(name); } catch (err) { throw new Skip(`IndexedDB unavailable: ${err.message}`); }
  const backend = createIdbBackend(db);
  try { return await fn(createJournal(backend)); }
  finally { backend.close(); await new Promise(r => { const q = indexedDB.deleteDatabase(name); q.onsuccess = q.onerror = q.onblocked = () => r(); }); }
}
// Runs a UI flow against a throwaway in-memory journal, then restores everything.
async function withMemUI(fn) {
  const saved = { journal, screen: state.screen, quick: state.quick };
  journal = memJournal();
  try { return await fn(); }
  finally { clearTimeout(autosaveTimer); clearTimeout(quickTimer); journal = saved.journal; state.draft = null; state.quick = saved.quick; state.screen = saved.screen; }
}
const typeInto = (id, v) => { const n = $(id); assert(n, `missing control #${id}`); n.value = v; n.dispatchEvent(new Event("input", { bubbles: true })); };

function parseCSV(text) { // RFC 4180 reader for verification
  const rows = []; let row = [], field = "", i = 0, inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; } field += c; i++; continue; }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r" && text[i + 1] === "\n") { row.push(field); rows.push(row); row = []; field = ""; i += 2; continue; }
    if (c === "\n") throw new Error("bare LF outside quotes");
    field += c; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ---- Identity and time
test("ULID: format, uniqueness, time order", async () => {
  const ids = new Set(Array.from({ length: 2000 }, () => generateULID()));
  assert(ids.size === 2000, "duplicate ULIDs");
  ids.forEach(id => assert(ULID_RE.test(id), `bad ULID ${id}`));
  const a = generateULID(1700000000000), b = generateULID(1700000000001);
  assert(a.slice(0, 10) < b.slice(0, 10), "time prefix does not sort by time");
});
test("RFC 3339 timestamps keep the local offset", async () => {
  const s = nowRFC3339();
  assert(RFC3339_RE.test(s), `bad timestamp ${s}`);
  assert(Math.abs(Date.parse(s) - Date.now()) < 2000, "timestamp does not match the clock");
  assert(!s.endsWith("Z") || new Date().getTimezoneOffset() === 0, "offset lost");
});
test("Export filename uses the local date", async () => {
  eq(localDateStamp(new Date(2026, 8, 28, 23, 30)), "2026-09-28", "local date");
});

// ---- Canonical format
test("Unanswered values are null, never 0 or \"\" (spec §2, §3)", async () => {
  const n = normalizeEntry({ ...createBlankEntry(), situation: "  ", evidenceFor: "", emotions: [{ name: "fear", before: null, after: undefined }] });
  eq(n.situation, null, "blank situation"); eq(n.evidenceFor, null, "empty evidenceFor");
  eq(n.emotions[0].after, null, "unrated after"); eq(n.automaticThought.beliefBefore, null, "unrated belief");
  eq(Object.keys(n), TR_KEYS, "every thought-record field present in order");
  const x = normalizeEntry({ ...createBlankExperiment(), plan: " ", plannedFor: "", belief: { text: "b" } });
  eq([x.plan, x.plannedFor, x.belief.ratingBefore, x.belief.ratingAfter], [null, null, null, null], "experiment blanks");
  eq(Object.keys(x), BE_KEYS, "every experiment field present in order");
});
test("journal.save stamps updatedAt; import preserves it", async () => {
  const j = memJournal();
  const e = { ...fixtureDoc().entries[1] };
  await j.importAll([e]);
  eq((await j.load(e.id)).updatedAt, e.updatedAt, "import changed updatedAt");
  const saved = await j.save({ ...e, nextAction: "x" });
  assert(saved.updatedAt !== e.updatedAt, "save did not stamp updatedAt");
});
test("Fixture entries pass validation", async () => {
  fixtureDoc().entries.forEach(e => eq(validateEntry(withAdditiveDefaults(e)), [], `entry ${e.id}`));
});
test("Validation rejects malformed entries with field-level errors", async () => {
  const [base, , be] = fixtureDoc().entries.map(withAdditiveDefaults);
  const without = (o, k) => { const x = { ...o }; delete x[k]; return x; };
  const cases = [
    ["id", { ...base, id: "not-a-ulid" }],
    ["emotions[0].before", { ...base, emotions: [{ name: "anxiety", before: 101, after: null }] }],
    ["emotions[0].before", { ...base, emotions: [{ name: "anxiety", before: 12.5, after: null }] }],
    ["emotions[1].name", { ...base, emotions: [{ name: "Anxiety", before: 1, after: null }, { name: "anxiety", before: 2, after: null }] }],
    ["emotions", { ...base, emotions: [] }],
    ["updatedAt", { ...base, updatedAt: "yesterday" }],
    ["status", { ...base, status: "done" }],
    ["automaticThought.beliefBefore", { ...base, automaticThought: { text: "x", beliefBefore: null, beliefAfter: null } }],
    ["nextAction", without(base, "nextAction")],
    ["underlyingBelief", { ...base, underlyingBelief: 5 }],
    ["exercise", { ...base, exercise: "sleep-diary" }],
    ["prediction", { ...be, prediction: null }],
    ["plan", without(be, "plan")],
    ["plannedFor", { ...be, plannedFor: "next Tuesday" }],
    ["linkedEntryId", { ...be, linkedEntryId: "nope" }],
    ["belief.ratingBefore", { ...be, belief: { text: "x", ratingBefore: null, ratingAfter: null } }],
    ["alternativeBelief.ratingAfter", { ...be, alternativeBelief: { text: null, ratingBefore: null, ratingAfter: 150 } }]
  ];
  for (const [field, e] of cases) assert(validateEntry(e).some(er => er.field === field), `expected an error on ${field}`);
});
test("v1.0.x files import; new optional field defaults to null", async () => {
  const j = memJournal();
  const doc = fixtureDoc(); doc.entries = [doc.entries[0]];
  assert(!("underlyingBelief" in doc.entries[0]), "fixture should be v1.0.x shape");
  const r = await importDocumentText(docText(doc), j);
  eq([r.added, r.errors.length], [1, 0], "counts");
  eq((await j.load(doc.entries[0].id)).underlyingBelief, null, "default filled");
});

// ---- M1 / M3 interchange
async function roundTrip(j) {
  const src = fixtureDoc();
  const r = await importDocumentText(docText(src), j);
  eq([r.added, r.updated, r.skipped, r.errors.length], [3, 0, 0, 0], "import counts");
  const out = await j.exportAll();
  eq(out.entries, expectedCanonical(src.entries), "round-trip entries differ");
  const j2 = memJournal();
  await importDocumentText(docText(out), j2);
  eq((await j2.exportAll()).entries, out.entries, "second round-trip differs");
}
test("M1 round-trip, zero diffs (memory)", async () => roundTrip(memJournal()));
test("M1 round-trip, zero diffs (IndexedDB)", async () => withTempIdb(roundTrip));
test("Unknown fields are preserved on re-export (spec §3 rule 1)", async () => {
  const j = memJournal();
  await importDocumentText(docText(fixtureDoc()), j);
  const e = (await j.exportAll()).entries.find(x => x.id === "01J8Z3Q6T9M4K2R7V5X1B0C8DE");
  eq(e["x-future-field"], { kept: true }, "entry-level unknown field");
  eq(e.emotions[2]["x-note"], "kept", "nested unknown field");
});
async function mergeSemantics(j) {
  const src = fixtureDoc();
  await importDocumentText(docText(src), j);
  let r = await importDocumentText(docText(src), j);
  eq([r.added, r.updated, r.skipped], [0, 0, 3], "re-import should skip all");
  const newer = fixtureDoc(); newer.entries[0].updatedAt = "2026-09-29T08:00:00-04:00"; newer.entries[0].nextAction = "changed";
  const older = fixtureDoc(); older.entries[1].updatedAt = "2026-01-01T00:00:00-05:00"; older.entries[1].situation = "old";
  r = await importDocumentText(docText({ ...newer, entries: [newer.entries[0], older.entries[1]] }), j);
  eq([r.added, r.updated, r.skipped], [0, 1, 1], "newer replaces, older skipped");
  eq((await j.load(src.entries[1].id)).situation, src.entries[1].situation, "older version overwrote newer");
  r = await j.importAll([{ ...src.entries[1], id: generateULID() }]);
  eq(r.added, 1, "new id added");
  eq((await j.list()).length, 4, "import must never delete");
}
test("Import merge: add / update / skip, never delete (memory)", async () => mergeSemantics(memJournal()));
test("Import merge: add / update / skip, never delete (IndexedDB)", async () => withTempIdb(mergeSemantics));
test("Import rejects bad files and writes nothing", async () => {
  const j = memJournal();
  const cases = [["{not json", "not valid JSON"], [JSON.stringify({ format: "other", formatVersion: 1, entries: [] }), "cbt-workbook"],
    [JSON.stringify({ format: "cbt-workbook", entries: [] }), "formatVersion"], [JSON.stringify({ format: "cbt-workbook", formatVersion: 99, entries: [] }), "newer version"],
    [JSON.stringify({ format: "cbt-workbook", formatVersion: 1, entries: {} }), "no entries"]];
  for (const [text, expect] of cases) {
    let msg = "";
    try { await importDocumentText(text, j); } catch (err) { msg = err.message; }
    assert(msg.includes(expect), `expected rejection mentioning "${expect}", got "${msg}"`);
  }
  eq((await j.list()).length, 0, "a rejected file wrote entries");
});
test("Invalid entries are skipped and reported; valid ones still import", async () => {
  const j = memJournal();
  const doc = fixtureDoc(); doc.entries.push({ ...doc.entries[0], id: "BAD\"ID" }, null);
  const r = await importDocumentText(docText(doc), j);
  eq([r.added, r.errors.length], [3, 2], "counts");
  assert(r.errors[0].fields.some(f => f.field === "id"), "error not reported by field");
});
test("M3 migration: synthetic formatVersion 0 file imports", async () => {
  const j = memJournal();
  const v0 = { format: "cbt-workbook", formatVersion: 0, entries: [{ id: "01J8X0000000000000000000CD", exercise: "thought-record", status: "partial",
    createdAt: "2026-09-01T12:00:00-04:00", updatedAt: "2026-09-01T12:05:00-04:00", situation: "Legacy entry", emotions: [{ name: "sadness", before: 55 }],
    thought: "Old flat thought", beliefBefore: 60, evidenceFor: "" }] };
  const r = await importDocumentText(JSON.stringify(v0), j);
  eq([r.added, r.errors.length], [1, 0], `migration import (errors: ${JSON.stringify(r.errors)})`);
  const e = await j.load("01J8X0000000000000000000CD");
  eq(e.automaticThought, { text: "Old flat thought", beliefBefore: 60, beliefAfter: null }, "thought migrated");
  eq([e.evidenceFor, e.behavior, e.emotions[0].after, e.underlyingBelief], [null, { urge: null, action: null }, null, null], "fields filled with null");
  assert(!("thought" in e), "old field left behind");
});

// ---- CSV (spec §7, RFC 4180)
test("CSV (thought records): BOM, CRLF, all quoted, long format, deltas", async () => {
  const entries = fixtureDoc().entries.map(withAdditiveDefaults);
  const noEmo = { ...entries[1], id: generateULID(), emotions: [] };
  const csv = buildCSV([...entries, noEmo]);
  assert(csv.charCodeAt(0) === 0xFEFF, "missing BOM");
  const rows = parseCSV(csv.slice(1));
  eq(rows[0], CSV_HEADERS, "header row");
  eq(CSV_HEADERS.slice(0, 19), ["entry_id", "created_at", "status", "situation", "emotion", "emotion_before", "emotion_after", "emotion_delta", "thought", "belief_before", "belief_after", "belief_delta", "thinking_patterns", "urge", "action", "evidence_for", "evidence_against", "alternative_perspective", "next_action"], "spec columns unchanged, in order");
  assert(rows.every(r => r.length === CSV_HEADERS.length), "every row must have every column");
  eq(rows.filter(r => r[0] === entries[0].id).length, 3, "3 emotions → 3 rows");
  eq(rows.filter(r => r[0] === noEmo.id).length, 1, "0 emotions → 1 row");
  eq(rows.filter(r => r[0] === entries[2].id).length, 0, "experiments are not in this file");
  const r0 = rows[1];
  eq([r0[4], r0[7], r0[11], r0[12]], ["anxiety", "-35", "-45", "mind-reading;catastrophizing"], "values and deltas");
  assert(r0[8].includes('"terrible"'), "embedded quote not round-tripped");
  assert(r0[16].includes("\n"), "embedded newline lost");
  const body = csv.slice(1).replace(/"(?:[^"]|"")*"/g, "");
  assert(!/[^\r]\n/.test(body), "line ending outside quotes is not CRLF");
});
test("CSV (experiments): one row each, deltas, quoting", async () => {
  const entries = fixtureDoc().entries.map(withAdditiveDefaults);
  const csv = buildExperimentCSV(entries);
  assert(csv.charCodeAt(0) === 0xFEFF, "missing BOM");
  const rows = parseCSV(csv.slice(1));
  eq(rows[0], CSV_BE_HEADERS, "header row");
  eq(rows.length, 2, "only experiments, one row each");
  const r = rows[1];
  eq([r[3], r[7], r[15], r[10]], ["01J8Z3Q6T9M4K2R7V5X1B0C8DE", "-45", "40", "2026-09-30"], "link, deltas, date");
  assert(r[8].includes('"frowning"') && r[16].includes("\n"), "quotes/newlines");
});

// ---- Rules and deltas (spec §5)
test("Rules R1–R14 and E1–E4 fire on fixtures and stay quiet otherwise", async () => {
  const e = (over) => ({ ...createBlankEntry(), ...over, automaticThought: { text: "t", beliefBefore: 50, beliefAfter: null, ...(over.automaticThought || {}) } });
  const x = (over) => ({ ...createBlankExperiment(), plan: "p", ...over, belief: { text: "b", ratingBefore: 50, ratingAfter: null, ...(over.belief || {}) }, alternativeBelief: { text: null, ratingBefore: null, ratingAfter: null, ...(over.alternativeBelief || {}) } });
  const rule = (id) => PROMPT_RULES.find(r => r.id === id);
  const cases = [
    ["R1", e({ automaticThought: { beliefBefore: 80 } }), e({ automaticThought: { beliefBefore: 79 } })],
    ["R2", e({ evidenceFor: "x" }), e({ evidenceFor: "x", evidenceAgainst: "y" })],
    ["R3", e({ thinkingPatterns: ["mind-reading"] }), e({ thinkingPatterns: ["labeling"] })],
    ["R4", e({ thinkingPatterns: ["fortune-telling"] }), e({})],
    ["R5", e({ thinkingPatterns: ["should-statements"] }), e({})],
    ["R6", e({ thinkingPatterns: ["all-or-nothing"] }), e({})],
    ["R7", e({ situation: "a".repeat(401) }), e({ situation: "a".repeat(400) })],
    ["R8", e({ automaticThought: { beliefBefore: 70 } }), e({ automaticThought: { beliefBefore: 70 }, underlyingBelief: "u" })],
    ["R9", e({ thinkingPatterns: ["emotional-reasoning"] }), e({})],
    ["R10", e({ thinkingPatterns: ["labeling"] }), e({})],
    ["R11", e({ thinkingPatterns: ["personalization"] }), e({})],
    ["R12", e({ thinkingPatterns: ["overgeneralization"] }), e({})],
    ["R13", e({ thinkingPatterns: ["discounting-positives"] }), e({})],
    ["R14", e({ automaticThought: { beliefAfter: 60 } }), e({ automaticThought: { beliefAfter: 59 } })],
    ["E1", x({}), x({ plannedFor: "2026-10-03" })],
    ["E2", x({}), x({ safetyBehaviors: "s" })],
    ["E3", x({ belief: { ratingBefore: 80 } }), x({ belief: { ratingBefore: 80 }, alternativeBelief: { text: "a" } })],
    ["E4", x({ belief: { ratingAfter: 50 } }), x({ belief: { ratingAfter: 40 } })]
  ];
  for (const [id, pos, neg] of cases) { assert(rule(id).when(pos), `${id} should fire`); assert(!rule(id).when(neg), `${id} should not fire`); }
  eq(PROMPT_RULES.slice(0, 7).map(r => r.step), [7, 7, 8, 8, 8, 8, 1], "R1–R7 steps match spec table");
  assert(rule("R4").when(e({ thinkingPatterns: ["catastrophizing"] })), "R4 catastrophizing");
  PROMPT_RULES.filter(r => r.id !== "R7").forEach(r => assert(r.prompt.trim().endsWith("?"), `${r.id} must only ask a question`)); // R7 wording is fixed by the spec
});
test("Deltas: signed, null-safe, computed on read", async () => {
  eq([formatDelta(computeDelta(80, 45)), formatDelta(computeDelta(40, 45)), formatDelta(computeDelta(5, 5)), formatDelta(computeDelta(50, null))], ["−35", "+5", "0", "—"], "deltas");
  assert(!("delta" in fixtureDoc().entries[0].emotions[0]), "delta must not be stored");
});
test("Trends math: median, recorded local time of day", async () => {
  eq([median([]), median([5]), median([3, 1, 2]), median([1, 2, 3, 4])], [null, 5, 2, 3], "median");
  eq(recordedParts("2026-09-28T23:15:00-04:00"), { weekday: 0, hour: 23 }, "Monday 23:00 as recorded, not converted");
  const g = heatGrid(fixtureDoc().entries);
  eq([g[0][2], g[6][1], g[1][1], g.flat().reduce((a, b) => a + b, 0)], [1, 1, 1, 3], "grid cells (Mon 15:15 afternoon, Sun 09:15 morning, Tue 08:15 morning)");
});

// ---- UI flows (M1 vertical slice, through the real controls)
test("UI: full thought record, keyboard-free path (memory)", async () => withMemUI(async () => {
  await startNewWizard();
  typeInto("w-situation", "Test situation");
  await wizardNav(1); eq(state.step, 2, "step 2");
  await wizardNav(1); eq(state.step, 2, "required step blocks Next");
  assert(!$("wizard-error").hidden, "error shown");
  document.querySelector("#wizard-body .chip").click();
  typeInto("w-em-0-num", "70");
  await wizardNav(1);
  typeInto("w-automaticThought-text", "Test thought");
  typeInto("w-automaticThought-beliefBefore-num", "85");
  assert(!$("wizard-btn-save").disabled, "save enabled after steps 1–3");
  for (let s = 4; s <= 8; s++) { await wizardNav(1); if (s === 5) $("pat-mind-reading").click(); }
  eq($("rule-hint-box").dataset.ruleId, "R3", "R3 hint on step 8");
  await wizardNav(1); eq(state.step, 9, "step 9");
  typeInto("w-automaticThought-beliefAfter-num", "40");
  typeInto("w-em-after-0-num", "30");
  await wizardNav(1);
  eq(state.screen, "entry", "lands on Entry view");
  const [saved] = await journal.list();
  eq([saved.status, saved.automaticThought.beliefAfter, saved.emotions[0].after, saved.thinkingPatterns], ["complete", 40, 30, ["mind-reading"]], "saved values");
  eq((await journal.drafts.list()).length, 0, "draft cleaned up");
}));
test("UI: experiment planned, then outcome recorded (memory)", async () => withMemUI(async () => {
  await startNewExperiment("01J8Z3Q6T9M4K2R7V5X1B0C8DE", { text: "If I speak up, people will laugh", rating: 80 });
  await wizardNav(1); typeInto("w-prediction", "Someone laughs");
  await wizardNav(1); typeInto("w-plan", "Ask one question in the meeting");
  eq($("wizard-btn-save").textContent, "Save plan", "plan label");
  await finalize(false);
  let [e] = await journal.list();
  eq([e.status, e.linkedEntryId, e.belief.ratingBefore], ["partial", "01J8Z3Q6T9M4K2R7V5X1B0C8DE", 80], "planned");
  await startWizard(clone(e), resumeStep(e)); eq(state.step, 6, "resumes at Outcome");
  typeInto("w-outcome", "Nobody laughed; one person nodded.");
  await wizardNav(1); typeInto("w-belief-ratingAfter-num", "35");
  await wizardNav(1);
  [e] = await journal.list();
  eq([e.status, e.belief.ratingAfter], ["complete", 35], "complete");
}));
test("UI: quick capture saves a partial thought record (memory)", async () => withMemUI(async () => {
  state.quick = null; renderQuick();
  assert(!(await quickSave()), "blank quick capture must not save");
  typeInto("q-situation", "Missed the bus");
  document.querySelector("#quick-body .chip").click();
  typeInto("q-em-0-num", "60");
  typeInto("q-thought", "The whole day is ruined");
  typeInto("q-belief-num", "75");
  assert(await quickSave(), "save");
  const [e] = await journal.list();
  eq([e.status, e.situation, e.emotions.length, e.automaticThought.beliefBefore], ["partial", "Missed the bus", 1, 75], "saved");
  eq(resumeStep(e), 4, "finish resumes at step 4");
}));
test("Journal search and filters", async () => {
  const list = fixtureDoc().entries.map(withAdditiveDefaults);
  const f = (o) => filterEntries(list, { q: "", type: "all", status: "all", pattern: "all", ...o }).map(e => e.id.slice(-2));
  eq(f({ q: "EMAIL" }), ["DE"], "case-insensitive search");
  eq(f({ q: "feedback" }), ["EF"], "searches experiments");
  eq(f({ type: "behavioral-experiment" }), ["EF"], "type");
  eq(f({ status: "partial" }), ["AB"], "status");
  eq(f({ pattern: "mind-reading" }), ["DE"], "pattern");
});

test("No stray null / [object …] text on any screen", async () => withMemUI(async () => {
  await importDocumentText(docText(fixtureDoc()), journal);
  const bad = [];
  const check = (where) => { const txt = document.querySelector("main").innerText; if (/\bnull\b|\bundefined\b|\[object /.test(txt)) bad.push(where); };
  for (const scr of ["home", "journal", "trends", "interchange", "help"]) { state.screen = scr; await render(state); check(scr); }
  for (const id of fixtureDoc().entries.map(e => e.id)) { state.selectedId = id; state.screen = "entry"; await render(state); check(`entry ${id}`); }
  for (const e of [createBlankEntry(), createBlankExperiment(), ...(await journal.list())]) {
    state.draft = e; state.screen = "wizard";
    for (let s = 1; s <= exOf(e).steps.length; s++) { state.step = s; await render(state); check(`wizard ${e.exercise} step ${s}`); }
  }
  const q = createBlankEntry(); PRESET_EMOTIONS.forEach(n => q.emotions.push({ name: n, before: 10, after: null }));
  state.quick = q; state.screen = "home"; await render(state); check("quick capture, every preset used");
  assert(!bad.length, `stray text on: ${bad.join(", ")}`);
}));

// ---- Safety (spec §8 S1–S4)
test("S1–S4 safety copy present; forbidden wording absent", async () => {
  const foot = document.querySelector("footer.persistent-safety").textContent.replace(/\s+/g, " ");
  assert(foot.includes("If you're in crisis or thinking about harming yourself, stop and reach out now. US: call or text 988."), "S1 footer text");
  assert($("footer-help"), "S1 footer link");
  const crisis = JSON.stringify(CRISIS_CONFIG).toLowerCase();
  ["988", "911", "emergency department", "trusted person"].forEach(k => assert(crisis.includes(k), `S2 missing ${k}`));
  assert($("screen-home").textContent.includes("not therapy"), "S3 home statement");
  const copy = document.body.cloneNode(true);
  copy.querySelector("#screen-selftest").remove(); copy.querySelectorAll("script").forEach(s => s.remove());
  const words = copy.textContent + JSON.stringify(EXERCISES, (k, v) => typeof v === "function" ? undefined : v) + PROMPT_RULES.map(r => r.prompt).join(" ");
  assert(!/improv(e|ed|es|ement|ing)/i.test(words), "S4: copy says improve/improvement");
  assert(!/\b(score|diagnos)/i.test(words), "S4: copy scores or diagnoses");
});

// ---- Accessibility (spec §8 A1–A5)
test("A1/A4: every form control and button has a programmatic label", async () => {
  const saved = { draft: state.draft, step: state.step };
  const unlabeled = [];
  const scan = (root) => {
    root.querySelectorAll("input, select, textarea").forEach(c => {
      const ok = (c.labels && c.labels.length) || c.getAttribute("aria-label") || c.getAttribute("aria-labelledby");
      if (!ok) unlabeled.push(c.id || c.outerHTML.slice(0, 60));
    });
    root.querySelectorAll("button").forEach(b => { if (!(b.getAttribute("aria-label") || b.textContent.trim())) unlabeled.push(b.id || "button"); });
    const nums = root.querySelectorAll("input[type=number]"), ranges = root.querySelectorAll("input[type=range]");
    assert(nums.length === ranges.length, "every slider needs a paired number input");
  };
  try {
    for (const ex of fixtureDoc().entries.slice(0, 3)) {
      state.draft = normalizeEntry(withAdditiveDefaults(ex));
      for (let s = 1; s <= exOf(state.draft).steps.length; s++) { state.step = s; renderWizard(); scan($("screen-wizard")); }
    }
    renderQuick(); scan($("screen-home")); scan($("screen-journal")); scan($("screen-interchange"));
    assert(unlabeled.length === 0, `unlabeled: ${unlabeled.join(", ")}`);
  } finally { state.draft = saved.draft; state.step = saved.step; }
});
test("A3: token contrast in the current theme", async () => {
  const v = cssVar;
  const pairs = [["text", "bg", 4.5], ["text", "surface", 4.5], ["text", "surface-2", 4.5], ["text-muted", "surface", 4.5], ["text-muted", "bg", 4.5], ["text-muted", "surface-2", 4.5],
    ["on-primary", "primary", 4.5], ["on-primary", "primary-hover", 4.5], ["text", "primary-soft", 4.5], ["primary", "surface", 4.5], ["primary", "bg", 4.5],
    ["danger", "surface", 4.5], ["on-danger", "danger", 4.5], ["warning-text", "warning-bg", 4.5], ["hint-text", "hint-bg", 4.5], ["text", "badge-bg", 4.5], ["bg", "text", 4.5],
    ["control-border", "surface", 3], ["control-border", "bg", 3], ["focus-ring", "surface", 3], ["focus-ring", "bg", 3],
    ["viz-after", "surface", 3], ["viz-bar", "surface", 3], ["viz-before", "surface", 2]];
  const fails = pairs.map(([a, b, min]) => [a, b, min, contrast(v(a), v(b))]).filter(p => p[3] < p[2]);
  const theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  assert(!fails.length, `${theme}: ${fails.map(f => `${f[0]}/${f[1]} ${f[3].toFixed(2)}:1 < ${f[2]}`).join("; ")}`);
  for (let i = 0; i <= 6; i++) { const bg = v(`heat-${i}`), ink = heatInk(bg); assert(contrast(bg, ink) >= 4.5, `${theme}: heat-${i} cell label ${contrast(bg, ink).toFixed(2)}:1`); }
  return `${theme} theme: ${pairs.length} pairs + 7 heatmap labels pass (run again in the other theme)`;
});
test("A5: reduced-motion rule present", async () => {
  const css = Array.from(document.styleSheets).flatMap(s => Array.from(s.cssRules)).map(r => r.cssText).join(" ");
  assert(/prefers-reduced-motion/.test(css), "no prefers-reduced-motion rule");
});

// ---- Budget and spike checks (spec §9, §10)
test("No external requests; index.html under 150 KB", async () => {
  const res = performance.getEntriesByType("resource").filter(r => !/^(blob|data):/.test(r.name) && !r.name.endsWith("/selftest.js")); // the harness itself is dev-only
  assert(res.length === 0, `external requests: ${res.map(r => r.name).join(", ")}`);
  const bytes = BOOT_BYTES;
  assert(bytes < 150 * 1024, `~${Math.round(bytes / 1024)} KB`);
  return `~${Math.round(bytes / 1024)} KB (as loaded, before rendering)`;
});
test("Spike: 1 MB JSON import under 1 s (IndexedDB)", async () => withTempIdb(async (j) => {
  const base = fixtureDoc().entries[0];
  const entries = [];
  let text = "";
  const t0 = Date.parse("2026-01-01T00:00:00Z");
  for (let i = 0; text.length < 1024 * 1024; i++) {
    for (let k = 0; k < 100; k++, i++) entries.push({ ...clone(base), id: generateULID(t0 + i * 1000) });
    text = docText({ ...fixtureDoc(), entries });
  }
  const start = performance.now();
  const r = await importDocumentText(text, j);
  const ms = Math.round(performance.now() - start);
  eq(r.added, entries.length, "all entries added");
  assert(ms < 1000, `${ms} ms for ${(text.length / 1048576).toFixed(2)} MB`);
  return `${ms} ms for ${entries.length} entries, ${(text.length / 1048576).toFixed(2)} MB`;
}));
test("Spike: this browser's storage mode and persist() result", async () => {
  return `Mode ${state.mode === "indexeddb" ? "B (IndexedDB)" : "A (memory)"}${state.storageNote ? ` — ${state.storageNote}` : ""}; persist(): ${state.persistResult}`;
});

async function runSelfTest() {
  state.screen = "selftest";
  await render(state, { focus: true });
  const tbody = $("st-rows");
  tbody.replaceChildren();
  const lines = [`CBT Workbook ${APP_VERSION} self-test — ${nowRFC3339()}`, navigator.userAgent, ""];
  let pass = 0, fail = 0, skip = 0;
  for (const t of ST) {
    let status = "PASS", detail = "";
    try { const r = await t.fn(); detail = typeof r === "string" ? r : ""; pass++; }
    catch (err) { if (err instanceof Skip) { status = "SKIP"; skip++; } else { status = "FAIL"; fail++; } detail = err.message; }
    tbody.append(el("tr", {}, el("td", {}, t.name), el("td", { class: status === "PASS" ? "st-pass" : status === "FAIL" ? "st-fail" : "st-skip" }, status), el("td", { class: "pre" }, detail)));
    lines.push(`${status}  ${t.name}${detail ? `  —  ${detail}` : ""}`);
  }
  const summary = `${pass} passed, ${fail} failed, ${skip} skipped (of ${ST.length}).`;
  state.screen = "selftest";
  await render(state); // restore the screen after UI-flow tests
  $("st-summary").textContent = summary;
  lines.push("", summary);
  $("st-report").value = lines.join("\n");
  document.title = `CBT Workbook self-test: ${fail ? "FAIL" : "PASS"}`;
  window.__selftest = { pass, fail, skip, report: lines.join("\n") };
}
