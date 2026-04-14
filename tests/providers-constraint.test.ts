import { describe, expect, it } from "vitest";
import {
  applyProviderIssueHint,
  buildProviderIssueGuidance,
  classifyProviderIssue,
  readProviderIssueHint,
  summarizePrimaryProviderIssue,
  summarizeProviderIssue
} from "../src/providers/constraint";

describe("provider constraint helpers", () => {
  it("classifies render-required and challenge shells explicitly", () => {
    expect(classifyProviderIssue({
      url: "https://www.macys.com/shop/featured/wireless-mouse",
      providerShell: "macys_access_denied_shell",
      browserRequired: true,
      message: "You don't have permission to access this page on this server."
    })).toEqual({
      reasonCode: "env_limited",
      blockerType: "env_limited",
      constraint: {
        kind: "render_required",
        evidenceCode: "macys_access_denied_shell",
        providerShell: "macys_access_denied_shell",
        message: "You don't have permission to access this page on this server."
      }
    });

    expect(classifyProviderIssue({
      url: "https://www.target.com/s?searchTerm=wireless+mouse",
      providerShell: "target_shell_page",
      browserRequired: true,
      message: "Skip to main content"
    })).toEqual({
      reasonCode: "env_limited",
      blockerType: "env_limited",
      constraint: {
        kind: "render_required",
        evidenceCode: "target_shell_page",
        providerShell: "target_shell_page",
        message: "Skip to main content"
      }
    });

    expect(classifyProviderIssue({
      url: "https://www.temu.com/search_result.html?search_key=wireless%20mouse",
      providerShell: "temu_challenge_shell",
      browserRequired: true,
      message: "Temu returned a challenge shell that requires a live browser session."
    })).toEqual({
      reasonCode: "challenge_detected",
      blockerType: "anti_bot_challenge"
    });

    expect(classifyProviderIssue({
      url: "https://x.com/search?q=browser+automation",
      providerShell: "social_js_required_shell",
      browserRequired: true,
      message: "JavaScript is not available."
    })).toEqual({
      reasonCode: "env_limited",
      blockerType: "env_limited",
      constraint: {
        kind: "render_required",
        evidenceCode: "social_js_required_shell",
        providerShell: "social_js_required_shell",
        message: "JavaScript is not available."
      }
    });

    expect(classifyProviderIssue({
      url: "https://business.x.com/en/ads-guide",
      providerShell: "social_first_party_help_shell",
      browserRequired: true,
      message: "How X Ads work"
    })).toEqual({
      reasonCode: "env_limited",
      blockerType: "env_limited",
      constraint: {
        kind: "render_required",
        evidenceCode: "social_first_party_help_shell",
        providerShell: "social_first_party_help_shell",
        message: "How X Ads work"
      }
    });

    expect(classifyProviderIssue({
      url: "https://www.reddit.com/search/?q=browser+automation",
      providerShell: "social_verification_wall",
      browserRequired: true,
      message: "Please wait for verification."
    })).toEqual({
      reasonCode: "challenge_detected",
      blockerType: "anti_bot_challenge"
    });
  });

  it("classifies generic env-limited blocker messages and browser-required fallback without shells", () => {
    expect(classifyProviderIssue({
      message: "This provider is not available in this environment right now.",
      providerErrorCode: "unavailable"
    })).toEqual({
      reasonCode: "env_limited",
      blockerType: "env_limited"
    });

    expect(classifyProviderIssue({
      browserRequired: true,
      message: "Browser assistance required."
    })).toEqual({
      reasonCode: "env_limited",
      blockerType: "env_limited",
      constraint: {
        kind: "render_required",
        evidenceCode: "env_limited",
        message: "Browser assistance required."
      }
    });
  });

  it("infers missing reason codes from carried constraints and fallback details", () => {
    expect(readProviderIssueHint({
      details: {
        constraint: {
          kind: "session_required",
          evidenceCode: "auth_required"
        }
      }
    })).toEqual({
      reasonCode: "token_required",
      constraint: {
        kind: "session_required",
        evidenceCode: "auth_required"
      }
    });

    expect(readProviderIssueHint({
      details: {
        url: "https://html.duckduckgo.com/html/?q=wireless+mouse",
        providerShell: "duckduckgo_non_js_redirect",
        browserRequired: true,
        message: "Redirected to the non-JavaScript site for this query."
      }
    })).toEqual({
      reasonCode: "env_limited",
      blockerType: "env_limited",
      constraint: {
        kind: "render_required",
        evidenceCode: "duckduckgo_non_js_redirect",
        providerShell: "duckduckgo_non_js_redirect",
        message: "Redirected to the non-JavaScript site for this query."
      }
    });
  });

  it("applies hints without clobbering existing blocker or constraint details", () => {
    expect(applyProviderIssueHint({
      blockerType: "auth_required",
      constraint: {
        kind: "session_required",
        evidenceCode: "existing_auth"
      },
      other: "value"
    }, {
      reasonCode: "env_limited",
      blockerType: "env_limited",
      constraint: {
        kind: "render_required",
        evidenceCode: "target_shell_page"
      }
    })).toEqual({
      blockerType: "auth_required",
      constraint: {
        kind: "session_required",
        evidenceCode: "existing_auth"
      },
      other: "value",
      reasonCode: "env_limited",
      guidance: {
        reason: "Provider needs a live browser-rendered page before retrying.",
        recommendedNextCommands: [
          "Retry with browser assistance or a headed browser session.",
          "Rerun the same provider or workflow after the rendered page is ready."
        ]
      }
    });
  });

  it("summarizes primary issues by priority and falls back to generic env-limited wording", () => {
    expect(summarizeProviderIssue({
      provider: "shopping/costco",
      hint: {
        reasonCode: "env_limited"
      }
    })).toBe("Costco requires manual browser follow-up; this run did not determine whether login or page rendering is required.");

    expect(summarizeProviderIssue({
      provider: "costco",
      hint: {
        reasonCode: "env_limited"
      }
    })).toBe("Costco requires manual browser follow-up; this run did not determine whether login or page rendering is required.");

    expect(summarizePrimaryProviderIssue([
      {
        provider: "shopping/target",
        error: {
          code: "unavailable",
          details: {
            constraint: {
              kind: "render_required",
              evidenceCode: "target_shell_page"
            }
          }
        }
      },
      {
        provider: "shopping/temu",
        error: {
          reasonCode: "challenge_detected",
          details: {
            providerShell: "temu_challenge_shell"
          }
        }
      },
      {
        provider: "shopping/costco",
        error: {
          details: {
            constraint: {
              kind: "session_required",
              evidenceCode: "auth_required"
            }
          }
        }
      }
    ])).toMatchObject({
      provider: "shopping/costco",
      reasonCode: "token_required",
      constraint: {
        kind: "session_required",
        evidenceCode: "auth_required"
      },
      summary: "Costco requires login or an existing session."
    });
  });

  it("classifies auth walls and direct challenge hints without provider shells", () => {
    expect(classifyProviderIssue({
      title: "Sign in | LinkedIn",
      message: "Please sign in to continue.",
      providerErrorCode: "unavailable"
    })).toEqual({
      reasonCode: "token_required",
      blockerType: "auth_required",
      constraint: {
        kind: "session_required",
        evidenceCode: "auth_required",
        message: "Please sign in to continue."
      }
    });

    expect(readProviderIssueHint({
      reasonCode: "challenge_detected",
      blockerType: "anti_bot_challenge",
      details: {
        constraint: {
          kind: "render_required",
          evidenceCode: "temu_challenge_shell",
          providerShell: "temu_challenge_shell"
        }
      }
    })).toEqual({
      reasonCode: "challenge_detected",
      blockerType: "anti_bot_challenge",
      constraint: {
        kind: "render_required",
        evidenceCode: "temu_challenge_shell",
        providerShell: "temu_challenge_shell"
      }
    });
  });

  it("applies empty hints safely and supports provider-neutral summaries", () => {
    expect(applyProviderIssueHint(undefined, {
      reasonCode: "env_limited",
      blockerType: "env_limited",
      constraint: {
        kind: "render_required",
        evidenceCode: "browser_required"
      }
    })).toEqual({
      reasonCode: "env_limited",
      blockerType: "env_limited",
      constraint: {
        kind: "render_required",
        evidenceCode: "browser_required"
      },
      guidance: {
        reason: "Provider needs a live browser-rendered page before retrying.",
        recommendedNextCommands: [
          "Retry with browser assistance or a headed browser session.",
          "Rerun the same provider or workflow after the rendered page is ready."
        ]
      }
    });

    const existing = {
      blockerType: "env_limited",
      reasonCode: "env_limited"
    };
    expect(applyProviderIssueHint(existing, null)).toBe(existing);

    expect(summarizeProviderIssue({
      hint: {
        reasonCode: "env_limited"
      }
    })).toBe("Provider requires manual browser follow-up; this run did not determine whether login or page rendering is required.");

    expect(summarizePrimaryProviderIssue(undefined)).toBeNull();
    expect(summarizePrimaryProviderIssue([])).toBeNull();
  });

  it("keeps generic env-limited failures actionable when no subtype survives", () => {
    expect(summarizePrimaryProviderIssue([
      {
        provider: "shopping/costco",
        error: {
          reasonCode: "env_limited",
          details: {
            reasonCode: "env_limited"
          }
        }
      }
    ])).toMatchObject({
      provider: "shopping/costco",
      reasonCode: "env_limited",
      summary: "Costco requires manual browser follow-up; this run did not determine whether login or page rendering is required.",
      guidance: {
        reason: "Costco needs a live browser-rendered page before retrying.",
        recommendedNextCommands: [
          "Retry with browser assistance or a headed browser session.",
          "Rerun the same provider or workflow after the rendered page is ready."
        ]
      }
    });

    expect(readProviderIssueHint({
      details: {
        browserRequired: true,
        providerShell: "unknown_shell",
        message: "A live browser is still required for this result page."
      }
    })).toEqual({
      reasonCode: "env_limited",
      blockerType: "env_limited",
      constraint: {
        kind: "render_required",
        evidenceCode: "unknown_shell",
        providerShell: "unknown_shell",
        message: "A live browser is still required for this result page."
      }
    });
  });

  it("builds auth, challenge, and preserved-session guidance from issue details", () => {
    expect(buildProviderIssueGuidance({
      provider: "social/linkedin",
      hint: {
        reasonCode: "token_required",
        constraint: {
          kind: "session_required",
          evidenceCode: "auth_required"
        }
      }
    })).toEqual({
      reason: "Linkedin needs an authenticated session before retrying.",
      recommendedNextCommands: [
        "Reuse an authenticated browser session, import logged-in cookies, or use the provider sign-in flow.",
        "Rerun the same provider or workflow once the session is active."
      ]
    });

    expect(buildProviderIssueGuidance({
      provider: "shopping/costco",
      hint: {
        reasonCode: "challenge_detected"
      },
      details: {
        preservedSessionId: "session-1"
      }
    })).toEqual({
      reason: "Costco preserved browser state that can complete the current challenge.",
      recommendedNextCommands: [
        "Finish the login or anti-bot challenge in the preserved browser session.",
        "Rerun the same provider or workflow after the page unlocks."
      ]
    });

    expect(buildProviderIssueGuidance({
      provider: "social/x",
      hint: {
        reasonCode: "env_limited",
        constraint: {
          kind: "render_required",
          evidenceCode: "social_js_required_shell"
        }
      },
      details: {
        disposition: "completed"
      }
    })).toBeUndefined();
  });

  it("reads fallback detail reason codes and supports browser-required constraints without messages", () => {
    expect(readProviderIssueHint({
      reasonCode: "not-a-real-code",
      details: {
        reasonCode: "env_limited",
        blockerType: "env_limited"
      }
    })).toEqual({
      reasonCode: "env_limited",
      blockerType: "env_limited"
    });

    expect(classifyProviderIssue({
      browserRequired: true
    })).toEqual({
      reasonCode: "env_limited",
      blockerType: "env_limited",
      constraint: {
        kind: "render_required",
        evidenceCode: "env_limited"
      }
    });
  });
});
