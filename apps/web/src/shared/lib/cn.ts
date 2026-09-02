export type ClassValue = string | false | null | undefined

/** Склейка классов CSS Modules. Ложные значения отбрасываются. */
export const cn = (...values: ClassValue[]): string => values.filter(Boolean).join(' ')
