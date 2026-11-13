import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const composeFile = fileURLToPath(new URL('../compose.test.yaml', import.meta.url));
const project = `cocos_test_${process.pid}`;
const password = randomBytes(24).toString('hex');
const composeEnv = { ...process.env, TEST_POSTGRES_PASSWORD: password };
const composeArgs = ['compose', '-f', composeFile, '-p', project];

function run(command, args, env = composeEnv, capture = false) {
  const result = spawnSync(command, args, {
    env,
    encoding: 'utf8',
    stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with status ${result.status}`);
  return result.stdout ?? '';
}

try {
  run('docker', [...composeArgs, 'up', '-d', '--wait']);
  const publishedPort = run('docker', [...composeArgs, 'port', 'db', '5432'], composeEnv, true).trim();
  const port = /:(\d+)$/.exec(publishedPort)?.[1];
  if (!port) throw new Error(`Could not determine the test PostgreSQL port: ${publishedPort}`);

  const databaseUrl = `postgresql://cocos_test:${password}@127.0.0.1:${port}/cocos_test`;
  const testEnv = { ...composeEnv, DATABASE_URL: databaseUrl };
  run('npm', ['run', 'prisma:migrate:deploy'], testEnv);
  run('npm', ['exec', '--', 'vitest', 'run', 'test/orders.functional.spec.ts'], testEnv);
} finally {
  run('docker', [...composeArgs, 'down', '--volumes', '--remove-orphans']);
}
