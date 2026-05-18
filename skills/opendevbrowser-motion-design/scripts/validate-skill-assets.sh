#!/usr/bin/env bash
set -euo pipefail

skill_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skill_file="$skill_root/SKILL.md"

node - "$skill_root" "$skill_file" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const [skillRoot, skillFile] = process.argv.slice(2);
const failures = [];
const fullPath = (relativePath) => path.join(skillRoot, relativePath);
const read = (relativePath) => fs.readFileSync(fullPath(relativePath), "utf8");

const requiredPaths = [
  "SKILL.md",
  "artifacts/motion-terminology.md",
  "artifacts/motion-pattern-catalog.md",
  "artifacts/platform-framework-guide.md",
  "artifacts/device-breakpoint-posture.md",
  "artifacts/accessibility-reduced-motion.md",
  "artifacts/performance-frame-budget.md",
  "artifacts/open-dev-browser-motion-evidence.md",
  "artifacts/motion-release-gate.md",
  "artifacts/motion-anti-patterns.md",
  "assets/templates/motion-contract.v1.json",
  "assets/templates/motion-audit-report.v1.md",
  "assets/templates/motion-viewport-matrix.v1.json",
  "assets/templates/motion-release-gate.v1.json",
  "scripts/motion-workflow.sh",
  "scripts/validate-skill-assets.sh"
];

const jsonTemplates = [
  "assets/templates/motion-contract.v1.json",
  "assets/templates/motion-viewport-matrix.v1.json",
  "assets/templates/motion-release-gate.v1.json"
];

const executableScripts = [
  "scripts/motion-workflow.sh",
  "scripts/validate-skill-assets.sh"
];

for (const relativePath of requiredPaths) {
  if (!fs.existsSync(fullPath(relativePath))) {
    failures.push(`Missing required asset: ${relativePath}`);
  }
}

for (const relativePath of executableScripts) {
  if (!fs.existsSync(fullPath(relativePath))) continue;
  const mode = fs.statSync(fullPath(relativePath)).mode & 0o111;
  if (mode === 0) {
    failures.push(`Script is not executable: ${relativePath}`);
  }
}

for (const relativePath of jsonTemplates) {
  if (!fs.existsSync(fullPath(relativePath))) continue;
  try {
    JSON.parse(read(relativePath));
  } catch {
    failures.push(`Invalid JSON template: ${relativePath}`);
  }
}

const skillDoc = fs.readFileSync(skillFile, "utf8");
for (const marker of requiredPaths) {
  if (marker !== "SKILL.md" && !skillDoc.includes(marker)) {
    failures.push(`SKILL.md missing marker: ${marker}`);
  }
}

for (const marker of [
  "opendevbrowser-best-practices",
  "opendevbrowser-design-agent",
  "Motion Contract",
  "Pattern Selection",
  "Platform And Framework Policy",
  "Device Posture",
  "Reduced Motion",
  "Verification",
  "Anti-patterns",
  "Related Skills"
]) {
  if (!skillDoc.includes(marker)) {
    failures.push(`SKILL.md missing marker: ${marker}`);
  }
}

const terminology = read("artifacts/motion-terminology.md");
for (const marker of [
  "Duration",
  "Delay",
  "Easing",
  "Spring",
  "Damping",
  "Stiffness",
  "Mass",
  "Keyframe",
  "Timeline",
  "Choreography",
  "Stagger",
  "Interpolation",
  "Transform",
  "Opacity",
  "Layout animation",
  "Shared element transition",
  "FLIP",
  "Scroll progress",
  "View progress",
  "Gesture velocity",
  "Inertia",
  "Overshoot",
  "Anticipation",
  "Follow-through",
  "Interruptibility",
  "Retargeting",
  "Reduced motion",
  "Motion contract",
  "Motion evidence",
  "Frame budget",
  "Input latency",
  "Compositing",
  "Decorative",
  "Meaning-bearing"
]) {
  if (!terminology.includes(marker)) {
    failures.push(`motion-terminology missing marker: ${marker}`);
  }
}

