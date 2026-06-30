/**
 * Multipart upload discovery: a controller that takes an `@UploadedFile()` /
 * `@UploadedFiles()` (via a Multer `FileInterceptor` / `FilesInterceptor` /
 * `FileFieldsInterceptor`) should produce a `body` type that MERGES the
 * `@Body` DTO with the uploaded-file fields (typed as the browser `File | Blob`,
 * NOT the server-side `Express.Multer.File`), and flag the route `multipart`.
 */
import { Project, type SourceFile } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { extractDtoContract } from '../../src/discovery/contracts-fast.js';

function makeSourceFileFromCode(code: string): {
  sf: SourceFile;
  project: Project;
} {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipLoadingLibFiles: true,
    skipFileDependencyResolution: true,
    compilerOptions: { strict: false },
  });
  const sf = project.createSourceFile('test.ts', code);
  return { sf, project };
}

function contractFor(code: string, methodName: string) {
  const { sf, project } = makeSourceFileFromCode(code);
  const cls = sf.getClassOrThrow('TestController');
  const method = cls.getMethodOrThrow(methodName);
  return extractDtoContract(method, sf, project);
}

describe('multipart upload discovery', () => {
  it('merges a single @UploadedFile (FileInterceptor) into the body and flags multipart', () => {
    const result = contractFor(
      `
      class UploadDto {
        type: string;
        date: string;
      }
      class TestController {
        @Post()
        @UseInterceptors(FileInterceptor('file'))
        upload(
          @Body() body: UploadDto,
          @UploadedFile() file: any,
        ) {}
      }
    `,
      'upload',
    );

    expect(result?.multipart).toBe(true);
    // The @Body DTO (expanded by the resolver) is parenthesized and intersected
    // with the uploaded-file field, typed for the browser as `File | Blob`.
    expect(result?.body).toBe('({ type: string; date: string }) & { file: File | Blob }');
  });

  it('parenthesizes a union @Body so the file intersection applies to the whole union', () => {
    const result = contractFor(
      `
      class TestController {
        @Post()
        @UseInterceptors(FileInterceptor('file'))
        upload(
          @Body() body: { a: string } | { b: number },
          @UploadedFile() file: any,
        ) {}
      }
    `,
      'upload',
    );

    expect(result?.multipart).toBe(true);
    // Without the parens this would be `{ a } | ({ b } & { file })` — the file
    // would only land on the second arm.
    expect(result?.body).toBe('({ a: string } | { b: number }) & { file: File | Blob }');
  });

  it('uses the file field as the whole body when there is no @Body', () => {
    const result = contractFor(
      `
      class TestController {
        @Post()
        @UseInterceptors(FileInterceptor('avatar'))
        upload(@UploadedFile() file: any) {}
      }
    `,
      'upload',
    );

    expect(result?.multipart).toBe(true);
    expect(result?.body).toBe('{ avatar: File | Blob }');
  });

  it('types a FilesInterceptor field as an array of files', () => {
    const result = contractFor(
      `
      class TestController {
        @Post()
        @UseInterceptors(FilesInterceptor('files', 10))
        upload(@UploadedFiles() files: any) {}
      }
    `,
      'upload',
    );

    expect(result?.multipart).toBe(true);
    expect(result?.body).toBe('{ files: Array<File | Blob> }');
  });

  it('emits one array field per FileFieldsInterceptor entry', () => {
    const result = contractFor(
      `
      class TestController {
        @Post()
        @UseInterceptors(FileFieldsInterceptor([{ name: 'avatar', maxCount: 1 }, { name: 'background' }]))
        upload(@UploadedFiles() files: any) {}
      }
    `,
      'upload',
    );

    expect(result?.multipart).toBe(true);
    expect(result?.body).toBe('{ avatar: Array<File | Blob>; background: Array<File | Blob> }');
  });

  it('does not flag a plain @Body POST as multipart', () => {
    const result = contractFor(
      `
      class TestController {
        @Post()
        create(@Body() body: { name: string }) {}
      }
    `,
      'create',
    );

    expect(result?.multipart).toBe(false);
    expect(result?.body).toBe('{ name: string }');
  });
});
