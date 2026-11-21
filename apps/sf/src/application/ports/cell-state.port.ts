export interface CellSession {
  cellId: string;
  sessionToken: string;
}

export interface CellStatePort {
  read(): Promise<CellSession | null>;
  write(session: CellSession): Promise<void>;
}
