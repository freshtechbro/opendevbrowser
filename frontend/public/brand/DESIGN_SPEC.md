# OpenDevBrowser Visual Identity Design Specification

## Project Overview

**Project Name:** OpenDevBrowser  
**Version:** 0.0.15  
**Purpose:** AI-powered browser automation runtime for OpenCode agents  
**Core Concept:** "Script-first browser automation" — Snapshot → Refs → Actions  

---

## VISUAL IDENTITY LOCK

This section defines the **unchanging core elements** that must be identical across ALL assets. Every prompt must adhere to these specifications.

### LOCKED: Color System

| Role | Hex Code | Usage |
|------|----------|-------|
| **Primary Teal** | `#0D9488` | Main brand color, browser window frames, primary elements |
| **Accent Cyan** | `#06B6D4` | Highlights, connection lines, glow effects, workflow dots |
| **Deep Navy** | `#0F172A` | Dark backgrounds, shadows, text on light |
| **Pure White** | `#FFFFFF` | Light backgrounds, text on dark |
| **Glow Cyan** | `#22D3EE` | Soft glows, halos (40% opacity max) |

**LOCKED Gradient Formula (use exact wording in all prompts):**
```
Gradient: Deep teal (#0D9488) → Electric cyan (#06B6D4) at 135° angle
Glow: Soft cyan (#22D3EE) at 40% opacity
Background: Pure white (#FFFFFF) or Deep navy (#0F172A)
```

### LOCKED: Core Visual Element (The "Browser Node")

Every asset must include this **unified symbol** representing OpenDevBrowser:

