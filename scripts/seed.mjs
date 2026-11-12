import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required to seed the database');
}

const sql = await readFile(new URL('../prisma/seed.sql', import.meta.url), 'utf8');
const client = new Client({ connectionString: process.env.DATABASE_URL });

await client.connect();
try {
  await client.query(sql);
  console.log('Sample data seeded.');
} finally {
  await client.end();
}
