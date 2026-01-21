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

