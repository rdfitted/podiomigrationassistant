'use client';

import React from 'react';

/**
 * Field mapping table header component
 */
export function FieldMappingHeader() {
  return (
    <div className="grid grid-cols-12 gap-2 p-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
      <div className="col-span-5 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
        Source Field
      </div>
      <div className="col-span-1"></div>
      <div className="col-span-5 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
        Target Field
      </div>
      <div className="col-span-1 text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider text-right">
        Actions
      </div>
    </div>
  );
}
