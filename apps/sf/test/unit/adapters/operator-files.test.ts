import { describe, expect, it } from 'vitest';
import { ArgumentError } from '../../../src/application/core/errors';
import {
  type OperatorFileIo,
  readOperatorFile,
} from '../../../src/adapters/fs/operator-files';

interface FakeIo extends OperatorFileIo {
  reads: string[];
  stdinReads: number;
}

const createFakeIo = (files: Record<string, string>, stdin = ''): FakeIo => {
  const io: FakeIo = {
    reads: [],
    stdinReads: 0,
    readFile: (path) => {
      io.reads.push(path);
      const text = files[path];
      if (text === undefined) {
        throw new Error('ENOENT');
      }
      return text;
    },
    readStdin: () => {
      io.stdinReads += 1;
      return stdin;
    },
  };
  return io;
};

describe('operator file reader', () => {
  it('returns the UTF-8 text of the named file', () => {
    // Arrange
    const io = createFakeIo({ 'feedback.md': 'needs tests ✓' });

    // Act
    const text = readOperatorFile('feedback.md', '--feedback', io);

    // Assert
    expect(text).toBe('needs tests ✓');
    expect(io.reads).toEqual(['feedback.md']);
  });

  it('reads stdin instead of a file when the path is a dash', () => {
    // Arrange
    const io = createFakeIo({ '-': 'from a file named dash' }, 'from stdin');

    // Act
    const text = readOperatorFile('-', '--feedback', io);

    // Assert
    expect(text).toBe('from stdin');
    expect(io.stdinReads).toBe(1);
    expect(io.reads).toEqual([]);
  });

  it('refuses an unreadable file as an argument error', () => {
    // Arrange
    const io = createFakeIo({});

    // Act
    const read = () => readOperatorFile('missing.md', '--handover', io);

    // Assert
    expect(read).toThrow(ArgumentError);
    expect(read).toThrow('--handover file missing.md cannot be read');
  });

  it('reads only the path it was given, never factory config or the token', () => {
    // Arrange
    const io = createFakeIo({ 'report.md': 'ok' });

    // Act
    readOperatorFile('report.md', '--report', io);

    // Assert
    expect(io.reads).toEqual(['report.md']);
    expect(io.reads.some((path) => path.includes('.factory'))).toBe(false);
    expect(io.reads.some((path) => path.includes('token'))).toBe(false);
  });
});
