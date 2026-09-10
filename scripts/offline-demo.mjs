import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { json } from './lib/demo-state.mjs';

const verify = process.argv.includes('--verify');
assert(process.argv.slice(2).every(a => a === '--verify'), 'Usage: npm run demo:offline [-- --verify]');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (p, value) => { fs.writeFileSync(`${p}.tmp`, json(value), { mode: 0o600 }); fs.renameSync(`${p}.tmp`, p); };

// Only the local orchestrator loads dotenv. The solver child never loads dotenv
// or the participant journal; its explicit environment contains one signing key.
export function solverEnvironment(source) {
  const env = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'ARC_RPC', 'SOLVE_API_URL']) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  if (source.SEED_D_PRIVATE_KEY) env.SOLVER_PRIVATE_KEY = source.SEED_D_PRIVATE_KEY;
  return env;
}

async function child(file, args = [], env = process.env) {
  const proc = spawn(process.execPath, [file, ...args], { env, stdio: 'inherit', windowsHide: true });
  return await new Promise((resolve, reject) => {
    proc.once('error', reject);
    proc.once('exit', code => code === 0 ? resolve({ pid: proc.pid, exitCode: code, exitedAt: new Date().toISOString() }) : reject(new Error(`${file} failed; journal retained. Rerun the same command to resume.`)));
  });
}

async function main() {
  loadEnvFile('.env');
  if (!verify && !fs.existsSync('deployments/offline-demo.json')) {
    const participantProcess = await child('scripts/offline-participants.mjs');
    const ready = read('.data/offline-ready.json');
    ready.participantProcess = participantProcess;
    write('.data/offline-ready.json', ready);
  }
  if (!verify && !fs.existsSync('deployments/offline-demo.json')) loadEnvFile('.env.seed');
  await child('scripts/offline-solver.mjs', verify ? ['--verify'] : [], solverEnvironment(process.env));
}

if (process.argv[1]?.endsWith('offline-demo.mjs')) main().catch(error => { console.error(error.message); process.exitCode = 1; });
