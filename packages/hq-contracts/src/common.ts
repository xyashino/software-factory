import { z } from 'zod';

export const projectIdSchema = z.string().trim().min(1);
