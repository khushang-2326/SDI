# SDI Lead Auto Submitter

SDI is a local-first Next.js application that imports approved target websites,
discovers contact or booking forms, and runs dry-run or live Playwright automation.
Bulk Excel runs are processed by a separate BullMQ worker so browser work does not
block the website process.

## Local requirements

- Node.js 20 or newer
- Playwright Chromium, Google Chrome, or Microsoft Edge

SQLite stores application data and, by default, the local background queue. Redis
is optional and is intended only for a later multi-machine deployment.

## First-time setup

```powershell
npm install
npm run prisma:generate
npm run prisma:migrate
npx.cmd playwright install chromium
```

Copy `.env.example` to `.env` and replace `AUTH_SECRET` with a long random value.
The local defaults are tuned for a 10-URL demonstration:

```env
REDIS_URL="redis://localhost:6379"
QUEUE_PROVIDER="local"
WORKER_CONCURRENCY="1"
MAX_RETRIES="3"
AUTOMATION_TIMEOUT="45000"
STORAGE_PROVIDER="local"
```

## Production-mode local demo

Run the web application in the first terminal:

```powershell
npm run build
npm start
```

For the default `QUEUE_PROVIDER="local"` mode, the web application processes its
SQLite queue automatically; no second terminal or Redis server is required.

For optional Redis/BullMQ mode, run the queue worker in a second terminal:

```powershell
npm run worker:redis
```

Open <http://localhost:3000>. Use dry-run mode for the first pass. Enable live
submission only for websites you own or have permission to test.

## Validation

```powershell
npm run typecheck
npm run lint
npm run build
```

To use BullMQ, set `QUEUE_PROVIDER="redis"`, start Redis, and run
`npm run worker:redis`.
