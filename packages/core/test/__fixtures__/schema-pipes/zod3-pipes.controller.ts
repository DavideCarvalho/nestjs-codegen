import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import { z } from 'zod';
import { inviteBody, noteContract } from './schemas';
import { ZodPipe, contractSchema, zodPipe } from './zod.pipe';

class LegacyDto {
  name!: string;
}

const createBody = z.object({
  email: z.string().email(),
  website: z.string().url().optional(),
  id: z.string().uuid(),
  slug: z.string().regex(/^[a-z-]+$/),
  title: z.string().trim().min(1).max(80),
  age: z.number().int().min(0).max(150),
  limit: z.number().optional().default(20),
  nickname: z.string().nullable(),
  password: z.string().refine((p) => p.length >= 8, 'too short'),
  confirm: z.string().superRefine((value, ctx) => {
    if (!value) ctx.addIssue({ code: z.ZodIssueCode.custom });
  }),
  tags: z.string().transform((s) => s.split(',')),
  kind: z.enum(['a', 'b']),
  userId: z.string().brand<'UserId'>(),
});

const listQuery = z.object({
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  archived: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

@Controller('zod3')
export class Zod3PipesController {
  @Post()
  create(@Body(new ZodPipe(createBody)) body: z.infer<typeof createBody>) {
    return body;
  }

  @Get()
  list(@Query(new ZodPipe(listQuery)) query: z.infer<typeof listQuery>) {
    return query;
  }

  @Get('search')
  search(
    @Query('q', new ZodPipe(z.string().min(2))) q: string,
    @Query('limit', new ZodPipe(z.coerce.number().max(100).optional())) limit?: number,
  ) {
    return { q, limit };
  }

  @Get('items/:itemId/:status')
  item(
    @Param('itemId', new ZodPipe(z.string().uuid())) itemId: string,
    @Param('status', new ZodPipe(z.enum(['open', 'closed']))) status: 'open' | 'closed',
  ) {
    return { itemId, status };
  }

  @Get('orgs/:org/:seq')
  org(@Param(new ZodPipe(z.object({ org: z.string(), seq: z.coerce.number() }))) params: unknown) {
    return params;
  }

  @Post('invite')
  invite(@Body(new ZodPipe(inviteBody)) body: z.infer<typeof inviteBody>) {
    return body;
  }

  @Post('notes')
  note(@Body(new ZodPipe(contractSchema(noteContract.body))) body: { text: string }) {
    return body;
  }

  @Post('inline')
  inline(@Body(zodPipe(z.object({ ok: z.boolean() }))) body: { ok: boolean }) {
    return body;
  }

  @Get('pages/:n')
  pages(
    @Param('n', ParseIntPipe) n: number,
    @Query('size', new DefaultValuePipe(10), ParseIntPipe) size: number,
  ) {
    return { n, size };
  }

  @Post('legacy')
  legacy(@Body(new ValidationPipe({ whitelist: true })) body: LegacyDto) {
    return body;
  }
}
