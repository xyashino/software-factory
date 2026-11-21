import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const FACTORY_SRC_URL = new URL('../../../../src/', import.meta.url);
const CELL_IMPORT = /from\s+['"][^'"]*apps\/cell/;

describe('factory source boundary', () => {
  it('imports nothing from apps/cell', () => {
    // Arrange
    const files = readdirSync(fileURLToPath(FACTORY_SRC_URL), {
      recursive: true,
    }).filter((name) => name.endsWith('.ts'));

    // Act
    const violations = files.filter((file) =>
      CELL_IMPORT.test(readFileSync(new URL(file, FACTORY_SRC_URL), 'utf8')),
    );

    // Assert
    expect(violations).toEqual([]);
  });
});
