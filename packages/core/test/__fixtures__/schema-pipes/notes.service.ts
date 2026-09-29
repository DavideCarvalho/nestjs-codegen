import { Injectable } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';

/** A limit a schema reads from a service module — the rest of the module is not its business. */
export const NOTE_MAX = 2000;

@Injectable()
export class NotesService {
  constructor(private readonly moduleRef: ModuleRef) {}
}
