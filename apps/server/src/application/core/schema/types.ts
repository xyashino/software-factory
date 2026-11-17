/** The shape the application parses with: any zod schema fits it, so this layer names no zod type. */
export interface ZodContract<T> {
  safeParse(input: unknown):
    | { success: true; data: T }
    | {
        success: false;
        error: {
          issues: readonly { path: readonly PropertyKey[]; message: string }[];
        };
      };
}
