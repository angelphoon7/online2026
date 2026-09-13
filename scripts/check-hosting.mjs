import { checkHosting } from './lib/hosting-check.mjs';

try {
  const result = await checkHosting();
  console.log(`PASS hosting preflight: Redis write/Lua/TIME via ${result.redisSettings.join(' + ')}.`);
  console.log('This validates build dependencies only. After deployment run submission:check:hosted -- <public URL> --model.');
} catch (error) {
  console.error(`FAIL hosting preflight:\n${error.message}`);
  process.exitCode = 1;
}
