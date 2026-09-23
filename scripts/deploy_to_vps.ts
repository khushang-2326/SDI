import { Client } from 'ssh2';

const conn = new Client();

function executeRemoteCommand(client: Client, cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    client.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream.on('close', (code: number) => {
        if (code !== 0) {
          console.error(`Command failed with code ${code}: ${cmd}\nStderr: ${stderr}`);
          resolve(stdout + '\n' + stderr);
        } else {
          resolve(stdout);
        }
      });
      stream.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        process.stdout.write(text);
      });
      stream.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        process.stderr.write(text);
      });
    });
  });
}

async function main() {
  await new Promise<void>((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect({
      host: '207.244.246.116',
      port: 22,
      username: 'root',
      password: 'Kadar786'
    });
  });

  console.log('[SSH] Connected to VPS 207.244.246.116');

  // Check docker containers
  console.log('\n--- Checking Running Docker Containers ---');
  await executeRemoteCommand(conn, 'docker ps -a');

  // Check SDI directory
  console.log('\n--- Checking Git Status in SDI directory ---');
  await executeRemoteCommand(conn, 'cd /root/SDI || cd ~/SDI; git fetch origin main && git status');

  // Pull latest code
  console.log('\n--- Pulling latest main ---');
  await executeRemoteCommand(conn, 'cd /root/SDI || cd ~/SDI; git reset --hard origin/main && git pull origin main');

  // Build and restart docker container
  console.log('\n--- Rebuilding Docker container ---');
  await executeRemoteCommand(conn, 'cd /root/SDI || cd ~/SDI; docker build -t sdi-app .');

  console.log('\n--- Restarting sdi Container ---');
  // Find current running container command / environment
  await executeRemoteCommand(conn, 'docker stop sdi || true; docker rm sdi || true');
  await executeRemoteCommand(conn, 'docker run -d --name sdi -p 80:3000 --restart always --env-file /root/SDI/.env sdi-app || docker run -d --name sdi -p 80:3000 --restart always sdi-app');

  console.log('\n--- Waiting for Container to be Ready ---');
  await new Promise((r) => setTimeout(r, 5000));
  await executeRemoteCommand(conn, 'docker ps');
  await executeRemoteCommand(conn, 'docker logs --tail 30 sdi');

  conn.end();
  console.log('\n[SSH] Deployment completed successfully!');
}

main().catch((err) => {
  console.error('Deployment error:', err);
  process.exit(1);
});
