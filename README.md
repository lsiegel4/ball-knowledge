# Ball Knowledge

NBA knowledge game with two formats:

- **Daily Challenge** — name a modern-era (1980–present) NBA player; the least-picked player wins. Resets daily.
- **Live Head-to-Head** — best-of-7; both players get the same machine-verifiable category and pick a valid player in 60s. The less popular (lower pick-rate) answer wins the point.

## Architecture

Serverless on AWS: React SPA (S3 + CloudFront) → API Gateway (REST + WebSocket) → Lambda → DynamoDB, with Cognito for auth. An offline Python pipeline (`services/pipeline`) ingests NBA stats and precomputes player/category content.

See the full plan: `~/.claude/plans/i-want-to-create-woolly-summit.md`.

## Monorepo layout (npm workspaces)

```
packages/shared/    @ball/shared  — API contract types shared by frontend + backend
packages/scoring/   @ball/scoring — game rules (daily tally, H2H resolution)
services/api/       REST Lambda handlers
services/realtime/  WebSocket Lambda handlers
services/tally/     daily reset/tally job
services/pipeline/  Python: NBA ingest + category generation
frontend/           React SPA (Vite + TS)
infra/              AWS CDK (TypeScript)
```

## Getting started

```bash
npm install        # links all workspaces together
npm run build      # build every workspace
npm test           # test every workspace
```

Requires Node 20+, Python 3, and (for deploys) the AWS CLI + CDK.
