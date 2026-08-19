export type ImportStatus = 'processing' | 'completed' | 'error';

export interface ImportRowError {
  line: number;
  reason: string;
}

export interface ImportResult {
  totalLines: number;
  imported: number;
  withError: number;
  errors: ImportRowError[];
}
