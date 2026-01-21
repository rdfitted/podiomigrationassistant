export const READ_ONLY_TARGET_FIELD_TYPES = [
  'calculation',
  'created_on',
  'created_by',
  'created_via',
  'app_item_id_icon',
] as const;

const readOnlyTargetFieldTypeSet: ReadonlySet<string> = new Set(READ_ONLY_TARGET_FIELD_TYPES);

export function isReadOnlyTargetFieldType(fieldType: string | null | undefined): boolean {
  return typeof fieldType === 'string' && readOnlyTargetFieldTypeSet.has(fieldType);
}

/**
 * Field types that are VALID for duplicate matching
 * These produce portable values that can be compared across apps
 */
export const VALID_MATCH_FIELD_TYPES = [
  'text',        // Text fields - direct string comparison
  'number',      // Number fields - numeric values
  'calculation', // Calculated fields - extracted computed value
  'email',       // Email fields - email addresses
  'phone',       // Phone fields - phone numbers
  'tel',         // Telephone fields - phone numbers (legacy)
  'duration',    // Duration fields - time values
  'money',       // Money fields - monetary values (just the number)
  'location',    // Location fields - address text
  'question',    // Question fields - yes/no boolean
] as const;

/**
 * Field types that should NOT be used for matching
 * These produce IDs or complex objects that aren't portable across apps
 */
export const INVALID_MATCH_FIELD_TYPES = [
  'app',         // App relationship fields - item IDs (meaningless across apps)
  'category',    // Category fields - internal category IDs (not portable)
  'contact',     // Contact fields - profile/user IDs (not portable)
  'date',        // Date fields - complex objects {start, end}
  'image',       // Image fields - file IDs
  'file',        // File fields - file IDs
  'embed',       // Embed fields - URLs/embeds
  'created_on',  // System field - creation timestamp
  'created_by',  // System field - creator
  'created_via', // System field - creation method
] as const;

const invalidMatchFieldTypeSet: ReadonlySet<string> = new Set(INVALID_MATCH_FIELD_TYPES);

export function isInvalidMatchFieldType(fieldType: string | null | undefined): boolean {
  return typeof fieldType === 'string' && invalidMatchFieldTypeSet.has(fieldType);
}

/**
 * Pattern for valid Podio field IDs
 * Field IDs must be numeric strings with 1-15 digits
 */
export const FIELD_ID_PATTERN = /^\d{1,15}$/;

/**
 * Validates that a field ID matches the expected format
 * Prevents injection attacks and ensures valid Podio field ID format
 */
export function isValidFieldId(fieldId: string | null | undefined): boolean {
  return typeof fieldId === 'string' && FIELD_ID_PATTERN.test(fieldId);
}

