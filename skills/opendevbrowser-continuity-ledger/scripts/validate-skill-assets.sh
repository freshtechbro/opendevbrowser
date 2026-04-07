#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skill_file="$root/SKILL.md"

node - "$skill_file" <<'NODE'
const fs = require("node:fs");

const [skillFile] = process.argv.slice(2);
const content = fs.readFileSync(skillFile, "utf8");
const failures = [];

const requiredMarkers = [
  "scripts/validate-skill-assets.sh",
  "CONTINUITY.md",
  "sub_continuity.md",
  "Allow only the main orchestrator agent to edit `CONTINUITY.md`.",
  "Run this sequence at the beginning of each turn:",
  "Goal (incl. success criteria):",
  "Constraints/Assumptions:",
  "Key decisions:",
  "State:",
  "Open questions (UNCONFIRMED if needed):",
  "Working set (files/ids/commands):",
  "Key learnings: what worked; what didn't work, best approach identified for next time",
  "UNCONFIRMED",
  "Start response messages with a short ledger snapshot:"
];

for (const marker of requiredMarkers) {
  if (!content.includes(marker)) {
    failures.push(`SKILL.md missing marker: ${marker}`);
  }
}

const turnSteps = [
  "1. Read `CONTINUITY.md`.",
  "2. Read `sub_continuity.md`.",
  "3. Update `CONTINUITY.md` to reflect the current goal, constraints, decisions, and execution state.",
  "4. Proceed with implementation."
];
for (const step of turnSteps) {
  if (!content.includes(step)) {
    failures.push(`Start-of-turn protocol missing step: ${step}`);
  }
}

if (!/## Validator Contract[\s\S]*reply pattern/i.test(content)) {
  failures.push("Validator contract section must document the reply pattern guarantee.");
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.log("Continuity ledger skill assets validated.");
NODE
