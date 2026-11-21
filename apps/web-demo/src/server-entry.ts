await import('./lib/startup');
export const { handler, options, startServer } =
  await import('@astrojs/node/server.js');
