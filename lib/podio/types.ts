/**
 * Shared type definitions for Podio API resources
 * Reference: aidocs/Podio API/ documentation
 */

/**
 * Organization (Workspace) representation
 * Reference: aidocs/Podio API/03-organizations.md
 */
export interface Organization {
  org_id: number;
  name: string;
  url: string;
  url_label?: string;
  logo?: number;
  image?: {
    link: string;
    thumbnail_link?: string;
  };
  premium?: boolean;
  role?: string;
  status?: string;
  type?: string;
  user_limit?: number;
  member_count?: number;
  created_on?: string;
}

/**
 * Space representation
 * Reference: aidocs/Podio API/04-spaces.md
 */
export interface Space {
  space_id: number;
  name: string;
  url: string;
  url_label?: string;
  org_id: number;
  privacy?: 'open' | 'closed';
  auto_join?: boolean;
  post_on_new_app?: boolean;
  post_on_new_member?: boolean;
  type?: string;
  premium?: boolean;
  role?: string;
  rights?: string[];
  created_on?: string;
  created_by?: {
    user_id: number;
    name: string;
  };
}

/**
 * Application field configuration
 * Reference: aidocs/Podio API/05-applications.md
 */
export interface AppField {
  field_id: number;
  type: string;
  external_id: string;
  label: string;
  config: {
    label?: string;
    description?: string;
    required?: boolean;
    unique?: boolean;
    delta?: number;
    hidden?: boolean;
    settings?: Record<string, unknown>;
    // For app reference fields
    referenced_apps?: Array<{ app_id: number; view_id?: number }>;
  };
  status?: string;
}

/**
 * Application representation
 * Reference: aidocs/Podio API/05-applications.md
 */
export interface Application {
  app_id: number;
  status: string;
  space_id: number;
  config: {
    name: string;
    item_name?: string;
    description?: string;
    icon?: string;
    icon_id?: number;
    external_id?: string;
    allow_edit?: boolean;
    allow_create?: boolean;
    default_view?: string;
  };
  fields?: AppField[];
  link?: string;
  url_label?: string;
  created_on?: string;
  created_by?: {
    user_id: number;
    name: string;
  };
}

/**
 * Flow (Globiflow workflow) representation
 * Reference: aidocs/Podio API/07-flows.md
 */
export interface Flow {
  flow_id: string;
  name: string;
  app_id: number;
  status: 'active' | 'inactive';
  type?: string;
  trigger?: {
    type: string;
    config: Record<string, unknown>;
  };
  actions?: Array<{
    type: string;
    config: Record<string, unknown>;
  }>;
  conditions?: Array<{
    type: string;
    config: Record<string, unknown>;
  }>;
  created_on?: string;
  created_by?: {
    user_id: number;
    name: string;
  };
}

/**
 * Hook (Webhook) representation
 * Reference: aidocs/Podio API/08-hooks.md
 */
export interface Hook {
  hook_id: number;
  status: 'active' | 'inactive';
  type: string;
  url: string;
  ref_type: 'app' | 'space';
  ref_id: number;
  created_on?: string;
  created_by?: {
    user_id: number;
    name: string;
  };
}

/**
 * Webhook validation request
 * Reference: aidocs/Podio API/08-hooks.md
 */
export interface HookValidationRequest {
  type: 'hook.verify';
  code: string;
}

/**
 * Common pagination parameters for list endpoints
 */
export interface PaginationParams {
  limit?: number;
  offset?: number;
}

/**
 * Common response metadata
 */
export interface ResponseMetadata {
  total?: number;
  filtered?: number;
}

/**
 * Rate limit information from response headers
 */
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: string;
}
