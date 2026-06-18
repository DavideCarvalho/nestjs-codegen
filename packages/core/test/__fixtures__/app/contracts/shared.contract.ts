import 'reflect-metadata';
import { defineContract } from '@dudousxd/nestjs-inertia-client';
import { z } from 'zod';

export const ListWidgets = defineContract({
  query: z.object({ active: z.boolean().optional() }),
  response: z.array(z.object({ id: z.string(), name: z.string() })),
});

export const CreateWidget = defineContract({
  body: z.object({ name: z.string() }),
  response: z.object({ id: z.string(), name: z.string() }),
});
