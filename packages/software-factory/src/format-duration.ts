/** Milliseconds as `1h02m`, `3m05s` or `42s`. */
export const formatDuration = (ms: number | undefined): string => {
  if (ms === undefined) return '-';
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m${String(rest).padStart(2, '0')}s`;
  return `${rest}s`;
};
