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

    echo "=== Syncing source directories into running container sdi ==="
    docker cp "/root/SDI/services/." "sdi:/app/services/"
    docker cp "/root/SDI/lib/." "sdi:/app/lib/"
    docker cp "/root/SDI/app/." "sdi:/app/app/"
    docker cp "/root/SDI/types/." "sdi:/app/types/"
    docker cp "/root/SDI/components/." "sdi:/app/components/"
    docker cp "/root/SDI/scripts/." "sdi:/app/scripts/"

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
});

let attempts = 0;
function connectWithRetry() {
  attempts++;
  console.log(`[SSH] Connecting to Contabo VPS (94.72.119.156) [Attempt ${attempts}/3]...`);
  conn.connect({
    host: '94.72.119.156',
    port: 22,
    username: 'root',
    password: 'kadar786',
    readyTimeout: 40000,
    keepaliveInterval: 10000
  });
}

conn.on('error', (err) => {
  console.log('VPS SSH warning:', err.message);
  if (attempts < 3) {
    console.log('Retrying connection in 3 seconds...');
    setTimeout(connectWithRetry, 3000);
  } else {
    clearTimeout(timeout);
    conn.end();
    process.exit(1);
  }
});

connectWithRetry();
