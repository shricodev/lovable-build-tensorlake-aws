# Kiln

An AI app builder in the spirit of Lovable, Bolt.new and v0: describe an app, an agent writes it inside an isolated [Tensorlake](https://tensorlake.ai) sandbox, fixes its own errors, and shows a live preview. Iterate by chat, roll back any version, explore variants, publish.

> **Status:** Phase 1 (sandbox layer + warm base snapshot). See [docs/TENSORLAKE_NOTES.md](docs/TENSORLAKE_NOTES.md) for verified platform capabilities and [docs/DECISIONS.md](docs/DECISIONS.md) for design decisions.

## Local setup

```bash
pnpm install
cp .env.example .env        # then fill in TENSORLAKE_API_KEY + an LLM key, and AUTH_SECRET (openssl rand -base64 32)
pnpm infra:up               # postgres, minio, jaeger
pnpm s3:setup               # create + lock down the bucket
pnpm spike spikes/01-create-run.ts   # sanity-check Tensorlake access
pnpm sandbox:build-base     # build the warm base snapshot (~45 s, once per template change)
pnpm sandbox:bench -- --keep   # cold vs snapshot vs fork timings; leaves one preview running
```

Useful URLs: MinIO console http://localhost:9001 (kiln / kiln-dev-secret), Jaeger http://localhost:16686.

## Repository layout

| Path               | What                                                                   |
| ------------------ | ---------------------------------------------------------------------- |
| `apps/web`         | Next.js UI, auth, APIs, SSE, published-site serving                    |
| `apps/worker`      | pg-boss jobs: agent loop, heal loop, variants, export, publish, reaper |
| `apps/gateway`     | preview reverse proxy (HTTP + WebSocket), wake-on-request              |
| `packages/sandbox` | the only code that talks to Tensorlake                                 |
| `packages/llm`     | Anthropic / OpenAI / Ollama behind one interface                       |
| `packages/db`      | Drizzle schema, migrations, queries                                    |
| `packages/storage` | the only code that talks to S3                                         |
| `packages/shared`  | env validation, logging, errors, retry                                 |
| `spikes/`          | Phase 0 capability proofs against real Tensorlake                      |
| `infra/`           | docker compose, S3 setup + IAM policy, sandbox image                   |

## Storage layout (one private bucket)

| Prefix                                | Contents                             |
| ------------------------------------- | ------------------------------------ |
| `exports/<project>/<id>.zip`          | source exports (expire after 7 days) |
| `screenshots/<project>/<version>.png` | version thumbnails                   |
| `published/<slug>/<version>/…`        | published static builds              |
| `evals/<run-id>/…`                    | eval reports                         |
| `uploads/<user>/<id>`                 | prompt image attachments             |

## Real S3 setup

1. Create an IAM user (or role) for the app and attach [`infra/s3/iam-policy.json`](infra/s3/iam-policy.json) with `KILN_BUCKET_NAME` replaced. It grants object read/write/delete and list on that one bucket only.
2. For the one-time bootstrap, temporarily also attach [`infra/s3/iam-policy-setup.json`](infra/s3/iam-policy-setup.json) (create bucket, public-access block, lifecycle, CORS), run `pnpm s3:setup`, then detach it.
3. In `.env`: remove `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE`, set `S3_BUCKET`, `S3_REGION`, and the key pair.

The bucket stays private (all four public-access blocks on). Browsers only ever get short-lived presigned URLs.
