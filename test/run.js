// npm test: runs every suite in test/ against its own freshly seeded server (temporary DATA_DIR, port 3199),
// so tests never touch storage/. Each suite prints PASS/FAIL lines and ends with "ALL PASSED" or "N FAILED".
// Run one suite: npm test -- english
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.TEST_PORT || 3199);
const BASE = `http://localhost:${PORT}`;
const SUITES = ['e2e', 'handmade-v3', 'english', 'admin-carrier', 'payout-slip', 'book-receive'];
const pick = process.argv.slice(2);
const suites = pick.length ? SUITES.filter(s => pick.includes(s)) : SUITES;

async function waitUp(server) {
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('server exited early');
    try { await fetch(BASE + '/'); return; } catch { await new Promise(r => setTimeout(r, 250)); }
  }
  throw new Error('server did not start');
}

(async () => {
  let failed = 0;
  for (const name of suites) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kdst-test-'));
    const env = { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, BASE, NODE_ENV: 'test' };
    let log = '';
    const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env });
    server.stdout.on('data', d => { log += d; });
    server.stderr.on('data', d => { log += d; });
    try {
      await waitUp(server);
      const r = spawnSync(process.execPath, [path.join(__dirname, name + '.mjs')], { cwd: ROOT, env, encoding: 'utf8', timeout: 5 * 60e3 });
      const out = (r.stdout || '') + (r.stderr || '');
      const last = out.trim().split('\n').pop();
      const pass = (out.match(/^PASS /gm) || []).length;
      const ok = last === 'ALL PASSED';
      if (!ok) {
        failed++;
        console.log(out.split('\n').filter(l => !l.startsWith('PASS ')).join('\n'));
        if (/Error/.test(log)) console.log('--- server log:\n' + log.slice(-2000));
      }
      console.log(`${ok ? '✔' : '✘'} ${name.padEnd(14)} ${pass} ผ่าน${ok ? '' : ' · ' + last}`);
    } catch (e) {
      failed++;
      console.log(`✘ ${name}: ${e.message}\n${log.slice(-2000)}`);
    } finally {
      server.kill();
      await new Promise(r => (server.exitCode !== null ? r() : server.once('exit', r)));
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
  console.log(failed ? `\n${failed} ชุดไม่ผ่าน` : '\nผ่านทุกชุด');
  process.exit(failed ? 1 : 0);
})();
