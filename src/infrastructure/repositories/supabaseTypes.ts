import type { SupabaseClient } from '@supabase/supabase-js';

export class RepositoryRevisionConflictError extends Error {
  readonly code = 'REVISION_CONFLICT' as const;

  constructor(message: string) {
    super(message);
    this.name = 'RepositoryRevisionConflictError';
  }
}

export interface SupabaseQueryError {
  message: string;
  code?: string;
}

export interface SupabaseQueryResult<T> {
  data: T | null;
  error: SupabaseQueryError | null;
}

export interface SupabaseFilterBuilder<Row = Record<string, unknown>>
  extends PromiseLike<SupabaseQueryResult<Row[]>> {
  eq(column: string, value: unknown): SupabaseFilterBuilder<Row>;
  order(
    column: string,
    options?: { ascending?: boolean },
  ): SupabaseFilterBuilder<Row>;
  limit(count: number): SupabaseFilterBuilder<Row>;
  select(columns?: string): SupabaseFilterBuilder<Row>;
  single(): PromiseLike<SupabaseQueryResult<Row>>;
  maybeSingle(): PromiseLike<SupabaseQueryResult<Row>>;
}

export interface SupabaseTableClient {
  select(columns?: string): SupabaseFilterBuilder<Record<string, unknown>>;
  insert(
    values: Record<string, unknown> | Record<string, unknown>[],
  ): SupabaseFilterBuilder<Record<string, unknown>>;
  upsert(
    values: Record<string, unknown> | Record<string, unknown>[],
    options?: { onConflict?: string },
  ): SupabaseFilterBuilder<Record<string, unknown>>;
  update(
    values: Record<string, unknown>,
  ): SupabaseFilterBuilder<Record<string, unknown>>;
  delete(): SupabaseFilterBuilder<Record<string, unknown>>;
}

export interface SupabaseLikeClient {
  from(table: string): SupabaseTableClient;
}

export type AnySupabaseClient = SupabaseClient | SupabaseLikeClient;

export function asTableClient(
  client: AnySupabaseClient,
  table: string,
): SupabaseTableClient {
  return (client as unknown as SupabaseLikeClient).from(table);
}
