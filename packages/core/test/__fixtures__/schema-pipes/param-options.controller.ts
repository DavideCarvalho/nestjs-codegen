import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod/v4';

const createBody = z.object({
  prompt: z.string().trim().min(1),
  note: z.string().optional(),
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
});

/** NestJS 12: the schema in the decorator's options, validated by StandardSchemaValidationPipe. */
@Controller('options')
export class ParamOptionsController {
  @Post()
  create(@Body({ schema: createBody }) body: z.infer<typeof createBody>) {
    return body;
  }

  @Get()
  list(@Query({ schema: listQuery }) query: z.infer<typeof listQuery>) {
    return query;
  }

  @Get('search')
  search(@Query('q', { schema: z.string() }) q: string) {
    return q;
  }

  @Get(':version')
  item(@Param('version', { schema: z.coerce.number().int() }) version: number) {
    return version;
  }
}
