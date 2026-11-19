import { loadConfig } from './config';
import { createFactoryClient } from './factory-client';

export const createSessionClient = (
  env: Record<string, string | undefined>,
) => {
  const config = loadConfig(env);
  const token = config.FACTORY_TOKEN;
  if (token === undefined) {
    throw new Error('FACTORY_TOKEN is required until session auth lands');
  }
  return {
    client: createFactoryClient({
      baseUrl: config.FACTORY_URL,
      getToken: () => token,
    }),
    projectId: config.FACTORY_PROJECT_ID,
  };
};
