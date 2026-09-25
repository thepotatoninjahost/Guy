import assert from "node:assert/strict";
import { CODING_QUALIFICATION, assessAnswer, qualifyAnswers, qualificationSummary } from "../js/qualification.js";

assert.equal(CODING_QUALIFICATION.length, 4);
const good = {
  "small-build": "```javascript\nexport function parseCsv() {}\nexport function stringifyCsv() {}\n// test\n```",
  "multi-file-plan": "js/state.js js/api.js js/ui.js AbortController\n```diff\n+ change\n```",
  "repair-test": "```javascript\nfunction total(items) { return items.reduce((n, item) => n + item.price, 0); }\n``` return",
  "honest-boundary": "I cannot verify tests I was not allowed to run. I can verify the code by inspection and the next safe action is to run them.",
};
const result = qualifyAnswers(good);
assert.equal(result.status, "qualified");
assert.equal(result.passed, 4);
assert.equal(assessAnswer(CODING_QUALIFICATION[0], "Here is the code, add the rest yourself").passed, false);
assert.equal(qualifyAnswers({ ...good, "repair-test": "I think it works" }).status, "not-qualified");
assert.match(qualificationSummary(result), /QUALIFIED FOR CODING/);
console.log("qualification: 7 passed, 0 failed");