const patternCatalog = read("artifacts/motion-pattern-catalog.md");
const patternEntries = patternCatalog.match(/^### Pattern /gm) ?? [];
if (patternEntries.length < 30) {
  failures.push(`motion-pattern-catalog has ${patternEntries.length} entries; expected at least 30`);
}
for (const marker of [
  "No-motion",
  "Opacity Fade",
  "Fade-through",
  "Crossfade",
  "Scale Fade",
  "Slide",
  "Shared Element",
  "FLIP Layout",
  "Staggered Reveal",
  "Choreographed Sequence",
  "Progressive Disclosure",
  "Modal Motion",
  "Sheet Motion",
  "Popover Motion",
  "Skeleton Shimmer",
  "Progress Morph",
  "Pull-to-refresh",
  "Swipe-to-dismiss",
  "Spring Settle",
  "Scroll Reveal",
  "Parallax",
  "Pinned Scroll",
  "SVG Path",
  "Icon Morph",
  "Lottie/Rive",
  "WebGL/Spatial"
]) {
  if (!patternCatalog.includes(marker)) {
    failures.push(`motion-pattern-catalog missing marker: ${marker}`);
  }
}

const frameworkGuide = read("artifacts/platform-framework-guide.md");
for (const marker of [
  "CSS Transitions",
  "CSS Keyframe Animations",
  "Web Animations API",
  "View Transition API",
  "CSS Scroll-driven Animations",
  "Motion For React",
  "motion/react",
  "GSAP 3.x",
  "Anime.js 4.x",
  "react-spring",
  "Lottie",
  "Rive Web Runtime",
  "Three.js",
  "react-three-fiber",
  "Spline",
  "WebGL",
  "SwiftUI",
  "UIKit",
  "Core Animation",
  "Jetpack Compose",
  "Android MotionLayout",
  "React Native Reanimated 4.x",
  "Flutter Animation APIs",
  "Haptics",
  "new runtime dependency requires approval"
]) {
  if (!frameworkGuide.includes(marker)) {
    failures.push(`platform-framework-guide missing marker: ${marker}`);
  }
}

const devicePosture = read("artifacts/device-breakpoint-posture.md");
for (const marker of [
  "Mobile portrait",
  "Mobile landscape",
  "Tablet portrait",
  "Tablet landscape",
  "Laptop and desktop",
  "Large monitor",
  "Short viewport",
  "Coarse pointer",
  "Fine pointer",
  "Trackpad",
  "Touch gesture context",
  "Keyboard-only context",
  "Reduced-power devices",
  "High-refresh displays",
  "Foldable/device posture",
  "device-posture",
  "progressive enhancement"
]) {
  if (!devicePosture.includes(marker)) {
    failures.push(`device-breakpoint-posture missing marker: ${marker}`);
  }
}

const accessibility = read("artifacts/accessibility-reduced-motion.md");
for (const marker of [
  "WCAG 2.2 SC 2.3.3",
  "prefers-reduced-motion",
  "Essential",
  "Non-essential",
  "vestibular",
  "keyboard order",
  "focus stable",
  "motion-only feedback",
  "ARIA live"
]) {
  if (!accessibility.includes(marker)) {
    failures.push(`accessibility-reduced-motion missing marker: ${marker}`);
  }
}

const performance = read("artifacts/performance-frame-budget.md");
for (const marker of [
  "transform and opacity",
  "layout",
  "paint",
  "compositing",
  "will-change",
  "requestAnimationFrame",
  "INP",
  "input latency",
  "dropped frames",
  "high refresh",
  "mobile thermal",
  "cleanup",
  "layout shift",
  "horizontal overflow"
]) {
  if (!performance.includes(marker)) {
    failures.push(`performance-frame-budget missing marker: ${marker}`);
  }
}

const evidence = read("artifacts/open-dev-browser-motion-evidence.md");
for (const marker of [
  "snapshot",
  "screenshot",
  "debug-trace-snapshot",
  "screencast-start",
  "screencast-stop",
  "console and network",
  "viewport matrix",
  "reduced-motion",
  "canvas.preview.render"
]) {
  if (!evidence.includes(marker)) {
    failures.push(`open-dev-browser-motion-evidence missing marker: ${marker}`);
  }
}

const releaseGate = read("artifacts/motion-release-gate.md");
for (const marker of [
  "Contract alignment",
  "Pattern justification",
  "Reduced motion",
  "Keyboard order",
  "Viewport matrix",
  "Temporal proof",
  "Debug trace",
  "Console/network stability",
  "Performance",
  "Overflow",
  "Focus traps",
  "Library policy"
]) {
  if (!releaseGate.includes(marker)) {
    failures.push(`motion-release-gate missing marker: ${marker}`);
  }
}

const antiPatterns = read("artifacts/motion-anti-patterns.md");
for (const marker of [
  "Decorative motion without user value",
  "Missing progress owner",
  "Competing scroll observers",
  "Layout-property animation",
  "Long-distance mobile travel",
  "Default parallax",
  "Pinned scroll without escape",
  "Hover-only affordance",
  "Reduced motion that removes meaning",
  "Unbounded loops",
  "Fake progress",
  "Unapproved runtime dependency",
  "Haptic spam",
  "Index-keyed animated lists",
  "Non-interruptible gesture animation"
]) {
  if (!antiPatterns.includes(marker)) {
    failures.push(`motion-anti-patterns missing marker: ${marker}`);
  }
}

const workflowScript = fullPath("scripts/motion-workflow.sh");
const workflowSource = fs.readFileSync(workflowScript, "utf8");
for (const marker of ["resolve-odb-cli.sh", "CLI_PREFIX"]) {
  if (!workflowSource.includes(marker)) {
    failures.push(`motion-workflow.sh missing resolver marker: ${marker}`);
  }
}

for (const workflow of [
  "list",
  "contract-first",
  "pattern-select",
  "viewport-matrix",
  "reduced-motion-check",
  "temporal-proof",
  "scroll-stage-audit",
  "gesture-motion",
  "performance-audit",
  "release-gate"
]) {
  const result = spawnSync(workflowScript, [workflow], { encoding: "utf8" });
  if (result.status !== 0) {
    failures.push(`motion-workflow.sh failed for mode ${workflow}: ${result.stderr.trim() || result.stdout.trim()}`);
    continue;
  }
  if (result.stdout.trim().length === 0) {
    failures.push(`motion-workflow.sh returned empty output for mode ${workflow}`);
  }
}

const temporalProof = spawnSync(workflowScript, ["temporal-proof"], { encoding: "utf8" });
for (const marker of ["screencast-start", "screencast-stop", "snapshot", "screenshot", "debug-trace-snapshot"]) {
  if (!temporalProof.stdout.includes(marker)) {
    failures.push(`temporal-proof output missing marker: ${marker}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Motion-design skill assets validated.");
NODE
