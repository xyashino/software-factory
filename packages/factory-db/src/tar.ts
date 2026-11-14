// A minimal ustar archive: regular files only, no directories, no links, no extended headers. The
// archive is deterministic (zero mtime, root owner), so the same content always makes the same bytes.
// Reading is strict: a bad checksum, a bad size, a missing end marker or an unknown type throws.

const BLOCK = 512;
const NAME_MAX = 100;
const SIZE_MAX = 0o77777777777; // 11 octal digits, the ustar limit (8 GiB)
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface TarEntry {
  name: string;
  bytes: Uint8Array;
}

const writeText = (
  block: Uint8Array,
  offset: number,
  width: number,
  text: string,
): void => {
  const bytes = encoder.encode(text);
  if (bytes.byteLength > width) {
    throw new Error(`tar field too long: ${text}`);
  }
  block.set(bytes, offset);
};

/** An octal number, NUL-terminated, in a field of `width` bytes. */
const writeOctal = (
  block: Uint8Array,
  offset: number,
  width: number,
  value: number,
): void => {
  writeText(
    block,
    offset,
    width,
    `${value.toString(8).padStart(width - 1, '0')}\0`,
  );
};

/** The header of one regular file. The checksum counts the checksum field as eight spaces. */
const headerOf = (name: string, size: number): Uint8Array => {
  if (encoder.encode(name).byteLength > NAME_MAX) {
    throw new Error(`tar entry name too long: ${name}`);
  }
  if (size > SIZE_MAX) throw new Error(`tar entry too large: ${name}`);
  const block = new Uint8Array(BLOCK);
  writeText(block, 0, NAME_MAX, name);
  writeOctal(block, 100, 8, 0o644);
  writeOctal(block, 108, 8, 0);
  writeOctal(block, 116, 8, 0);
  writeOctal(block, 124, 12, size);
  writeOctal(block, 136, 12, 0);
  writeText(block, 148, 8, '        ');
  writeText(block, 156, 1, '0');
  writeText(block, 257, 6, 'ustar\0');
  writeText(block, 263, 2, '00');
  const sum = block.reduce((total, byte) => total + byte, 0);
  writeText(block, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
  return block;
};

/** Writes the entries as one archive, in the order given. */
export const writeTar = (entries: readonly TarEntry[]): Uint8Array => {
  const padded = (size: number): number => Math.ceil(size / BLOCK) * BLOCK;
  const total =
    entries.reduce(
      (sum, entry) => sum + BLOCK + padded(entry.bytes.byteLength),
      0,
    ) +
    2 * BLOCK;
  const archive = new Uint8Array(total);
  let offset = 0;
  for (const entry of entries) {
    archive.set(headerOf(entry.name, entry.bytes.byteLength), offset);
    offset += BLOCK;
    archive.set(entry.bytes, offset);
    offset += padded(entry.bytes.byteLength);
  }
  // Two zero blocks end the archive; the rest of the buffer is already zero.
  return archive;
};

const readText = (block: Uint8Array, offset: number, width: number): string => {
  const field = block.subarray(offset, offset + width);
  const end = field.indexOf(0);
  return decoder.decode(end === -1 ? field : field.subarray(0, end));
};

const readOctal = (
  block: Uint8Array,
  offset: number,
  width: number,
): number => {
  const text = readText(block, offset, width).trim();
  if (!/^[0-7]+$/.test(text)) throw new Error(`bad tar number: "${text}"`);
  return Number.parseInt(text, 8);
};

const isZeroBlock = (block: Uint8Array): boolean =>
  block.every((byte) => byte === 0);

const checksumOf = (block: Uint8Array): number => {
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) {
    sum += index >= 148 && index < 156 ? 0x20 : (block[index] ?? 0);
  }
  return sum;
};

/**
 * Reads every entry of an archive. Throws on anything that is not a complete, well-formed archive: both
 * zero end blocks must be present, and nothing may follow them.
 */
export const readTar = (archive: Uint8Array): TarEntry[] => {
  const entries: TarEntry[] = [];
  let offset = 0;
  for (;;) {
    if (offset + BLOCK > archive.byteLength) {
      throw new Error('tar archive is truncated: no end marker');
    }
    const header = archive.subarray(offset, offset + BLOCK);
    if (isZeroBlock(header)) {
      if (offset + 2 * BLOCK > archive.byteLength) {
        throw new Error('tar archive is truncated: end marker incomplete');
      }
      if (!isZeroBlock(archive.subarray(offset + BLOCK, offset + 2 * BLOCK))) {
        throw new Error('tar archive is truncated: end marker incomplete');
      }
      if (offset + 2 * BLOCK !== archive.byteLength) {
        throw new Error('tar archive has data after its end marker');
      }
      return entries;
    }

    if (readText(header, 257, 6) !== 'ustar') {
      throw new Error('tar entry is not ustar');
    }
    if (readOctal(header, 148, 8) !== checksumOf(header)) {
      throw new Error('tar header checksum does not match');
    }
    const type = header[156];
    if (type !== 0x30 && type !== 0) {
      throw new Error('tar entry is not a regular file');
    }
    const size = readOctal(header, 124, 12);
    const start = offset + BLOCK;
    if (start + size > archive.byteLength) {
      throw new Error(
        `tar entry ${readText(header, 0, NAME_MAX)} is truncated`,
      );
    }
    entries.push({
      name: readText(header, 0, NAME_MAX),
      bytes: archive.slice(start, start + size),
    });
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
  }
};
