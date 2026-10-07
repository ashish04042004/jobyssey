import { execSync } from 'node:child_process';
import { TEST_ENV } from './testEnv.js';

export default function globalSetup() {
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: TEST_ENV.DATABASE_URL, DIRECT_DATABASE_URL: '' },
  });
}
