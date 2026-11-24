await import('./server/startup');
export const { handler, options, startServer } =
  await import('@astrojs/node/server.js');
