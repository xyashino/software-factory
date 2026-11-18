export interface TodoFile {
  filename: string;
  text: string;
}

export type WriteOutcome = 'written' | 'refused';

export interface TodoFilesPort {
  list(dir: string): Promise<TodoFile[]>;
  write(
    dir: string,
    filename: string,
    text: string,
    force: boolean,
  ): Promise<WriteOutcome>;
}
