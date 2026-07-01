/**
 * Multipart upload discovery: a controller that takes an `@UploadedFile()` /
 * `@UploadedFiles()` (via a Multer `FileInterceptor` / `FilesInterceptor` /
 * `FileFieldsInterceptor`) is flagged `multipart` and carries the uploaded-file
 * field(s) in `multipartBody`, typed as the browser `File | Blob` (NOT the
 * server-side `Express.Multer.File`). The intersection with the `@Body` DTO is
 * applied at emit time (so a named `bodyRef` is preserved), not here.
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
  it('flags multipart and carries the single @UploadedFile field, leaving body untouched', () => {
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
    // Body stays the (resolved) @Body DTO; the file field rides in multipartBody.
    expect(result?.body).toBe('{ type: string; date: string }');
    expect(result?.multipartBody).toBe('{ file: File | Blob }');
  });

  it('carries the file field even when there is no @Body', () => {
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
    expect(result?.body).toBeNull();
    expect(result?.multipartBody).toBe('{ avatar: File | Blob }');
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
    expect(result?.multipartBody).toBe('{ files: Array<File | Blob> }');
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
    expect(result?.multipartBody).toBe(
      '{ avatar: Array<File | Blob>; background: Array<File | Blob> }',
    );
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
    expect(result?.multipartBody ?? null).toBeNull();
    expect(result?.body).toBe('{ name: string }');
  });
});
