import fs from 'node:fs';

try {
  fs.copyFileSync('.env.example', '.env.local', fs.constants.COPYFILE_EXCL);
  console.log('Created .env.local from the tracked template. Public reads and deterministic diagnosis need no keys.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Existing .env.local preserved. Compare .env.example for optional new settings.');
}
