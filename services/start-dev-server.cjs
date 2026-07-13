const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const node = process.execPath;
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const out = fs.openSync(path.join(root, ".next-dev-detached.log"), "a");
const err = fs.openSync(path.join(root, ".next-dev-detached.err.log"), "a");

const child = spawn(
  node,
  [nextBin, "start", "--hostname", "127.0.0.1", "--port", "3000"],
  {
    cwd: root,
    detached: true,
    stdio: ["ignore", out, err],
    windowsHide: true
  }
);

child.unref();
console.log(`Started Next dev server with PID ${child.pid}`);
