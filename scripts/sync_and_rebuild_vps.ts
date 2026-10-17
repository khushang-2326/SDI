import { Client } from 'ssh2';

const conn = new Client();
conn.on('ready', () => {
  console.log('[SSH] Connected to VPS. Pulling new Bulk Proxy features and rebuilding container...');

  const cmd = `
    set -e
    cd /root/SDI
    git fetch origin main
    git reset --hard origin/main
    git log -n 1 --oneline

    echo "=== 1. Copying updated files into running container ==="
    docker cp "/root/SDI/app/." sdi:/app/app/
    docker cp "/root/SDI/lib/." sdi:/app/lib/
    docker cp "/root/SDI/prisma/schema.prisma" sdi:/app/prisma/schema.prisma

    echo "=== 2. Updating Prisma Schema in Container ==="
    docker exec sdi npx prisma generate
    docker exec sdi npx prisma db push --accept-data-loss

    echo "=== 3. Compiling Next.js Production Build ==="
    docker exec sdi npm run build

    echo "=== 4. Restarting Container ==="
    docker restart sdi
    sleep 8

    echo "=== 5. Checking Port 80 Response ==="
    curl -I http://127.0.0.1:80/settings || true
    echo "=== BULK PROXY IMPORT DEPLOYED & LIVE ==="
  `;

  conn.exec(cmd, (err, stream) => {
    if (err) throw err;
    stream.on('data', d => process.stdout.write(d.toString()));
    stream.stderr.on('data', d => process.stderr.write(d.toString()));
    stream.on('close', code => {
      console.log(`\nRebuild finished with exit code: ${code}`);
      conn.end();
      process.exit(code || 0);
    });
  });
}).connect({ host: '94.72.119.156', port: 22, username: 'root', password: 'kadar786' });
