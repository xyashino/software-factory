import pc from 'picocolors';

/**
 * The colours of the Supervisor's views (ported from v1 `src/paint.ts`). Colour is applied only at
 * this presentation layer: stored events, blobs and `--json` output never pass through a `Paint`
 * (RULES §2.2).
 */
export interface Paint {
  bold(text: string): string;
  dim(text: string): string;
  red(text: string): string;
  green(text: string): string;
  yellow(text: string): string;
  cyan(text: string): string;
  blue(text: string): string;
  gray(text: string): string;
  magenta(text: string): string;
}

const plain = (text: string): string => text;

/** No colour at all: tests, `--no-color`, `NO_COLOR`, and any output that is not a terminal view. */
export const plainPaint: Paint = {
  bold: plain,
  dim: plain,
  red: plain,
  green: plain,
  yellow: plain,
  cyan: plain,
  blue: plain,
  gray: plain,
  magenta: plain,
};

const coloured = pc.createColors(true);

/** ANSI colour through picocolors (the catalog version). */
export const colorPaint: Paint = {
  bold: coloured.bold,
  dim: coloured.dim,
  red: coloured.red,
  green: coloured.green,
  yellow: coloured.yellow,
  cyan: coloured.cyan,
  blue: coloured.blue,
  gray: coloured.gray,
  magenta: coloured.magenta,
};

/** The Paint for a setting: coloured when `color` is on, plain otherwise. */
export const paintFor = (color: boolean): Paint =>
  color ? colorPaint : plainPaint;
