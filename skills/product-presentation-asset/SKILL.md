---
name: product-presentation-asset
description: Collects product screenshots, images, copy, and metadata into a local folder pack for video workflows.
version: 1.0.0
---

# Product Presentation Asset Skill

Use this skill when creating UGC/product-video input packs from a product URL or product name.

## Triggers
- "build product asset pack"
- "collect product images and copy"
- "video generation assets"

## Workflow
1. Resolve product URL (direct URL or shopping lookup by name).
2. Fetch product details and price timestamp.
3. Capture screenshot and collect images.
4. Write folder pack with manifest + metadata files.

## Command
```bash
opendevbrowser product-video run --product-url "https://example.com/product"
```
