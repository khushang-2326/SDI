import { Client } from 'ssh2';
import * as fs from 'fs';
import * as path from 'path';

const conn = new Client();
conn.on('ready', () => {
  console.log('[SSH] Connected to VPS. Syncing modified files...');
  
  conn.sftp((err, sftp) => {
    if (err) throw err;

    const filesToSync = [
      'services/proxy-helper.ts',
      'services/contact-form-automation.ts',
      'services/multi-target-automation.ts',
      'services/submission-target-discovery.ts',
      'app/(dashboard)/settings/page.tsx',
      'app/(dashboard)/settings/SettingsForm.tsx',
      'scripts/build_and_restart_sync.ts',
      'scripts/build_docker_image_vps.ts',
      'scripts/build_with_memory.ts',
      'scripts/exec_test_runner_vps.ts'
    ];

    let pending = filesToSync.length;
    for (const file of filesToSync) {
      const localPath = path.join(process.cwd(), file);
      const remotePath = `/root/SDI/${file.replace(/\\/g, '/')}`;
      const content = fs.readFileSync(localPath);
      
      sftp.writeFile(remotePath, content, (writeErr) => {
        if (writeErr) {
          console.error(`Failed to sync ${file}:`, writeErr);
        } else {
          console.log(`[SYNCED] ${file} -> ${remotePath}`);
        }
        pending--;
        if (pending === 0) {
          runBuild();
        }
      });
    }

    function runBuild() {
      console.log('[SSH] Rebuilding Docker image and restarting container sdi...');
      const cmd = `
        cd /root/SDI
        docker build -t sdi-app .
        docker stop sdi 2>/dev/null || true
        docker rm sdi 2>/dev/null || true
        docker run -d --name sdi -p 80:3000 --restart always sdi-app
        sleep 10
        docker ps
        docker exec sdi npx tsx scripts/test_proxy_smart_fallback.ts
      `;
      conn.exec(cmd, (execErr, stream) => {
        if (execErr) throw execErr;
        stream.on('data', (d: Buffer) => process.stdout.write(d.toString()));
        stream.stderr.on('data', (d: Buffer) => process.stderr.write(d.toString()));
        stream.on('close', (code: number | null) => {
          console.log(`\nDeployment finished with code: ${code}`);
          conn.end();
          process.exit(code || 0);
        });
      });
    }
  });
}).connect({ host: '207.244.246.116', port: 22, username: 'root', password: 'Kadar786' });
