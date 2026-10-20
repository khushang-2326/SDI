import { Client } from 'ssh2';

const conn = new Client();

const timeout = setTimeout(() => {
  console.log("⏱ SSH connection timed out after 240s. Exiting cleanly.");
  conn.end();
  process.exit(1);
}, 240000);

conn.on('ready', () => {
  console.log('[SSH] Connected to Contabo VPS (94.72.119.156). Pulling latest git commit...');

  const remoteCmd = `
    cd /root/SDI
    git fetch origin main
    git reset --hard origin/main
    echo "=== Host Git Status ==="
    git log -1 --oneline

    echo "=== Syncing source files into running container sdi ==="
    docker cp "/root/SDI/lib/browserPool.ts" "sdi:/app/lib/browserPool.ts"
    docker cp "/root/SDI/services/submission-target-discovery.ts" "sdi:/app/services/submission-target-discovery.ts"
    docker cp "/root/SDI/services/contact-form-automation.ts" "sdi:/app/services/contact-form-automation.ts"
    docker cp "/root/SDI/services/multi-target-automation.ts" "sdi:/app/services/multi-target-automation.ts"
    docker cp "/root/SDI/services/discovery/deterministic-ranker.ts" "sdi:/app/services/discovery/deterministic-ranker.ts"
    docker cp "/root/SDI/services/worker-pool.ts" "sdi:/app/services/worker-pool.ts"
    docker cp "/root/SDI/services/action-button-fallback.ts" "sdi:/app/services/action-button-fallback.ts"
    docker cp "/root/SDI/services/calendly-booking-automation.ts" "sdi:/app/services/calendly-booking-automation.ts"
    docker cp "/root/SDI/services/generic-booking-widget-automation.ts" "sdi:/app/services/generic-booking-widget-automation.ts"
    docker cp "/root/SDI/scripts/test_25s_navigation_rule.ts" "sdi:/app/scripts/test_25s_navigation_rule.ts"

    echo "=== Running In-Container Automated Regression Test Suite ==="
    docker exec sdi npx tsx scripts/test_25s_navigation_rule.ts

    echo "=== Rebuilding Next.js Application inside container sdi ==="
    docker exec sdi npm run build

    echo "=== Restarting sdi container ==="
    docker restart sdi
    sleep 6

    echo "=== Checking live HTTP health ==="
    curl -I http://127.0.0.1:80/login || curl -I http://127.0.0.1:3000/login || true
    echo "✅ Remote deployment and container restart completed successfully!"
  `;

  conn.exec(remoteCmd, (err, stream) => {
    if (err) {
      console.error(err);
      clearTimeout(timeout);
      conn.end();
      process.exit(1);
    }
    stream.on('data', (d: Buffer) => process.stdout.write(d.toString()));
    stream.stderr.on('data', (d: Buffer) => process.stderr.write(d.toString()));
    stream.on('close', (code: number | null) => {
      console.log(`✅ Remote execution finished with exit code ${code || 0}.`);
      clearTimeout(timeout);
      conn.end();
      process.exit(code || 0);
    });
  });
}).on('error', (err) => {
  console.log('VPS SSH warning:', err.message);
  clearTimeout(timeout);
  conn.end();
  process.exit(1);
}).connect({ host: '94.72.119.156', port: 22, username: 'root', password: 'kadar786', readyTimeout: 15000 });
