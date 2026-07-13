# PassionFlow

**PassionFlow** turns photos from a build, repair, collection, artwork, or experiment into a clear project story: an editable photo plan, a share-ready graphic, and an editor-ready local handoff. It is a fresh project created for the DEV Weekend Challenge: Passion Edition.

## What it does

1. **Gather locally** — add photos, screenshots, or a PDF first page; originals stay untouched.
2. **Shape deliberately** — after an explicit consent step, Gemini produces an editable structured photo plan: photo roles, quality cautions, non-destructive edit instructions, share concepts, and alt text.
3. **Make it shareable** — edit the suggested copy and render a PNG share card in the browser.
4. **Hand it off** — download a ZIP or write a package to a user-selected local folder in compatible browsers. The package includes selected sources, the final PNG, caption, photo plan, and deterministic manifest.
5. **Optionally prove the handoff** — after local export, a connected browser wallet can authorize one **Solana Devnet** signed Memo receipt containing only hashes, a public address, format version, and timestamp. No image, prompt, caption, project name, or private key is sent on-chain.

## Run locally

```bash
npm install
npm run build
```

The React client runs on Vite and proxies `/api` to the server:

```bash
# Terminal 1: local-only Gemini development mode
PASSIONFLOW_ALLOW_SERVER_GEMINI=local-development
GEMINI_API_KEY=your-local-development-key
npm run server

# Terminal 2: development client
npm run dev
```

The server listens on `http://localhost:8787`; Vite defaults to `http://localhost:5173`.

## Gemini key ownership

**Public deployments are bring-your-own-key.** A user enters their own Gemini API key in the app and it is sent only with that request. It remains in the active tab’s memory and is not written to local storage, exports, source files, server logs, or a shared server-side store.

The server refuses to use a shared Gemini key unless its local-only `PASSIONFLOW_ALLOW_SERVER_GEMINI=local-development` switch is explicitly enabled. This lets the maintainer test locally without exposing a paid key to public users. The `.gitignore` excludes `.env` files and all client requests use `/api`; no `VITE_` API-key variable is used.

## Gemini boundary

The server uses the official `@google/genai` Interactions API with `gemini-3.5-flash`, `store: false`, schema-constrained JSON, and Zod validation. The UI asks for per-request consent before submitting selected images. Gemini suggestions remain editable and never modify originals.

References:

- [Gemini Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview)
- [Image understanding and structured output](https://ai.google.dev/gemini-api/docs/image-understanding)
- [API-key security guidance](https://ai.google.dev/gemini-api/docs/api-key)

## Solana Devnet receipt

The optional receipt uses the existing [Solana Memo program](https://github.com/solana-program/memo), not a token, marketplace, payment flow, or application wallet. The connected wallet signs a canonical `PF1` Memo payload containing:

```text
PF1|1|creatorPublicKey|finalImageSha256|manifestSha256|claimedUnixSeconds
```

A receipt proves that the connected public address authorized a successful Devnet transaction for that hash pair. It **does not** prove real-world authorship, copyright, originality, permanence, or financial value. Devnet is an experimental public test network and may be reset.

## Verification

```bash
npm test
npm run lint
npm run build
```

Focused tests cover deterministic selected-source manifest behavior and exact SHA-256 hashing. Browser smoke testing covers local intake, local share-card rendering, export confirmation, production static delivery, an explicit Gemini consent gate, and a live Gemini structured photo-plan response.