**The Browser Node consists of:**
1. **Browser Window Frame** — Rounded rectangle with 3px corner radius, subtle 3D depth (1-2px shadow)
2. **Three Dots** — Horizontal alignment inside the window, representing snapshot→refs→actions workflow
   - Dot 1: Solid teal (#0D9488) — "Snapshot"
   - Dot 2: Solid cyan (#06B6D4) — "Refs"
   - Dot 3: Outlined cyan (#06B6D4) — "Actions"
3. **Connection Lines** — Two glowing lines extending from window corners (bottom-left and bottom-right), suggesting CDP protocol/relay
4. **Subtle Glow** — Soft cyan (#22D3EE) halo around the entire element at 40% opacity

**Standard Composition:**
- Element positioned according to asset requirements
- Clean geometric style, no photorealism
- Flat design with subtle elevation (macOS Big Sur aesthetic)
- Transparent or solid background as specified

### LOCKED: Typography

**Primary Font:** Geometric sans-serif (Inter, SF Pro, or similar)
- Weight: Semibold (600) for headings
- Weight: Regular (400) for body
- Style: Clean, technical, no serifs

### LOCKED: Style Keywords (Use in EVERY prompt)

```
Style: Clean geometric minimalism, modern tech aesthetic, subtle 3D elevation (1-2px soft shadow), macOS Big Sur icon style, flat design with depth, vector-art style, professional developer tool branding
Effects: Subtle glow (cyan #22D3EE at 40% opacity), gradient fill (teal #0D9488 → cyan #06B6D4 at 135°)
Quality: High contrast, scalable, transparent background (unless specified solid)
```

---

## Brand Identity Foundation

### Brand Pillars

1. **Precision & Control** — Exact, deterministic browser automation
2. **Developer-First** — CLI-first, code-native workflow
3. **AI-Native** — Built for AI agent workflows (snapshot/refs/actions)
4. **Security-First** — Defense-in-depth protection
5. **Versatility** — Three modes: Managed, CDP Connect, Extension Relay

### Visual Metaphors (Unified)

- **The Browser Node** — Primary symbol combining browser + workflow + connection
- **Connection Lines** — CDP protocol, WebSocket relay, network flow
- **Three Dots** — Snapshot → Refs → Actions workflow
- **Glow Effects** — Active connection, AI presence, energy

---

## Asset Inventory & Unified Prompts

### 1. Primary Logo (Wordmark)

**Files:**
- `assets/logo-primary.svg` (source)
- `assets/logo-primary.png` (512px)
- `assets/logo-dark.png` (for dark backgrounds)
- `assets/logo-light.png` (for light backgrounds)

**Visual Concept:**
Wordmark "OpenDevBrowser" with the "Browser Node" icon integrated as the letter "O" or positioned as a standalone mark to the left.

**UNIFIED PROMPT:**
```
Create a modern tech company logo for "OpenDevBrowser". 

COMPOSITION:
- Wordmark "OpenDevBrowser" in clean geometric sans-serif, semibold weight
- The "Browser Node" icon replaces the letter "O" in "Open" OR appears as a standalone mark to the left of text
- Text color: Deep navy (#0F172A) on light backgrounds, Pure white (#FFFFFF) on dark

BROWSER NODE SPECIFICATION (integrated as "O"):
- Rounded square browser window frame (corner radius 3px) with subtle 3D elevation (1-2px soft shadow)
- Three horizontal dots inside: Dot1 solid teal (#0D9488), Dot2 solid cyan (#06B6D4), Dot3 outlined cyan (#06B6D4)
- Two glowing connection lines extending diagonally from bottom corners, fading outward
- Gradient fill on frame: Deep teal (#0D9488) → Electric cyan (#06B6D4) at 135° angle
- Subtle cyan glow (#22D3EE at 40% opacity) around the entire node

STYLE:
Clean geometric minimalism, modern tech aesthetic, subtle 3D elevation (1-2px soft shadow), macOS Big Sur icon style, flat design with depth, vector-art style, professional developer tool branding. High contrast, scalable from 16px to 2048px. Transparent background.

VARIATIONS NEEDED:
1. Horizontal layout (icon left of text) - light background
2. Horizontal layout (icon left of text) - dark background  
3. Compact layout (icon as "O" in wordmark) - light background
4. Compact layout (icon as "O" in wordmark) - dark background
```

---

### 2. App Icon Set (Square)

**Files:**
- `assets/icon-16.png` — Favicon
- `assets/icon-32.png` — Small app icon
- `assets/icon-48.png` — Extension small
- `assets/icon-128.png` — Extension primary / macOS
- `assets/icon-256.png` — Large icon
- `assets/icon-512.png` — App Store
- `assets/icon-1024.png` — App Store retina
- `assets/icon-source.svg` — Master vector file

**Visual Concept:**
The "Browser Node" as a standalone app icon, optimized for various sizes while maintaining recognizability.

**UNIFIED PROMPT:**
```
Create a modern app icon featuring the "Browser Node" symbol.

COMPOSITION:
- Centered "Browser Node" on transparent or appropriate background
- Icon shape: Rounded square with macOS Big Sur corner styling

BROWSER NODE SPECIFICATION:
- Rounded square browser window frame (corner radius 3px) with subtle 3D elevation (1-2px soft shadow)
- Three horizontal dots inside: Dot1 solid teal (#0D9488), Dot2 solid cyan (#06B6D4), Dot3 outlined cyan (#06B6D4)
- Two glowing connection lines extending diagonally from bottom corners, fading outward
- Gradient fill on frame: Deep teal (#0D9488) → Electric cyan (#06B6D4) at 135° angle
- Subtle cyan glow (#22D3EE at 40% opacity) around the entire node

STYLE:
Clean geometric minimalism, modern tech aesthetic, subtle 3D elevation (1-2px soft shadow), macOS Big Sur icon style, flat design with depth, vector-art style, professional developer tool branding. High contrast, scalable from 16px to 1024px.

SIZE-SPECIFIC NOTES:
- At 16px: Simplify to solid teal square with cyan dot center (minimal recognizable mark)
- At 32px: Show frame + single cyan dot
- At 48px+: Full Browser Node with all three dots and connection lines
- At 128px+: Include subtle texture/depth details
- At 512px+: Full detail with refined gradients and shadows
```

---

### 3. Chrome Extension Icons

**Files:**
- `extension/icons/icon16.png` — Toolbar (simplified)
- `extension/icons/icon32.png` — Toolbar retina (simplified)
- `extension/icons/icon48.png` — Management page
- `extension/icons/icon128.png` — Chrome Web Store

**Visual Concept:**
Simplified "Browser Node" optimized for small sizes and Chrome toolbar visibility. Emphasis on instant recognizability and connection state.

**UNIFIED PROMPT:**
```
Create a Chrome extension icon featuring a simplified "Browser Node" symbol optimized for toolbar visibility.

COMPOSITION:
- Centered simplified "Browser Node" 
- Format: Square PNG, optimized for 16px-128px

BROWSER NODE SPECIFICATION (Simplified):
- Rounded square browser window frame (corner radius 2px at small sizes, 3px at 128px)
- At 16px/32px: Solid teal (#0D9488) frame with single bright cyan (#06B6D4) dot center, no connection lines
- At 48px/128px: Frame with three dots (teal, cyan, outlined cyan) + two subtle connection lines extending from bottom corners
- Gradient fill on frame: Deep teal (#0D9488) → Electric cyan (#06B6D4) at 135° angle
- Subtle cyan glow (#22D3EE at 40% opacity) suggesting active connection state

STYLE:
Clean geometric minimalism, modern tech aesthetic, subtle 3D elevation (1-2px soft shadow), macOS Big Sur icon style, flat design with depth, vector-art style, professional developer tool branding. Ultra-high contrast for toolbar visibility, instant recognition at 16px.

SIZE REQUIREMENTS:
- 16px: Minimal mark - teal rounded square, cyan dot center
- 32px: Slightly more detail - teal frame visible, cyan dot prominent
- 48px: Full Browser Node with simplified connection lines
- 128px: Full Browser Node with full detail for Chrome Web Store
```

---

### 4. Social / Open Graph Image

**File:** `assets/social-og.png`  
**Size:** 1200×630px  
**Format:** PNG

**Visual Concept:**
Marketing-focused composition with Browser Node prominently featured alongside wordmark and tagline.

**UNIFIED PROMPT:**
```
Create a professional Open Graph social media image (1200x630px) for "OpenDevBrowser".

COMPOSITION:
- Left 40%: Large "Browser Node" icon (30% of canvas height) with subtle glow
- Right 60%: Wordmark "OpenDevBrowser" in bold geometric sans-serif, semibold weight, deep navy (#0F172A)
- Below wordmark: Tagline "Script-first browser automation for AI agents" in regular weight, smaller size, muted navy
- Background: Pure white (#FFFFFF) with subtle geometric pattern of faint browser window outlines and connection nodes in very light gray

BROWSER NODE SPECIFICATION:
- Large scale (prominent but not overwhelming)
- Rounded square browser window frame (corner radius 3px) with subtle 3D elevation (1-2px soft shadow)
- Three horizontal dots inside: Dot1 solid teal (#0D9488), Dot2 solid cyan (#06B6D4), Dot3 outlined cyan (#06B6D4)
- Two glowing connection lines extending diagonally from bottom corners, fading outward into background pattern
- Gradient fill on frame: Deep teal (#0D9488) → Electric cyan (#06B6D4) at 135° angle
- Strong cyan glow (#22D3EE at 60% opacity) making it pop against white background

STYLE:
Clean geometric minimalism, modern tech aesthetic, subtle 3D elevation (1-2px soft shadow), flat design with depth, professional developer tool branding. Generous whitespace, high readability, works as social media preview. Professional marketing aesthetic.

TEXT SPECIFICATIONS:
- Headline: "OpenDevBrowser" — Semibold, 72px equivalent, Deep navy (#0F172A)
- Tagline: "Script-first browser automation for AI agents" — Regular, 32px equivalent, Slate gray (#64748B)
```

---

### 5. GitHub Repository Social Preview

**File:** `assets/github-social.png`  
**Size:** 1280×640px  
**Format:** PNG

**Visual Concept:**
Dark-mode optimized for GitHub with centered composition and glowing effects.

**UNIFIED PROMPT:**
```
Create a GitHub repository social preview image (1280x640px) for "OpenDevBrowser" optimized for dark mode.

COMPOSITION:
- Centered layout
- Top: "Browser Node" icon at 25% of canvas height
- Middle: Wordmark "OpenDevBrowser" in bold geometric sans-serif, semibold weight, pure white (#FFFFFF)
- Bottom: Tagline "Script-first browser automation for AI agents" in regular weight, smaller size, light cyan (#22D3EE)
- Background: Deep navy (#0F172A) with subtle abstract pattern of faint connection lines and nodes in slightly lighter navy (#1E293B)

BROWSER NODE SPECIFICATION:
- Centered, prominent position
- Rounded square browser window frame (corner radius 3px) with subtle 3D elevation (1-2px soft shadow)
- Three horizontal dots inside: Dot1 solid teal (#0D9488), Dot2 solid cyan (#06B6D4), Dot3 outlined cyan (#06B6D4)
- Two glowing connection lines extending diagonally from bottom corners, fading outward
- Gradient fill on frame: Deep teal (#0D9488) → Electric cyan (#06B6D4) at 135° angle
- Strong cyan glow (#22D3EE at 60% opacity) creating halo effect against dark background

STYLE:
Clean geometric minimalism, modern tech aesthetic, subtle 3D elevation (1-2px soft shadow), flat design with depth, professional developer tool branding. Dark-mode optimized, high contrast, works on GitHub's interface. Open-source aesthetic with professional polish.

TEXT SPECIFICATIONS:
- Headline: "OpenDevBrowser" — Semibold, 84px equivalent, Pure white (#FFFFFF)
- Tagline: "Script-first browser automation for AI agents" — Regular, 36px equivalent, Light cyan (#22D3EE)
```

---

### 6. Hero / Documentation Header Image

**File:** `assets/hero-image.png`  
**Size:** 1920×1080px (16:9)  
**Format:** PNG

**Visual Concept:**
Dramatic hero composition showing multiple Browser Nodes in a workflow/connection pattern, suggesting the full automation ecosystem.

**UNIFIED PROMPT:**
```
Create a hero banner image (1920x1080px) for OpenDevBrowser documentation and marketing.

COMPOSITION:
- Isometric or slightly angled perspective showing 2-3 "Browser Nodes" floating in space
- Central node is largest and most prominent (representing primary session)
- Secondary nodes are smaller, positioned at 120° angles around central node
- Glowing connection lines link the nodes in a triangular pattern (suggesting relay/network)
- Subtle code/command line elements in background (suggesting CLI/scripting)
- Background: Deep navy (#0F172A) with very subtle gradient to slightly lighter navy at bottom

BROWSER NODE SPECIFICATION (apply to all nodes, vary size):
- Rounded square browser window frame (corner radius 3px) with subtle 3D elevation (2-3px soft shadow for depth)
- Three horizontal dots inside: Dot1 solid teal (#0D9488), Dot2 solid cyan (#06B6D4), Dot3 outlined cyan (#06B6D4)
- Two glowing connection lines extending from bottom corners linking to other nodes
- Gradient fill on frame: Deep teal (#0D9488) → Electric cyan (#06B6D4) at 135° angle
- Strong cyan glow (#22D3EE at 50% opacity) with bloom effect

CONNECTION PATTERN:
- Cyan (#06B6D4) lines connecting nodes in triangular formation
- Animated suggestion: pulsing data packets traveling along lines (static representation)
- Lines have gradient: bright cyan at source, fading to transparent at distance

STYLE:
Clean geometric minimalism, modern tech aesthetic, subtle 3D elevation, flat design with depth, professional developer tool branding, cinematic composition. Depth of field effect: central node sharp, background elements slightly softer. Dramatic lighting, futuristic but professional. Suitable for documentation hero, landing page header, presentation slides.

ACCENT ELEMENTS:
- Subtle floating code snippets or terminal commands in background (low opacity, monochrome)
- Faint grid pattern suggesting structure/order
- Light rays or glow emanating from central node (very subtle)
```

---

### 7. Favicon Variants

**Files:**
- `assets/favicon.ico` — Multi-resolution ICO file
- `assets/favicon-16x16.png` — Browser tab
- `assets/favicon-32x32.png` — Browser tab retina
- `assets/favicon.svg` — Scalable vector

**Visual Concept:**
Minimalist mark that works at 16px while remaining recognizable.

**UNIFIED PROMPT:**
```
Create favicon assets for OpenDevBrowser featuring a minimal "Browser Node" mark.

COMPOSITION:
- Minimalist symbol optimized for 16x16px visibility
- Clear silhouette that reads instantly at small sizes

BROWSER NODE SPECIFICATION (Minimal):
- At 16x16: Solid teal (#0D9488) rounded square with single bright cyan (#06B6D4) dot in center
- At 32x32: Slight frame visible around dot, teal frame with cyan center
- At SVG: Full Browser Node detail (frame + three dots + connection lines) but compact

STYLE:
Clean geometric minimalism, modern tech aesthetic, ultra-high contrast, instant recognition. Solid colors for small sizes, transparent background for SVG.

TECHNICAL REQUIREMENTS:
- favicon.ico: Multi-resolution containing 16x16, 32x32, 48x48
- PNGs: Transparent background
- SVG: Full detail, scalable, transparent background
```

---

## Prompt Consistency Checklist

Before generating any asset, verify the prompt contains:

- [ ] **Color Codes**: All four hex codes (#0D9488, #06B6D4, #0F172A, #FFFFFF, #22D3EE)
- [ ] **Browser Node Spec**: Frame + three dots + connection lines described
- [ ] **Gradient Direction**: 135° angle specified
- [ ] **Glow Spec**: 40-60% opacity cyan (#22D3EE) mentioned
- [ ] **Style Keywords**: "Clean geometric minimalism", "modern tech", "subtle 3D elevation"
- [ ] **Corner Radius**: 3px for main elements, 2px for tiny sizes
- [ ] **Shadow Spec**: 1-2px soft shadow (2-3px for hero depth)
- [ ] **Background**: Specified (transparent, white, or navy)
- [ ] **Size Context**: Appropriate for target dimensions

---

## Technical Specifications

### File Naming Convention

```
assets/
├── logo-primary.svg              # Main wordmark logo (vector)
├── logo-primary.png              # Main logo raster (512px)
├── logo-dark.png                 # For dark backgrounds
├── logo-light.png                # For light backgrounds
├── icon-16.png                   # Favicon
├── icon-32.png                   # Small app icon
├── icon-48.png                   # Extension small
├── icon-128.png                  # Extension primary / macOS
├── icon-256.png                  # Large icon
├── icon-512.png                  # App Store
├── icon-1024.png                 # App Store retina
├── icon-source.svg               # Master icon file
├── favicon.ico                   # Multi-resolution favicon
├── favicon-16x16.png
├── favicon-32x32.png
├── favicon.svg
├── social-og.png                 # Open Graph (1200x630)
├── github-social.png             # GitHub preview (1280x640)
├── hero-image.png                # Documentation hero (1920x1080)
└── extension-icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

### Export Guidelines

**PNG Export:**
- Color space: sRGB
- Bit depth: 8-bit (icons), 16-bit (hero/illustrations)
- Compression: Optimized for web
- Transparency: Enabled for icons, disabled for hero/social where specified

**SVG Export:**
- Format: SVG 1.1
- Fonts: Converted to outlines
- Effects: Simplified for compatibility

### Platform Requirements

**Chrome Extension:**
- Square PNG only
- Sizes: 16, 32, 48, 128px
- No transparency for store icon (128px with solid background)

**macOS/iOS:**
- Use icon-1024.png for App Store
- Rounded corners applied by system

**GitHub:**
- Social preview: 1280×640px
- Repository logo: Any size, displayed small

---

## Generation Sequence

### Phase 1: Core Identity (Start Here)
1. **Browser Node Master** — Generate the core symbol at 512px
2. **Logo Horizontal Light** — Icon left of wordmark, white background
3. **Logo Horizontal Dark** — Icon left of wordmark, navy background
4. Review and lock the Browser Node design

### Phase 2: Icon System
5. **Icon 1024px** — Full detail master
6. **Icon 512px** — Scale down from master
7. **Icon 128px** — Extension/Chrome Web Store
8. **Extension Icons** — 16, 32, 48, 128px simplified variants
9. **Favicon Set** — 16, 32px minimal variants + SVG

### Phase 3: Marketing Assets
10. **Social OG** — 1200×630px, light background
11. **GitHub Social** — 1280×640px, dark background
12. **Hero Image** — 1920×1080px, dramatic composition

### Phase 4: Implementation
13. Export all sizes from masters
14. Replace existing assets in codebase
15. Update README, extension manifest, documentation
16. Create brand guidelines document

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-17 | Atlas (Orchestrator) | Initial design spec with unified visual identity |

---

## Approval Status

**Visual Identity Lock:**
- [ ] Color palette approved (#0D9488, #06B6D4, #0F172A, #FFFFFF, #22D3EE)
- [ ] Browser Node concept approved (frame + 3 dots + connections)
- [ ] Typography direction approved (geometric sans-serif)
- [ ] Style keywords approved (geometric minimalism, subtle 3D)

**Asset Prompts:**
- [ ] Primary Logo prompt approved
- [ ] App Icon Set prompt approved
- [ ] Extension Icons prompt approved
- [ ] Social OG prompt approved
- [ ] GitHub Social prompt approved
- [ ] Hero Image prompt approved
- [ ] Favicon prompt approved

**Generation Ready:**
- [ ] All prompts contain consistency checklist items
- [ ] File naming convention approved
- [ ] Generation sequence approved

---

*This specification uses a locked visual identity system to ensure 100% consistency across all OpenDevBrowser assets. Every prompt references the same core elements: the Browser Node symbol, exact color codes, gradient formulas, and style descriptors.*
