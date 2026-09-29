import { z } from 'zod';
import { NOTE_MAX } from './notes.service';

/** Declared in its own file: the pipe's argument is an import. */
export const inviteBody = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member']).default('member'),
});

export const noteContract = {
  body: z.object({ text: z.string().trim().min(1).max(NOTE_MAX) }),
};
