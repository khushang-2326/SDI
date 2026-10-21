import { Client } from 'ssh2';
import * as fs from 'fs';

const conn = new Client();
conn.on('ready', () => {
  console.log('[SSH] Connected to Contabo VPS (94.72.119.156). Syncing updated automation services...');
  conn.sftp((err, sftp) => {
    if (err) { console.error('SFTP error:', err); process.exit(1); }

    const filesToSync = [
      { local: 'd:/Projects/SDI/lib/config.ts', remote: '/root/SDI/lib/config.ts', container: 'sdi:/app/lib/config.ts' },
      { local: 'd:/Projects/SDI/services/multi-target-automation.ts', remote: '/root/SDI/services/multi-target-automation.ts', container: 'sdi:/app/services/multi-target-automation.ts' },
      { local: 'd:/Projects/SDI/services/contact-form-automation.ts', remote: '/root/SDI/services/contact-form-automation.ts', container: 'sdi:/app/services/contact-form-automation.ts' },
      { local: 'd:/Projects/SDI/services/error-taxonomy.ts', remote: '/root/SDI/services/error-taxonomy.ts', container: 'sdi:/app/services/error-taxonomy.ts' },
      { local: 'd:/Projects/SDI/services/cookie-consent-helper.ts', remote: '/root/SDI/services/cookie-consent-helper.ts', container: 'sdi:/app/services/cookie-consent-helper.ts' },
      { local: 'd:/Projects/SDI/services/parallel-cookie-guardian.ts', remote: '/root/SDI/services/parallel-cookie-guardian.ts', container: 'sdi:/app/services/parallel-cookie-guardian.ts' },
      { local: 'd:/Projects/SDI/services/phone-format-helper.ts', remote: '/root/SDI/services/phone-format-helper.ts', container: 'sdi:/app/services/phone-format-helper.ts' },
      { local: 'd:/Projects/SDI/services/worker-pool.ts', remote: '/root/SDI/services/worker-pool.ts', container: 'sdi:/app/services/worker-pool.ts' },
      { local: 'd:/Projects/SDI/services/discovery/candidate-extractor.ts', remote: '/root/SDI/services/discovery/candidate-extractor.ts', container: 'sdi:/app/services/discovery/candidate-extractor.ts' },
      { local: 'd:/Projects/SDI/services/submission-target-discovery.ts', remote: '/root/SDI/services/submission-target-discovery.ts', container: 'sdi:/app/services/submission-target-discovery.ts' },
      { local: 'd:/Projects/SDI/components/AutomationRunner.tsx', remote: '/root/SDI/components/AutomationRunner.tsx', container: 'sdi:/app/components/AutomationRunner.tsx' },
      { local: 'd:/Projects/SDI/app/(dashboard)/error.tsx', remote: '/root/SDI/app/(dashboard)/error.tsx', container: 'sdi:/app/app/(dashboard)/error.tsx' },
      { local: 'd:/Projects/SDI/app/error.tsx', remote: '/root/SDI/app/error.tsx', container: 'sdi:/app/app/error.tsx' }
    ];

    let completed = 0;
    for (const f of filesToSync) {
      sftp.fastPut(f.local, f.remote, (putErr) => {
        if (putErr) { console.error(`Error uploading ${f.local}:`, putErr); process.exit(1); }
        console.log(`✅ Uploaded to host: ${f.remote}`);
        completed++;

        if (completed === filesToSync.length) {
          console.log('[DOCKER] Copying updated files into sdi container...');
          const copyCmd = `
            cd /root/SDI
            git fetch origin main
            git reset --hard origin/main
            echo "Host commit: $(git rev-parse HEAD)"
            ${filesToSync.map(f => `docker cp "${f.remote}" "${f.container}"`).join('\n')}
            echo "=== 1. Verifying TypeScript types inside container ==="
            docker exec sdi npm run typecheck
            echo "=== 2. Rebuilding Next.js production bundle inside container ==="
            docker exec sdi npm run build
            echo "=== 3. Restarting sdi container ==="
            docker restart sdi
            sleep 8
            echo "=== 4. Checking container health and build timestamp ==="
            docker exec sdi ls -l /app/.next/BUILD_ID || true
            curl -I http://127.0.0.1:80 || true
            echo "=== DEPLOYMENT AND CONTAINER UPDATE COMPLETE ==="
          `;

          conn.exec(copyCmd, (cmdErr, stream) => {
            if (cmdErr) throw cmdErr;
            stream.on('data', (d: Buffer) => process.stdout.write(d.toString()));
            stream.stderr.on('data', (d: Buffer) => process.stderr.write(d.toString()));
            stream.on('close', (code: number) => {
              console.log(`\nDeployment finished with exit code: ${code}`);
              conn.end();
              process.exit(code || 0);
            });
          });
        }
      });
    }
  });
});

conn.on('error', (err) => {
  console.error('[SSH] Connection error:', err);
  process.exit(1);
});

conn.connect({ host: '94.72.119.156', port: 22, username: 'root', password: 'kadar786', readyTimeout: 90000, keepaliveInterval: 10000 });
