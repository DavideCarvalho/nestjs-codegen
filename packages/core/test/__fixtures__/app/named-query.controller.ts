import { Controller, Get, ParseArrayPipe, Query } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

class StatsDto {
  total: number;
}

@Controller('/api/stats')
export class NamedQueryController {
  /**
   * Individual named `@Query('name')` params — the codegen should synthesize a
   * `query` object type with one property per param (NOT `never`).
   *  - `kind`  required string
   *  - `years` optional number[] (has `?`)
   *  - `q`     optional string | string[]
   */
  @Get()
  @ApiResponse({ type: StatsDto })
  list(
    @Query('kind') kind: string,
    @Query('years', new ParseArrayPipe({ items: Number, optional: true })) years?: number[],
    @Query('q') q?: string | string[],
  ): Promise<StatsDto> {
    return {} as never;
  }
}
