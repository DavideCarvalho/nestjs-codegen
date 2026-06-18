import 'reflect-metadata';
import { ApplyContract } from '@dudousxd/nestjs-inertia-client/server';
import { Controller, Get } from '@nestjs/common';

@Controller('/api/ghost')
export class CrossFileContractUnresolvableController {
  @Get()
  @ApplyContract(NonExistentContract)
  list() {
    return [];
  }
}
