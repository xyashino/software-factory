import { SQL } from 'bun';

export const POSTGRES_URL = process.env.TEST_POSTGRES_URL ?? '';

const TABLES = [
  'state_transitions',
  'jobs',
  'order_steps',
  'incidents',
  'work_orders',
  'order_plans',
  'safe_tokens',
  'factories',
  'projects',
];

export const resetPostgres = async (url: string): Promise<void> => {
  const client = new SQL(url);
  try {
    await client.unsafe(
      `TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`,
    );
  } finally {
    await client.close();
  }
};

export const postgresIndexes = async (
  url: string,
): Promise<{ indexname: string; indexdef: string }[]> => {
  const client = new SQL(url);
  try {
    return await client`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`;
  } finally {
    await client.close();
  }
};
