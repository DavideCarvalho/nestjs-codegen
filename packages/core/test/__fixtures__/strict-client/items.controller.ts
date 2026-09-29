import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod/v4';
import { StandardSchemaPipe } from '../schema-pipes/zod.pipe';

const createItem = z.object({ title: z.string(), note: z.string().optional() });
const listItems = z.object({ page: z.coerce.number().optional(), q: z.string().optional() });

export interface Item {
  id: string;
  title: string;
  createdAt: Date;
}

/** Every leaf shape a client usually has: list, read, create, delete, a no-input read. */
@Controller('items')
export class ItemsController {
  @Get()
  list(@Query(new StandardSchemaPipe(listItems)) query: z.infer<typeof listItems>): {
    data: Item[];
    meta: { page: number; lastPage: number };
  } {
    void query;
    return { data: [], meta: { page: 1, lastPage: 1 } };
  }

  @Get('count')
  count(): { total: number } {
    return { total: 0 };
  }

  @Get(':id')
  show(@Param('id') id: string): Item {
    return { id, title: '', createdAt: new Date() };
  }

  @Post()
  create(@Body(new StandardSchemaPipe(createItem)) body: z.infer<typeof createItem>): Item {
    return { id: '1', title: body.title, createdAt: new Date() };
  }

  @Delete(':id')
  remove(@Param('id') id: string): { deleted: string } {
    return { deleted: id };
  }
}
