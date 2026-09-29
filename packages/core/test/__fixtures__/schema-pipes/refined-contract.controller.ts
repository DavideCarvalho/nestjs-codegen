import { defineContract } from '@dudousxd/nestjs-inertia-client';
import { ApplyContract } from '@dudousxd/nestjs-inertia-client/server';
import { Controller, Post } from '@nestjs/common';
import { z } from 'zod';

/** A defineContract whose schemas carry refinements the syntactic walker never knew. */
export const signUp = defineContract({
  body: z.object({
    email: z.string().email().max(120),
    password: z
      .string()
      .min(8)
      .refine((p) => /\d/.test(p)),
    plan: z.enum(['free', 'pro']).optional().default('free'),
    referrer: z.string().url().nullable(),
  }),
  query: z.object({ next: z.string().trim().optional() }),
  response: z.object({
    id: z.string().uuid(),
    createdAt: z.string().transform((s) => new Date(s)),
    plan: z.enum(['free', 'pro']).default('free'),
  }),
});

@Controller('accounts')
export class RefinedContractController {
  @Post()
  @ApplyContract(signUp)
  signUp() {
    return {};
  }
}
