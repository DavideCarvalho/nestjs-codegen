import 'reflect-metadata';
import { ApplyContract } from '@dudousxd/nestjs-inertia-client/server';
import { Controller, Get, Post } from '@nestjs/common';
// Re-export through a barrel index.
import { ListWidgets } from './contracts';
// Direct import from the declaring file.
import { CreateWidget } from './contracts/shared.contract';

@Controller('/api/widgets')
export class CrossFileContractController {
  @Get()
  @ApplyContract(ListWidgets)
  list() {
    return [];
  }

  @Post()
  @ApplyContract(CreateWidget)
  create() {
    return {};
  }
}
