---
title: "PassionFlow: A Photo Workflow for the Projects You Care Enough to Share"
published: false
description: "A local-first, bring-your-own-key photo workflow that turns a project shoot into an editable plan, share card, and editor-ready package."
tags: weekendchallenge, gemini, solana, webdev
---

# PassionFlow: A Photo Workflow for the Projects You Care Enough to Share

People put real time into repairs, builds, gardens, collections, art, and experiments. The photos usually stay scattered until it is time to explain what happened, find the best shots, clean them up, or share the result.

**PassionFlow** turns that raw project shoot into an intentional handoff without taking control of the originals.

![PassionFlow project workflow](https://raw.githubusercontent.com/CleanDev-Fix/passionflow-weekend-20260712/master/public/passionflow-workflow.png)

## What it does

1. **Gather locally** — add project photos, screenshots, or a PDF first page. Originals remain untouched.
2. **Describe the intended result** — say what should change and what must stay true, such as labels, wear, colour, or the object’s shape.
3. **Create an editable photo plan** — Gemini returns photo roles, quality cautions, non-destructive edit instructions, share ideas, and accessible alt text.
4. **Choose the next edit path** — create an optional AI derivative, send the approved queue to a connected editor, save it into a user-selected local folder, or download a ZIP package.
5. **Make a project update** — render a share card locally, or use Meme Studio to generate a source visual and add precise caption text locally.
6. **Optionally prepare a Devnet creator receipt** — after a local handoff, a connected wallet may authorize a Solana Devnet Memo containing only hashes, a public address, version, and timestamp.

The product is intentionally not a marketplace, token launch tool, or cloud photo-storage system. Its core job is to get a project’s photos to the user’s next workflow reliably.

## Gemini: useful, bounded, and user-controlled

Gemini is the editorial brain, not an opaque chat box. It receives only the sources a person explicitly selects and returns a structured plan. The user can change the queue, override recommendations, keep an original, or reject an edit.

For public use, PassionFlow is **bring your own key**:

- A person enters their own Gemini API key in a masked field.
- The key is used only with that request.
- It stays in the active tab’s memory — not local storage, exports, project files, server logs, or shared server state.
- A public deployment refuses to spend a maintainer’s server-side Gemini key.

That keeps the app usable without turning a contest demo into an open-ended bill for its creator.

## Solana: optional provenance, not crypto theatre

A completed local handoff can optionally prepare a Devnet creator receipt using Solana’s existing Memo program. The signed `PF1` payload contains a public wallet address, final-image hash, manifest hash, format version, and timestamp.

It does **not** upload a photo, prompt, caption, project title, private key, or personal data on-chain. It is not a token, payment system, or ownership claim. The app works fully without it.

## Built with

- React + TypeScript + Vite
- Google Gen AI `@google/genai` Interactions API with schema-constrained output
- Zod validation for model responses and request payloads
- Browser File System Access API with ZIP fallback
- Browser Canvas rendering for share cards and captioned memes
- Solana Devnet Memo receipts

## Try it / inspect the code

Source: https://github.com/CleanDev-Fix/passionflow-weekend-20260712

```bash
npm install
npm run build
npm run server
```

For local development only, enable `PASSIONFLOW_ALLOW_SERVER_GEMINI=local-development` with a local `GEMINI_API_KEY`. Public users provide their own keys instead.

## Verification

- `npm test` — 4 focused tests passed.
- `npm run lint` — passed.
- `npm run build` — passed.
- Browser smoke test confirmed that public requests with no user-supplied key receive the expected fail-closed response and that the UI masks the transient key field.

Thanks to DEV and the sponsors for a challenge that made it fun to build a small tool for the things people care enough to make and share.
