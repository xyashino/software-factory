import pc from 'picocolors';

export interface Paint {
  bold: (s: string) => string;
  dim: (s: string) => string;
  red: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  cyan: (s: string) => string;
  blue: (s: string) => string;
  gray: (s: string) => string;
  magenta: (s: string) => string;
}

const same = (s: string): string => s;

/** No styling: the default everywhere a test does not ask for colour. */
export const plainPaint: Paint = {
  bold: same,
  dim: same,
  red: same,
  green: same,
  yellow: same,
  cyan: same,
  blue: same,
  gray: same,
  magenta: same,
};

const colors = pc.createColors(!process.env.NO_COLOR);

/** picocolors forced on, even without a TTY; only `NO_COLOR` turns it off. */
export const colorPaint: Paint = {
  bold: colors.bold,
  dim: colors.dim,
  red: colors.red,
  green: colors.green,
  yellow: colors.yellow,
  cyan: colors.cyan,
  blue: colors.blue,
  gray: colors.gray,
  magenta: colors.magenta,
};
