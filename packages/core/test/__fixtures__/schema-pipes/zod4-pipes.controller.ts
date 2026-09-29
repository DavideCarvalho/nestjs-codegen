import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { z } from 'zod/v4';
import { StandardSchemaPipe } from './zod.pipe';

const createBody = z.object({
  email: z.email(),
  website: z.url().optional(),
  id: z.uuid(),
  title: z.string().trim().min(1).max(80),
  limit: z.number().optional().default(20),
  nickname: z.string().nullable(),
  password: z.string().refine((p) => p.length >= 8),
  count: z.string().transform((s) => s.length),
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().optional(),
});

@Controller('zod4')
export class Zod4PipesController {
  @Post()
  create(@Body(new StandardSchemaPipe(createBody)) body: z.infer<typeof createBody>) {
    return body;
  }

  @Get()
  list(@Query(new StandardSchemaPipe(listQuery)) query: z.infer<typeof listQuery>) {
    return query;
  }
}
