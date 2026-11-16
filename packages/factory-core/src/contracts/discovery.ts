import { z } from 'zod';

/**
 * The discovery file (PROTOCOL §2, STORAGE §1): `factory-server` writes it into its data directory on
 * start and removes it on a clean shutdown. A local client reads it to find the server's URL and the
 * credentials it needs, so no manual `FACTORY_TOKEN` is set. The file is written with mode 0600 on
 * POSIX; the server's token is never logged. This module only names and parses the file; the reads and
 * writes are the apps' own (core stays pure).
 */

/** The discovery file's name inside the data directory. */
export const DISCOVERY_FILE_NAME = 'server.json';

/** What the file holds: the server's address, the local supervisor token and the local join token. */
export const discoverySchema = z.object({
  /** The server's address, e.g. `http://127.0.0.1:7878`. */
  url: z.string().min(1),
  /** The supervisor credential local CLI calls use (bearer). Valid only while this server runs. */
  token: z.string().min(1),
  /** A join token a local Cell exchanges once for its own credential (PROTOCOL §3.2). */
  joinToken: z.string().min(1),
});

export type Discovery = z.infer<typeof discoverySchema>;

/**
 * Parses the text of a discovery file. Returns undefined when the text is not one, so a damaged or
 * half-written file reads as "no server" and the caller takes its fallback.
 */
export const parseDiscovery = (text: string): Discovery | undefined => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = discoverySchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
};
