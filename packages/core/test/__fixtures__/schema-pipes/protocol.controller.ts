import { All, Controller, Get, Head, Options, Param } from '@nestjs/common';

/** Protocol endpoints: an MCP transport (`@All`), a tus-style upload probe (`@Head`/`@Options`). */
@Controller('protocol')
export class ProtocolController {
  @All('mcp')
  mcp(): { jsonrpc: string } {
    return { jsonrpc: '2.0' };
  }

  @Head('uploads/:id')
  probe(@Param('id') id: string): void {
    void id;
  }

  @Options('uploads')
  capabilities(): { versions: string[] } {
    return { versions: ['1.0.0'] };
  }

  @Get('status')
  status(): { ok: boolean } {
    return { ok: true };
  }
}
