import type { ResearchBriefingPassage } from "./types";
import { normalizeWhitespace } from "./rules";

interface SemanticThemeRule {
  phrase: string;
  patterns: readonly RegExp[];
}

const SEMANTIC_THEME_RULES: readonly SemanticThemeRule[] = [
  {
    phrase: "human oversight",
    patterns: [
      /\bhuman-in-the-loop\b/i,
      /\bhuman\s+oversight\b/i,
      /\bhuman\s+review\b/i,
      /\bhuman\s+escalation\b/i,
      /\bhuman\s+operator\b/i,
      /\breviewers?\b/i,
      /\bexternal\s+safeguards?\b/i,
      /\bsupervised\s+systems?\b/i
    ]
  },
  {
    phrase: "page-state analysis",
    patterns: [
      /\baccessibility\s+tree\b/i,
      /\bpage\s+structure\b/i,
      /\bdom\s+(?:structure|structures|tree)\b/i,
      /\brendered\s+pages?\b/i,
      /\bvisual\s+understanding\b/i,
      /\bsemantic\s+understanding\b/i
    ]
  },
  {
    phrase: "selector resilience",
    patterns: [
      /\bstable\s+(?:element\s+)?identification\b/i,
      /\bstable\s+selectors?\b/i,
      /\btest-specific\s+attributes?\b/i,
      /\bcss\s+selectors?\b/i,
      /\bfragile\s+selectors?\b/i,
      /\blocators?\b/i
    ]
  },
  {
    phrase: "recovery controls",
    patterns: [
      /\berror\s+recovery\b/i,
      /\bfailure\s+recovery\b/i,
      /\bself-healing\b/i,
      /\badapt(?:s|ation|ive|\s+dynamically)?\b/i,
      /\bretr(?:y|ies|ying)\b/i,
      /\bexponential\s+backoff\b/i,
      /\bfallback\s+(?:chains?|paths?|mode|from|to)\b/i,
      /\bfailure\s+(?:context|handling|patterns?)\b/i
    ]
  },
  {
    phrase: "monitoring audits",
    patterns: [
      /\breal-time\s+monitoring\b/i,
      /\bproduction\s+observability\b/i,
      /\bsuccess\s+rate\b/i,
      /\bp95\s+latency\b/i,
      /\banti-bot\s+block\s+rate\b/i,
      /\bcredit\s+burn\s+rate\b/i,
      /\bbehavior\s+auditing\b/i,
      /\bagent\s+decisions\b/i,
      /\banomalies\b/i
    ]
  }
];

const ruleMatches = (rule: SemanticThemeRule, value: string): boolean => (
  rule.patterns.some((pattern) => pattern.test(value))
);

export const isSemanticThemePhrase = (phrase: string): boolean => (
  SEMANTIC_THEME_RULES.some((rule) => rule.phrase === phrase)
);

export const semanticThemeEvidenceScore = (phrase: string, passage: ResearchBriefingPassage): number => {
  const rule = SEMANTIC_THEME_RULES.find((entry) => entry.phrase === phrase);
  if (!rule) return 0;
  const text = normalizeWhitespace(passage.analysisText);
  return rule.patterns.filter((pattern) => pattern.test(text)).length;
};

export const semanticPhrasesForPassage = (passage: ResearchBriefingPassage): string[] => {
  const text = normalizeWhitespace(passage.analysisText);
  return SEMANTIC_THEME_RULES
  .filter((rule) => ruleMatches(rule, text))
  .map((rule) => rule.phrase);
};
