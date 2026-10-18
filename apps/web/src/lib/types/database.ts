import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@cita-suite/shared';

type NullableSqlArguments<Args> = [Args] extends [never] ? never : {
	[Key in keyof Args]: Args[Key] | null
};
type AdaptSqlFunction<Function> = Function extends { Args: infer Args }
	? Omit<Function, 'Args'> & { Args: NullableSqlArguments<Args> } : Function;

/**
 * PostgreSQL accepts NULL for function arguments (the function validates it).
 * pg-meta omits that nullability, including required arguments without defaults.
 * Contain that SDK limitation here while preserving names, keys and return types.
 * Never replace NULL with omission: they can have different SQL defaults.
 */
export type CitaDatabase = Omit<Database, 'public'> & {
	public: Omit<Database['public'], 'Functions'> & {
		Functions: { [Name in keyof Database['public']['Functions']]: AdaptSqlFunction<Database['public']['Functions'][Name]> }
	}
};

export type CitaSupabaseClient = SupabaseClient<CitaDatabase>;
export type CitaTable = keyof Database['public']['Tables'];
export type CitaUpdate<Table extends CitaTable> = Database['public']['Tables'][Table]['Update'];
export type CitaInsert<Table extends CitaTable> = Database['public']['Tables'][Table]['Insert'];
export type CitaRow<Table extends CitaTable> = Database['public']['Tables'][Table]['Row'];
