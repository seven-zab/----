// Generated from contracts/source.mjs.
export type DemandCreateInput =
  | {
      schema_version: 1;
      title: string;
      content: string;
      location_text: string;
      service_time:
        | {
            kind: "negotiable";
          }
        | {
            kind: "period";
            description: string;
          }
        | {
            kind: "scheduled";
            start_at: number;
            end_at?: number;
          };
      expires_at?: number;
      contact: {
        name: string;
        phone: string;
        exact_address?: string;
      };
      budget?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "range";
            min_fen: number;
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_most";
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_least";
            min_fen: number;
            currency: "CNY";
          };
      /**
       * @minItems 0
       * @maxItems 8
       */
      attachments?: {
        file_id: string;
        usage: "image" | "document";
      }[];
      type: "enterprise";
      sub_type: "production_tech" | "talent_recruit";
      business_scene: "village";
      region_id: string;
      extra?: {
        coop_period?: string;
        company_scale?: string;
        urgency?: "normal" | "urgent" | "critical";
      };
    }
  | {
      schema_version: 1;
      title: string;
      content: string;
      location_text: string;
      service_time:
        | {
            kind: "negotiable";
          }
        | {
            kind: "period";
            description: string;
          }
        | {
            kind: "scheduled";
            start_at: number;
            end_at?: number;
          };
      expires_at?: number;
      contact: {
        name: string;
        phone: string;
        exact_address?: string;
      };
      budget?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "range";
            min_fen: number;
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_most";
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_least";
            min_fen: number;
            currency: "CNY";
          };
      /**
       * @minItems 0
       * @maxItems 8
       */
      attachments?: {
        file_id: string;
        usage: "image" | "document";
      }[];
      type: "agriculture";
      sub_type: "harvest" | "sales" | "drone_service";
      business_scene: "village";
      region_id: string;
      extra?: {
        live_location_kind?: "campus_live_base" | "local_orchard";
        product_type?: string;
        product_name?: string;
        yield_value?: number;
        yield_unit?: string;
        logistics?: string;
        help_period?: string;
        crop_name?: string;
        operation_area?: {
          value: number;
          unit: "mu" | "hectare" | "square_meter";
        };
        equipment_provider?: "publisher" | "service_party" | "negotiable";
      };
    }
  | {
      schema_version: 1;
      title: string;
      content: string;
      location_text: string;
      service_time:
        | {
            kind: "negotiable";
          }
        | {
            kind: "period";
            description: string;
          }
        | {
            kind: "scheduled";
            start_at: number;
            end_at?: number;
          };
      expires_at?: number;
      contact: {
        name: string;
        phone: string;
        exact_address?: string;
      };
      budget?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "range";
            min_fen: number;
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_most";
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_least";
            min_fen: number;
            currency: "CNY";
          };
      /**
       * @minItems 0
       * @maxItems 8
       */
      attachments?: {
        file_id: string;
        usage: "image" | "document";
      }[];
      type: "research";
      sub_type: "planting" | "mechanical" | "intelligent";
      business_scene: "village";
      region_id: string;
      extra?: {
        project_stage?: string;
        target_university?: string;
        funding_source?: "none" | "self_funded" | "subsidy_application";
        /**
         * @minItems 0
         * @maxItems 20
         */
        lab_conditions?: string[];
      };
    }
  | {
      schema_version: 1;
      title: string;
      content: string;
      location_text: string;
      service_time:
        | {
            kind: "negotiable";
          }
        | {
            kind: "period";
            description: string;
          }
        | {
            kind: "scheduled";
            start_at: number;
            end_at?: number;
          };
      expires_at?: number;
      contact: {
        name: string;
        phone: string;
        exact_address?: string;
      };
      budget?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "range";
            min_fen: number;
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_most";
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_least";
            min_fen: number;
            currency: "CNY";
          };
      /**
       * @minItems 0
       * @maxItems 8
       */
      attachments?: {
        file_id: string;
        usage: "image" | "document";
      }[];
      type: "campus";
      sub_type: "learning_research" | "activity_support" | "technical_support" | "daily_help" | "other";
      business_scene: "campus";
      campus_organization_id: "sztu";
      extra?: {};
    };
export type DraftInput =
  | {
      schema_version: 1;
      title?: string;
      content?: string;
      location_text?: string;
      service_time?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "period";
            description: string;
          }
        | {
            kind: "scheduled";
            start_at: number;
            end_at?: number;
          };
      expires_at?: number;
      contact?: {
        name: string;
        phone: string;
        exact_address?: string;
      };
      budget?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "range";
            min_fen: number;
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_most";
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_least";
            min_fen: number;
            currency: "CNY";
          };
      /**
       * @minItems 0
       * @maxItems 8
       */
      attachments?: {
        file_id: string;
        usage: "image" | "document";
      }[];
      type: "enterprise";
      sub_type?: "production_tech" | "talent_recruit";
      business_scene?: "village";
      region_id?: string;
      extra?: {
        coop_period?: string;
        company_scale?: string;
        urgency?: "normal" | "urgent" | "critical";
      };
    }
  | {
      schema_version: 1;
      title?: string;
      content?: string;
      location_text?: string;
      service_time?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "period";
            description: string;
          }
        | {
            kind: "scheduled";
            start_at: number;
            end_at?: number;
          };
      expires_at?: number;
      contact?: {
        name: string;
        phone: string;
        exact_address?: string;
      };
      budget?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "range";
            min_fen: number;
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_most";
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_least";
            min_fen: number;
            currency: "CNY";
          };
      /**
       * @minItems 0
       * @maxItems 8
       */
      attachments?: {
        file_id: string;
        usage: "image" | "document";
      }[];
      type: "agriculture";
      sub_type?: "harvest" | "sales" | "drone_service";
      business_scene?: "village";
      region_id?: string;
      extra?: {
        live_location_kind?: "campus_live_base" | "local_orchard";
        product_type?: string;
        product_name?: string;
        yield_value?: number;
        yield_unit?: string;
        logistics?: string;
        help_period?: string;
        crop_name?: string;
        operation_area?: {
          value: number;
          unit: "mu" | "hectare" | "square_meter";
        };
        equipment_provider?: "publisher" | "service_party" | "negotiable";
      };
    }
  | {
      schema_version: 1;
      title?: string;
      content?: string;
      location_text?: string;
      service_time?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "period";
            description: string;
          }
        | {
            kind: "scheduled";
            start_at: number;
            end_at?: number;
          };
      expires_at?: number;
      contact?: {
        name: string;
        phone: string;
        exact_address?: string;
      };
      budget?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "range";
            min_fen: number;
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_most";
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_least";
            min_fen: number;
            currency: "CNY";
          };
      /**
       * @minItems 0
       * @maxItems 8
       */
      attachments?: {
        file_id: string;
        usage: "image" | "document";
      }[];
      type: "research";
      sub_type?: "planting" | "mechanical" | "intelligent";
      business_scene?: "village";
      region_id?: string;
      extra?: {
        project_stage?: string;
        target_university?: string;
        funding_source?: "none" | "self_funded" | "subsidy_application";
        /**
         * @minItems 0
         * @maxItems 20
         */
        lab_conditions?: string[];
      };
    }
  | {
      schema_version: 1;
      title?: string;
      content?: string;
      location_text?: string;
      service_time?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "period";
            description: string;
          }
        | {
            kind: "scheduled";
            start_at: number;
            end_at?: number;
          };
      expires_at?: number;
      contact?: {
        name: string;
        phone: string;
        exact_address?: string;
      };
      budget?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "range";
            min_fen: number;
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_most";
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_least";
            min_fen: number;
            currency: "CNY";
          };
      /**
       * @minItems 0
       * @maxItems 8
       */
      attachments?: {
        file_id: string;
        usage: "image" | "document";
      }[];
      type: "campus";
      sub_type?: "learning_research" | "activity_support" | "technical_support" | "daily_help" | "other";
      business_scene?: "campus";
      campus_organization_id?: "sztu";
      extra?: {};
    };
export interface RoleGrantDTO {
  grant_id: string;
  role: "general_user" | "farmer" | "teacher_student" | "local_admin" | "super_admin";
  profile_kind: ("farmer" | "merchant" | "teacher" | "student") | null;
  organization_id: string | null;
  scope_type: "self" | "region" | "platform";
  scope_region_id: string | null;
  status: "active" | "revoked" | "expired";
  expires_at: number | null;
  renewed_from: string | null;
}
export interface UserMeDTO {
  user_id: string;
  user_code: string;
  display_name: string;
  avatar_file_id: string | null;
  account_status: "active" | "banned" | "deactivated";
  /**
   * @minItems 0
   * @maxItems 100
   */
  grants: {
    grant_id: string;
    role: "general_user" | "farmer" | "teacher_student" | "local_admin" | "super_admin";
    profile_kind: ("farmer" | "merchant" | "teacher" | "student") | null;
    organization_id: string | null;
    scope_type: "self" | "region" | "platform";
    scope_region_id: string | null;
    status: "active" | "revoked" | "expired";
    expires_at: number | null;
    renewed_from: string | null;
  }[];
  auth_version: number;
  /**
   * @minItems 0
   * @maxItems 1000
   */
  application_summaries: {
    application_id: string;
    requested_role: "general_user" | "farmer" | "teacher_student" | "local_admin" | "super_admin";
    status: "pending" | "approved" | "rejected" | "withdrawn";
  }[];
}
export interface DemandMutationResult {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
}
export interface PublicDemandDTO {
  demand_id: string;
  title: string;
  content: string;
  type: "enterprise" | "agriculture" | "research" | "campus";
  sub_type: string;
  business_scene: "village" | "campus";
  region_id: string | null;
  region_name: string | null;
  campus_organization_id: string | null;
  campus_name: string | null;
  location_text: string;
  service_time:
    | {
        kind: "negotiable";
      }
    | {
        kind: "period";
        description: string;
      }
    | {
        kind: "scheduled";
        start_at: number;
        end_at?: number;
      };
  budget:
    | (
        | {
            kind: "negotiable";
          }
        | {
            kind: "range";
            min_fen: number;
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_most";
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_least";
            min_fen: number;
            currency: "CNY";
          }
      )
    | null;
  public_extra:
    | {
        coop_period?: string;
        company_scale?: string;
        urgency?: "normal" | "urgent" | "critical";
      }
    | {
        live_location_kind?: "campus_live_base" | "local_orchard";
        product_type?: string;
        product_name?: string;
        yield_value?: number;
        yield_unit?: string;
        logistics?: string;
        help_period?: string;
        crop_name?: string;
        operation_area?: {
          value: number;
          unit: "mu" | "hectare" | "square_meter";
        };
        equipment_provider?: "publisher" | "service_party" | "negotiable";
      }
    | {
        project_stage?: string;
        target_university?: string;
        funding_source?: "none" | "self_funded" | "subsidy_application";
        /**
         * @minItems 0
         * @maxItems 20
         */
        lab_conditions?: string[];
      }
    | {};
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 5
   */
  image_ids: string[];
  approved_at: number;
  expires_at: number;
}
export interface UserServiceBootstrapRequest {}
export interface UserServiceBootstrapResponse {
  user_id: string;
  user_code: string;
  display_name: string;
  avatar_file_id: string | null;
  account_status: "active" | "banned" | "deactivated";
  /**
   * @minItems 0
   * @maxItems 100
   */
  grants: {
    grant_id: string;
    role: "general_user" | "farmer" | "teacher_student" | "local_admin" | "super_admin";
    profile_kind: ("farmer" | "merchant" | "teacher" | "student") | null;
    organization_id: string | null;
    scope_type: "self" | "region" | "platform";
    scope_region_id: string | null;
    status: "active" | "revoked" | "expired";
    expires_at: number | null;
    renewed_from: string | null;
  }[];
  auth_version: number;
  /**
   * @minItems 0
   * @maxItems 1000
   */
  application_summaries: {
    application_id: string;
    requested_role: "general_user" | "farmer" | "teacher_student" | "local_admin" | "super_admin";
    status: "pending" | "approved" | "rejected" | "withdrawn";
  }[];
}
export interface UserServiceGetReadinessRequest {}
export interface UserServiceGetReadinessResponse {
  migration_verified: boolean;
  state: "verified" | "migration_required" | "unavailable";
}
export interface UserServiceGetMeRequest {}
export interface UserServiceGetMeResponse {
  user_id: string;
  user_code: string;
  display_name: string;
  avatar_file_id: string | null;
  account_status: "active" | "banned" | "deactivated";
  /**
   * @minItems 0
   * @maxItems 100
   */
  grants: {
    grant_id: string;
    role: "general_user" | "farmer" | "teacher_student" | "local_admin" | "super_admin";
    profile_kind: ("farmer" | "merchant" | "teacher" | "student") | null;
    organization_id: string | null;
    scope_type: "self" | "region" | "platform";
    scope_region_id: string | null;
    status: "active" | "revoked" | "expired";
    expires_at: number | null;
    renewed_from: string | null;
  }[];
  auth_version: number;
  /**
   * @minItems 0
   * @maxItems 1000
   */
  application_summaries: {
    application_id: string;
    requested_role: "general_user" | "farmer" | "teacher_student" | "local_admin" | "super_admin";
    status: "pending" | "approved" | "rejected" | "withdrawn";
  }[];
}
export interface UserServiceUpdateProfileRequest {
  display_name?: string;
  avatar_file_id?: string;
}
export interface UserServiceUpdateProfileResponse {
  user_id: string;
  user_code: string;
  display_name: string;
  avatar_file_id: string | null;
  account_status: "active" | "banned" | "deactivated";
  /**
   * @minItems 0
   * @maxItems 100
   */
  grants: {
    grant_id: string;
    role: "general_user" | "farmer" | "teacher_student" | "local_admin" | "super_admin";
    profile_kind: ("farmer" | "merchant" | "teacher" | "student") | null;
    organization_id: string | null;
    scope_type: "self" | "region" | "platform";
    scope_region_id: string | null;
    status: "active" | "revoked" | "expired";
    expires_at: number | null;
    renewed_from: string | null;
  }[];
  auth_version: number;
  /**
   * @minItems 0
   * @maxItems 1000
   */
  application_summaries: {
    application_id: string;
    requested_role: "general_user" | "farmer" | "teacher_student" | "local_admin" | "super_admin";
    status: "pending" | "approved" | "rejected" | "withdrawn";
  }[];
}
export interface UserServiceListRegionsRequest {
  parent_id?: string;
}
export interface UserServiceListRegionsResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    region_id: string;
    name: string;
    level: string;
  }[];
}
export type UserServiceApplyRoleRequest =
  | {
      /**
       * @minItems 1
       * @maxItems 5
       */
      material_ids: string[];
      contact_name: string;
      contact_phone: string;
      requested_role: "farmer";
      profile_kind: "farmer" | "merchant";
      scope_region_id: string;
      business_description: string;
      proof_kind: "land_proof" | "business_license" | "operation_photo";
    }
  | {
      /**
       * @minItems 1
       * @maxItems 5
       */
      material_ids: string[];
      contact_name: string;
      contact_phone: string;
      requested_role: "teacher_student";
      profile_kind: "teacher" | "student";
      organization_id: "sztu";
      school_identity_number: string;
    }
  | {
      /**
       * @minItems 1
       * @maxItems 5
       */
      material_ids: string[];
      contact_name: string;
      contact_phone: string;
      requested_role: "local_admin";
      scope_region_id: string;
      organization_id: string;
    };
export interface UserServiceApplyRoleResponse {
  application_id: string;
  status: "pending";
}
export interface UserServiceApplyRenewalRequest {
  /**
   * @minItems 1
   * @maxItems 5
   */
  material_ids: string[];
  contact_name: string;
  contact_phone: string;
  source_grant_id: string;
  profile_kind: "teacher" | "student";
  school_identity_number: string;
}
export interface UserServiceApplyRenewalResponse {
  application_id: string;
  status: "pending";
}
export interface UserServiceListMyApplicationsRequest {
  cursor?: string;
  page_size?: number;
}
export interface UserServiceListMyApplicationsResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    application_id: string;
    requested_role: "general_user" | "farmer" | "teacher_student" | "local_admin" | "super_admin";
    profile_kind: ("farmer" | "merchant" | "teacher" | "student") | null;
    scope_region_id: string | null;
    organization_id: string | null;
    review_scope: string;
    status: "pending" | "approved" | "rejected" | "withdrawn";
    version: number;
    created_at: number;
    reason: string | null;
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface UserServiceGetApplicationRequest {
  application_id: string;
}
export interface UserServiceGetApplicationResponse {
  application: {
    application_id: string;
    requested_role: "general_user" | "farmer" | "teacher_student" | "local_admin" | "super_admin";
    profile_kind: ("farmer" | "merchant" | "teacher" | "student") | null;
    scope_region_id: string | null;
    organization_id: string | null;
    review_scope: string;
    status: "pending" | "approved" | "rejected" | "withdrawn";
    version: number;
    created_at: number;
    reason: string | null;
  };
  /**
   * @minItems 0
   * @maxItems 5
   */
  material_ids: string[];
  details: {
    contact_name: string;
    contact_phone: string;
    school_identity_number?: string;
    business_description?: string;
    proof_kind?: "land_proof" | "business_license" | "operation_photo";
  };
}
export interface UserServiceGetMyContactRequest {}
export interface UserServiceGetMyContactResponse {
  contact_name: string;
  contact_phone: string;
  source_application_id: string | null;
}
export interface UserServiceListPendingApplicationsRequest {
  cursor?: string;
  page_size?: number;
  queue: "farmer" | "teacher_student" | "local_admin";
  region_id?: string;
}
export interface UserServiceListPendingApplicationsResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    application_id: string;
    requested_role: "general_user" | "farmer" | "teacher_student" | "local_admin" | "super_admin";
    profile_kind: ("farmer" | "merchant" | "teacher" | "student") | null;
    scope_region_id: string | null;
    organization_id: string | null;
    review_scope: string;
    status: "pending" | "approved" | "rejected" | "withdrawn";
    version: number;
    created_at: number;
    reason: string | null;
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface UserServiceWithdrawApplicationRequest {
  application_id: string;
  expected_version: number;
}
export interface UserServiceWithdrawApplicationResponse {
  application_id: string;
  status: "withdrawn";
  version: number;
}
export interface UserServiceReviewRoleApplicationRequest {
  application_id: string;
  expected_version: number;
  decision: "approve" | "reject";
  reason?: string;
}
export interface UserServiceReviewRoleApplicationResponse {
  application_id: string;
  status: "approved" | "rejected";
  grant_id?: string;
}
export interface UserServiceListGrantsRequest {
  cursor?: string;
  page_size?: number;
  user_id?: string;
}
export interface UserServiceListGrantsResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    grant_id: string;
    role: "general_user" | "farmer" | "teacher_student" | "local_admin" | "super_admin";
    profile_kind: ("farmer" | "merchant" | "teacher" | "student") | null;
    organization_id: string | null;
    scope_type: "self" | "region" | "platform";
    scope_region_id: string | null;
    status: "active" | "revoked" | "expired";
    expires_at: number | null;
    renewed_from: string | null;
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface UserServiceRequestDelegationRequest {
  beneficiary_user_id: string;
  draft:
    | {
        schema_version: 1;
        title?: string;
        content?: string;
        location_text?: string;
        service_time?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        expires_at?: number;
        contact?: {
          name: string;
          phone: string;
          exact_address?: string;
        };
        budget?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            };
        /**
         * @minItems 0
         * @maxItems 8
         */
        attachments?: {
          file_id: string;
          usage: "image" | "document";
        }[];
        type: "enterprise";
        sub_type?: "production_tech" | "talent_recruit";
        business_scene?: "village";
        region_id?: string;
        extra?: {
          coop_period?: string;
          company_scale?: string;
          urgency?: "normal" | "urgent" | "critical";
        };
      }
    | {
        schema_version: 1;
        title?: string;
        content?: string;
        location_text?: string;
        service_time?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        expires_at?: number;
        contact?: {
          name: string;
          phone: string;
          exact_address?: string;
        };
        budget?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            };
        /**
         * @minItems 0
         * @maxItems 8
         */
        attachments?: {
          file_id: string;
          usage: "image" | "document";
        }[];
        type: "agriculture";
        sub_type?: "harvest" | "sales" | "drone_service";
        business_scene?: "village";
        region_id?: string;
        extra?: {
          live_location_kind?: "campus_live_base" | "local_orchard";
          product_type?: string;
          product_name?: string;
          yield_value?: number;
          yield_unit?: string;
          logistics?: string;
          help_period?: string;
          crop_name?: string;
          operation_area?: {
            value: number;
            unit: "mu" | "hectare" | "square_meter";
          };
          equipment_provider?: "publisher" | "service_party" | "negotiable";
        };
      }
    | {
        schema_version: 1;
        title?: string;
        content?: string;
        location_text?: string;
        service_time?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        expires_at?: number;
        contact?: {
          name: string;
          phone: string;
          exact_address?: string;
        };
        budget?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            };
        /**
         * @minItems 0
         * @maxItems 8
         */
        attachments?: {
          file_id: string;
          usage: "image" | "document";
        }[];
        type: "research";
        sub_type?: "planting" | "mechanical" | "intelligent";
        business_scene?: "village";
        region_id?: string;
        extra?: {
          project_stage?: string;
          target_university?: string;
          funding_source?: "none" | "self_funded" | "subsidy_application";
          /**
           * @minItems 0
           * @maxItems 20
           */
          lab_conditions?: string[];
        };
      }
    | {
        schema_version: 1;
        title?: string;
        content?: string;
        location_text?: string;
        service_time?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        expires_at?: number;
        contact?: {
          name: string;
          phone: string;
          exact_address?: string;
        };
        budget?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            };
        /**
         * @minItems 0
         * @maxItems 8
         */
        attachments?: {
          file_id: string;
          usage: "image" | "document";
        }[];
        type: "campus";
        sub_type?: "learning_research" | "activity_support" | "technical_support" | "daily_help" | "other";
        business_scene?: "campus";
        campus_organization_id?: "sztu";
        extra?: {};
      };
}
export interface UserServiceRequestDelegationResponse {
  authorization_id: string;
  beneficiary_id: string;
  delegate_id: string;
  status: "pending" | "approved" | "rejected" | "revoked" | "consumed";
  version: number;
  created_at: number;
  consumed_demand_id: string | null;
}
export interface UserServiceGetDelegationRequest {
  authorization_id: string;
}
export interface UserServiceGetDelegationResponse {
  authorization: {
    authorization_id: string;
    beneficiary_id: string;
    delegate_id: string;
    status: "pending" | "approved" | "rejected" | "revoked" | "consumed";
    version: number;
    created_at: number;
    consumed_demand_id: string | null;
  };
  draft:
    | {
        schema_version: 1;
        title?: string;
        content?: string;
        location_text?: string;
        service_time?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        expires_at?: number;
        contact?: {
          name: string;
          phone: string;
          exact_address?: string;
        };
        budget?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            };
        /**
         * @minItems 0
         * @maxItems 8
         */
        attachments?: {
          file_id: string;
          usage: "image" | "document";
        }[];
        type: "enterprise";
        sub_type?: "production_tech" | "talent_recruit";
        business_scene?: "village";
        region_id?: string;
        extra?: {
          coop_period?: string;
          company_scale?: string;
          urgency?: "normal" | "urgent" | "critical";
        };
      }
    | {
        schema_version: 1;
        title?: string;
        content?: string;
        location_text?: string;
        service_time?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        expires_at?: number;
        contact?: {
          name: string;
          phone: string;
          exact_address?: string;
        };
        budget?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            };
        /**
         * @minItems 0
         * @maxItems 8
         */
        attachments?: {
          file_id: string;
          usage: "image" | "document";
        }[];
        type: "agriculture";
        sub_type?: "harvest" | "sales" | "drone_service";
        business_scene?: "village";
        region_id?: string;
        extra?: {
          live_location_kind?: "campus_live_base" | "local_orchard";
          product_type?: string;
          product_name?: string;
          yield_value?: number;
          yield_unit?: string;
          logistics?: string;
          help_period?: string;
          crop_name?: string;
          operation_area?: {
            value: number;
            unit: "mu" | "hectare" | "square_meter";
          };
          equipment_provider?: "publisher" | "service_party" | "negotiable";
        };
      }
    | {
        schema_version: 1;
        title?: string;
        content?: string;
        location_text?: string;
        service_time?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        expires_at?: number;
        contact?: {
          name: string;
          phone: string;
          exact_address?: string;
        };
        budget?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            };
        /**
         * @minItems 0
         * @maxItems 8
         */
        attachments?: {
          file_id: string;
          usage: "image" | "document";
        }[];
        type: "research";
        sub_type?: "planting" | "mechanical" | "intelligent";
        business_scene?: "village";
        region_id?: string;
        extra?: {
          project_stage?: string;
          target_university?: string;
          funding_source?: "none" | "self_funded" | "subsidy_application";
          /**
           * @minItems 0
           * @maxItems 20
           */
          lab_conditions?: string[];
        };
      }
    | {
        schema_version: 1;
        title?: string;
        content?: string;
        location_text?: string;
        service_time?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        expires_at?: number;
        contact?: {
          name: string;
          phone: string;
          exact_address?: string;
        };
        budget?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            };
        /**
         * @minItems 0
         * @maxItems 8
         */
        attachments?: {
          file_id: string;
          usage: "image" | "document";
        }[];
        type: "campus";
        sub_type?: "learning_research" | "activity_support" | "technical_support" | "daily_help" | "other";
        business_scene?: "campus";
        campus_organization_id?: "sztu";
        extra?: {};
      };
}
export interface UserServiceListMyDelegationsRequest {
  cursor?: string;
  page_size?: number;
  status?: "pending" | "approved" | "rejected" | "revoked" | "consumed";
}
export interface UserServiceListMyDelegationsResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    authorization_id: string;
    beneficiary_id: string;
    delegate_id: string;
    status: "pending" | "approved" | "rejected" | "revoked" | "consumed";
    version: number;
    created_at: number;
    consumed_demand_id: string | null;
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface UserServiceRespondDelegationRequest {
  authorization_id: string;
  expected_version: number;
  decision: "approve" | "reject";
  confirmed_demand?:
    | {
        schema_version: 1;
        title: string;
        content: string;
        location_text: string;
        service_time:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        expires_at?: number;
        contact: {
          name: string;
          phone: string;
          exact_address?: string;
        };
        budget?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            };
        /**
         * @minItems 0
         * @maxItems 8
         */
        attachments?: {
          file_id: string;
          usage: "image" | "document";
        }[];
        type: "enterprise";
        sub_type: "production_tech" | "talent_recruit";
        business_scene: "village";
        region_id: string;
        extra?: {
          coop_period?: string;
          company_scale?: string;
          urgency?: "normal" | "urgent" | "critical";
        };
      }
    | {
        schema_version: 1;
        title: string;
        content: string;
        location_text: string;
        service_time:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        expires_at?: number;
        contact: {
          name: string;
          phone: string;
          exact_address?: string;
        };
        budget?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            };
        /**
         * @minItems 0
         * @maxItems 8
         */
        attachments?: {
          file_id: string;
          usage: "image" | "document";
        }[];
        type: "agriculture";
        sub_type: "harvest" | "sales" | "drone_service";
        business_scene: "village";
        region_id: string;
        extra?: {
          live_location_kind?: "campus_live_base" | "local_orchard";
          product_type?: string;
          product_name?: string;
          yield_value?: number;
          yield_unit?: string;
          logistics?: string;
          help_period?: string;
          crop_name?: string;
          operation_area?: {
            value: number;
            unit: "mu" | "hectare" | "square_meter";
          };
          equipment_provider?: "publisher" | "service_party" | "negotiable";
        };
      }
    | {
        schema_version: 1;
        title: string;
        content: string;
        location_text: string;
        service_time:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        expires_at?: number;
        contact: {
          name: string;
          phone: string;
          exact_address?: string;
        };
        budget?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            };
        /**
         * @minItems 0
         * @maxItems 8
         */
        attachments?: {
          file_id: string;
          usage: "image" | "document";
        }[];
        type: "research";
        sub_type: "planting" | "mechanical" | "intelligent";
        business_scene: "village";
        region_id: string;
        extra?: {
          project_stage?: string;
          target_university?: string;
          funding_source?: "none" | "self_funded" | "subsidy_application";
          /**
           * @minItems 0
           * @maxItems 20
           */
          lab_conditions?: string[];
        };
      }
    | {
        schema_version: 1;
        title: string;
        content: string;
        location_text: string;
        service_time:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        expires_at?: number;
        contact: {
          name: string;
          phone: string;
          exact_address?: string;
        };
        budget?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            };
        /**
         * @minItems 0
         * @maxItems 8
         */
        attachments?: {
          file_id: string;
          usage: "image" | "document";
        }[];
        type: "campus";
        sub_type: "learning_research" | "activity_support" | "technical_support" | "daily_help" | "other";
        business_scene: "campus";
        campus_organization_id: "sztu";
        extra?: {};
      };
}
export interface UserServiceRespondDelegationResponse {
  authorization_id: string;
  beneficiary_id: string;
  delegate_id: string;
  status: "pending" | "approved" | "rejected" | "revoked" | "consumed";
  version: number;
  created_at: number;
  consumed_demand_id: string | null;
}
export interface UserServiceRevokeDelegationRequest {
  authorization_id: string;
  expected_version: number;
}
export interface UserServiceRevokeDelegationResponse {
  authorization_id: string;
  beneficiary_id: string;
  delegate_id: string;
  status: "pending" | "approved" | "rejected" | "revoked" | "consumed";
  version: number;
  created_at: number;
  consumed_demand_id: string | null;
}
export interface UserServiceRevokeGrantRequest {
  grant_id: string;
  reason: string;
}
export interface UserServiceRevokeGrantResponse {
  grant_id: string;
  status: "revoked";
}
export interface UserServiceGrantManagementRoleRequest {
  target_user_id: string;
  role: "local_admin" | "super_admin";
  scope_region_id?: string;
  organization_id?: string;
  reason: string;
}
export interface UserServiceGrantManagementRoleResponse {
  grant_id: string;
  role: "general_user" | "farmer" | "teacher_student" | "local_admin" | "super_admin";
  profile_kind: ("farmer" | "merchant" | "teacher" | "student") | null;
  organization_id: string | null;
  scope_type: "self" | "region" | "platform";
  scope_region_id: string | null;
  status: "active" | "revoked" | "expired";
  expires_at: number | null;
  renewed_from: string | null;
}
export interface DemandServiceGetFormSchemaRequest {
  type: "enterprise" | "agriculture" | "research" | "campus";
  schema_version?: number;
}
export interface DemandServiceGetFormSchemaResponse {
  type: "enterprise" | "agriculture" | "research" | "campus";
  schema_version: number;
  definition_json: string;
  content_hash: string;
}
export interface DemandServiceListPublicRequest {
  cursor?: string;
  page_size?: number;
  business_scene?: "village" | "campus";
  type?: "enterprise" | "agriculture" | "research" | "campus";
  sub_type?: string;
  region_id?: string;
  campus_organization_id?: string;
  keyword?: string;
}
export interface DemandServiceListPublicResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    demand_id: string;
    title: string;
    content: string;
    type: "enterprise" | "agriculture" | "research" | "campus";
    sub_type: string;
    business_scene: "village" | "campus";
    region_id: string | null;
    region_name: string | null;
    campus_organization_id: string | null;
    campus_name: string | null;
    location_text: string;
    service_time:
      | {
          kind: "negotiable";
        }
      | {
          kind: "period";
          description: string;
        }
      | {
          kind: "scheduled";
          start_at: number;
          end_at?: number;
        };
    budget:
      | (
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            }
        )
      | null;
    public_extra:
      | {
          coop_period?: string;
          company_scale?: string;
          urgency?: "normal" | "urgent" | "critical";
        }
      | {
          live_location_kind?: "campus_live_base" | "local_orchard";
          product_type?: string;
          product_name?: string;
          yield_value?: number;
          yield_unit?: string;
          logistics?: string;
          help_period?: string;
          crop_name?: string;
          operation_area?: {
            value: number;
            unit: "mu" | "hectare" | "square_meter";
          };
          equipment_provider?: "publisher" | "service_party" | "negotiable";
        }
      | {
          project_stage?: string;
          target_university?: string;
          funding_source?: "none" | "self_funded" | "subsidy_application";
          /**
           * @minItems 0
           * @maxItems 20
           */
          lab_conditions?: string[];
        }
      | {};
    status:
      | "draft"
      | "pending_audit"
      | "rejected"
      | "pending_claim"
      | "claiming"
      | "processing"
      | "pending_review"
      | "completed"
      | "cancelled"
      | "expired"
      | "terminated";
    version: number;
    /**
     * @minItems 0
     * @maxItems 5
     */
    image_ids: string[];
    approved_at: number;
    expires_at: number;
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface DemandServiceGetDetailRequest {
  demand_id: string;
}
export interface DemandServiceGetDetailResponse {
  demand:
    | {
        demand_id: string;
        title: string;
        content: string;
        type: "enterprise" | "agriculture" | "research" | "campus";
        sub_type: string;
        business_scene: "village" | "campus";
        region_id: string | null;
        region_name: string | null;
        campus_organization_id: string | null;
        campus_name: string | null;
        location_text: string;
        service_time:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        budget:
          | (
              | {
                  kind: "negotiable";
                }
              | {
                  kind: "range";
                  min_fen: number;
                  max_fen: number;
                  currency: "CNY";
                }
              | {
                  kind: "at_most";
                  max_fen: number;
                  currency: "CNY";
                }
              | {
                  kind: "at_least";
                  min_fen: number;
                  currency: "CNY";
                }
            )
          | null;
        public_extra:
          | {
              coop_period?: string;
              company_scale?: string;
              urgency?: "normal" | "urgent" | "critical";
            }
          | {
              live_location_kind?: "campus_live_base" | "local_orchard";
              product_type?: string;
              product_name?: string;
              yield_value?: number;
              yield_unit?: string;
              logistics?: string;
              help_period?: string;
              crop_name?: string;
              operation_area?: {
                value: number;
                unit: "mu" | "hectare" | "square_meter";
              };
              equipment_provider?: "publisher" | "service_party" | "negotiable";
            }
          | {
              project_stage?: string;
              target_university?: string;
              funding_source?: "none" | "self_funded" | "subsidy_application";
              /**
               * @minItems 0
               * @maxItems 20
               */
              lab_conditions?: string[];
            }
          | {};
        status:
          | "draft"
          | "pending_audit"
          | "rejected"
          | "pending_claim"
          | "claiming"
          | "processing"
          | "pending_review"
          | "completed"
          | "cancelled"
          | "expired"
          | "terminated";
        version: number;
        /**
         * @minItems 0
         * @maxItems 5
         */
        image_ids: string[];
        approved_at: number;
        expires_at: number;
      }
    | {
        demand_id: string;
        title: string;
        content: string;
        status:
          | "draft"
          | "pending_audit"
          | "rejected"
          | "pending_claim"
          | "claiming"
          | "processing"
          | "pending_review"
          | "completed"
          | "cancelled"
          | "expired"
          | "terminated";
        version: number;
        submission_id: string | null;
        revision: number;
        claim_id: string | null;
        completion_id: string | null;
        owner_id: string;
        updated_at: number;
      };
  /**
   * @minItems 0
   * @maxItems 40
   */
  allowed_actions: string[];
  task_grant_id: string | null;
  /**
   * @minItems 0
   * @maxItems 8
   */
  attachments: {
    file_id: string;
    usage: "image" | "document";
  }[];
  termination_request: {
    request_id: string;
    version: number;
    status: "pending" | "agreed" | "rejected" | "withdrawn" | "disputed" | "resolved" | "superseded";
    initiator_id: string;
    respondent_id: string;
    reason: string;
    response_reason: string | null;
    dispute_reason: string | null;
    resolution_reason: string | null;
    decision: ("terminate" | "continue") | null;
  } | null;
  claim: {
    claim_id: string;
    assignee_type: "user" | "team";
    assignee_id: string;
    responsible_user_id: string;
    /**
     * @minItems 1
     * @maxItems 20
     */
    participant_user_ids: string[];
    roster_version: number;
  } | null;
  roster_request: {
    request_id: string;
    version: number;
    /**
     * @minItems 1
     * @maxItems 20
     */
    participant_user_ids: string[];
    /**
     * @minItems 1
     * @maxItems 20
     */
    participant_labels: {
      user_id: string;
      display_name: string;
    }[];
    responsible_user_id: string;
    reason: string;
  } | null;
  completion: {
    completion_id: string;
    summary: string;
    /**
     * @minItems 0
     * @maxItems 8
     */
    attachment_ids: string[];
    status: "pending" | "returned" | "accepted";
    reason: string | null;
  } | null;
}
export type DemandServiceSaveDraftRequest =
  | {
      schema_version: 1;
      title?: string;
      content?: string;
      location_text?: string;
      service_time?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "period";
            description: string;
          }
        | {
            kind: "scheduled";
            start_at: number;
            end_at?: number;
          };
      expires_at?: number;
      contact?: {
        name: string;
        phone: string;
        exact_address?: string;
      };
      budget?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "range";
            min_fen: number;
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_most";
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_least";
            min_fen: number;
            currency: "CNY";
          };
      /**
       * @minItems 0
       * @maxItems 8
       */
      attachments?: {
        file_id: string;
        usage: "image" | "document";
      }[];
      type: "enterprise";
      sub_type?: "production_tech" | "talent_recruit";
      business_scene?: "village";
      region_id?: string;
      extra?: {
        coop_period?: string;
        company_scale?: string;
        urgency?: "normal" | "urgent" | "critical";
      };
    }
  | {
      schema_version: 1;
      title?: string;
      content?: string;
      location_text?: string;
      service_time?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "period";
            description: string;
          }
        | {
            kind: "scheduled";
            start_at: number;
            end_at?: number;
          };
      expires_at?: number;
      contact?: {
        name: string;
        phone: string;
        exact_address?: string;
      };
      budget?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "range";
            min_fen: number;
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_most";
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_least";
            min_fen: number;
            currency: "CNY";
          };
      /**
       * @minItems 0
       * @maxItems 8
       */
      attachments?: {
        file_id: string;
        usage: "image" | "document";
      }[];
      type: "agriculture";
      sub_type?: "harvest" | "sales" | "drone_service";
      business_scene?: "village";
      region_id?: string;
      extra?: {
        live_location_kind?: "campus_live_base" | "local_orchard";
        product_type?: string;
        product_name?: string;
        yield_value?: number;
        yield_unit?: string;
        logistics?: string;
        help_period?: string;
        crop_name?: string;
        operation_area?: {
          value: number;
          unit: "mu" | "hectare" | "square_meter";
        };
        equipment_provider?: "publisher" | "service_party" | "negotiable";
      };
    }
  | {
      schema_version: 1;
      title?: string;
      content?: string;
      location_text?: string;
      service_time?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "period";
            description: string;
          }
        | {
            kind: "scheduled";
            start_at: number;
            end_at?: number;
          };
      expires_at?: number;
      contact?: {
        name: string;
        phone: string;
        exact_address?: string;
      };
      budget?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "range";
            min_fen: number;
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_most";
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_least";
            min_fen: number;
            currency: "CNY";
          };
      /**
       * @minItems 0
       * @maxItems 8
       */
      attachments?: {
        file_id: string;
        usage: "image" | "document";
      }[];
      type: "research";
      sub_type?: "planting" | "mechanical" | "intelligent";
      business_scene?: "village";
      region_id?: string;
      extra?: {
        project_stage?: string;
        target_university?: string;
        funding_source?: "none" | "self_funded" | "subsidy_application";
        /**
         * @minItems 0
         * @maxItems 20
         */
        lab_conditions?: string[];
      };
    }
  | {
      schema_version: 1;
      title?: string;
      content?: string;
      location_text?: string;
      service_time?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "period";
            description: string;
          }
        | {
            kind: "scheduled";
            start_at: number;
            end_at?: number;
          };
      expires_at?: number;
      contact?: {
        name: string;
        phone: string;
        exact_address?: string;
      };
      budget?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "range";
            min_fen: number;
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_most";
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_least";
            min_fen: number;
            currency: "CNY";
          };
      /**
       * @minItems 0
       * @maxItems 8
       */
      attachments?: {
        file_id: string;
        usage: "image" | "document";
      }[];
      type: "campus";
      sub_type?: "learning_research" | "activity_support" | "technical_support" | "daily_help" | "other";
      business_scene?: "campus";
      campus_organization_id?: "sztu";
      extra?: {};
    };
export interface DemandServiceSaveDraftResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
}
export interface DemandServiceGetContactRequest {
  demand_id: string;
  purpose: string;
}
export interface DemandServiceGetContactResponse {
  name: string;
  phone: string;
}
export interface DemandServiceGetServiceLocationRequest {
  demand_id: string;
}
export interface DemandServiceGetServiceLocationResponse {
  location_text: string;
  exact_address: string | null;
}
export interface DemandServiceListEventsRequest {
  demand_id: string;
  cursor?: string;
  page_size?: number;
}
export interface DemandServiceListEventsResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    event_id: string;
    type: string;
    from_status:
      | "draft"
      | "pending_audit"
      | "rejected"
      | "pending_claim"
      | "claiming"
      | "processing"
      | "pending_review"
      | "completed"
      | "cancelled"
      | "expired"
      | "terminated";
    to_status:
      | "draft"
      | "pending_audit"
      | "rejected"
      | "pending_claim"
      | "claiming"
      | "processing"
      | "pending_review"
      | "completed"
      | "cancelled"
      | "expired"
      | "terminated";
    occurred_at: number;
    text: string | null;
    /**
     * @minItems 0
     * @maxItems 8
     */
    attachment_ids: string[];
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export type DemandServiceCreateAndSubmitRequest =
  | {
      schema_version: 1;
      title: string;
      content: string;
      location_text: string;
      service_time:
        | {
            kind: "negotiable";
          }
        | {
            kind: "period";
            description: string;
          }
        | {
            kind: "scheduled";
            start_at: number;
            end_at?: number;
          };
      expires_at?: number;
      contact: {
        name: string;
        phone: string;
        exact_address?: string;
      };
      budget?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "range";
            min_fen: number;
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_most";
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_least";
            min_fen: number;
            currency: "CNY";
          };
      /**
       * @minItems 0
       * @maxItems 8
       */
      attachments?: {
        file_id: string;
        usage: "image" | "document";
      }[];
      type: "enterprise";
      sub_type: "production_tech" | "talent_recruit";
      business_scene: "village";
      region_id: string;
      extra?: {
        coop_period?: string;
        company_scale?: string;
        urgency?: "normal" | "urgent" | "critical";
      };
    }
  | {
      schema_version: 1;
      title: string;
      content: string;
      location_text: string;
      service_time:
        | {
            kind: "negotiable";
          }
        | {
            kind: "period";
            description: string;
          }
        | {
            kind: "scheduled";
            start_at: number;
            end_at?: number;
          };
      expires_at?: number;
      contact: {
        name: string;
        phone: string;
        exact_address?: string;
      };
      budget?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "range";
            min_fen: number;
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_most";
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_least";
            min_fen: number;
            currency: "CNY";
          };
      /**
       * @minItems 0
       * @maxItems 8
       */
      attachments?: {
        file_id: string;
        usage: "image" | "document";
      }[];
      type: "agriculture";
      sub_type: "harvest" | "sales" | "drone_service";
      business_scene: "village";
      region_id: string;
      extra?: {
        live_location_kind?: "campus_live_base" | "local_orchard";
        product_type?: string;
        product_name?: string;
        yield_value?: number;
        yield_unit?: string;
        logistics?: string;
        help_period?: string;
        crop_name?: string;
        operation_area?: {
          value: number;
          unit: "mu" | "hectare" | "square_meter";
        };
        equipment_provider?: "publisher" | "service_party" | "negotiable";
      };
    }
  | {
      schema_version: 1;
      title: string;
      content: string;
      location_text: string;
      service_time:
        | {
            kind: "negotiable";
          }
        | {
            kind: "period";
            description: string;
          }
        | {
            kind: "scheduled";
            start_at: number;
            end_at?: number;
          };
      expires_at?: number;
      contact: {
        name: string;
        phone: string;
        exact_address?: string;
      };
      budget?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "range";
            min_fen: number;
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_most";
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_least";
            min_fen: number;
            currency: "CNY";
          };
      /**
       * @minItems 0
       * @maxItems 8
       */
      attachments?: {
        file_id: string;
        usage: "image" | "document";
      }[];
      type: "research";
      sub_type: "planting" | "mechanical" | "intelligent";
      business_scene: "village";
      region_id: string;
      extra?: {
        project_stage?: string;
        target_university?: string;
        funding_source?: "none" | "self_funded" | "subsidy_application";
        /**
         * @minItems 0
         * @maxItems 20
         */
        lab_conditions?: string[];
      };
    }
  | {
      schema_version: 1;
      title: string;
      content: string;
      location_text: string;
      service_time:
        | {
            kind: "negotiable";
          }
        | {
            kind: "period";
            description: string;
          }
        | {
            kind: "scheduled";
            start_at: number;
            end_at?: number;
          };
      expires_at?: number;
      contact: {
        name: string;
        phone: string;
        exact_address?: string;
      };
      budget?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "range";
            min_fen: number;
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_most";
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_least";
            min_fen: number;
            currency: "CNY";
          };
      /**
       * @minItems 0
       * @maxItems 8
       */
      attachments?: {
        file_id: string;
        usage: "image" | "document";
      }[];
      type: "campus";
      sub_type: "learning_research" | "activity_support" | "technical_support" | "daily_help" | "other";
      business_scene: "campus";
      campus_organization_id: "sztu";
      extra?: {};
    };
export interface DemandServiceCreateAndSubmitResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
}
export interface DemandServiceCreateDelegatedDemandRequest {
  authorization_id: string;
}
export interface DemandServiceCreateDelegatedDemandResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
}
export interface DemandServiceRequestRosterChangeRequest {
  demand_id: string;
  expected_version: number;
  claim_id: string;
  base_roster_version: number;
  /**
   * @minItems 1
   * @maxItems 20
   */
  participant_user_ids: string[];
  responsible_user_id: string;
  reason: string;
}
export interface DemandServiceRequestRosterChangeResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
  roster_change_request_id: string;
}
export interface DemandServiceReviewRosterChangeRequest {
  demand_id: string;
  expected_version: number;
  roster_change_request_id: string;
  request_version: number;
  decision: "approve" | "reject";
  reason?: string;
}
export interface DemandServiceReviewRosterChangeResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
}
export interface DemandServiceSubmitRequest {
  demand_id: string;
  expected_version: number;
}
export interface DemandServiceSubmitResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
}
export interface DemandServiceReopenRejectedRequest {
  demand_id: string;
  expected_version: number;
}
export interface DemandServiceReopenRejectedResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
}
export interface DemandServiceWithdrawSubmissionRequest {
  demand_id: string;
  expected_version: number;
  submission_id: string;
}
export interface DemandServiceWithdrawSubmissionResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
}
export interface DemandServiceReviewRequest {
  demand_id: string;
  expected_version: number;
  submission_id: string;
  revision: number;
  decision: "approve" | "reject";
  reason?: string;
}
export interface DemandServiceReviewResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
}
export interface DemandServiceCancelRequest {
  demand_id: string;
  expected_version: number;
  reason: string;
}
export interface DemandServiceCancelResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
}
export interface DemandServiceHideRequest {
  demand_id: string;
  expected_version: number;
  reason: string;
}
export interface DemandServiceHideResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
}
export interface DemandServiceRestoreVisibilityRequest {
  demand_id: string;
  expected_version: number;
  reason: string;
}
export interface DemandServiceRestoreVisibilityResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
}
export interface DemandServiceEditAndResubmitRequest {
  demand_id: string;
  expected_version: number;
  replacement:
    | {
        schema_version: 1;
        title: string;
        content: string;
        location_text: string;
        service_time:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        expires_at?: number;
        contact: {
          name: string;
          phone: string;
          exact_address?: string;
        };
        budget?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            };
        /**
         * @minItems 0
         * @maxItems 8
         */
        attachments?: {
          file_id: string;
          usage: "image" | "document";
        }[];
        type: "enterprise";
        sub_type: "production_tech" | "talent_recruit";
        business_scene: "village";
        region_id: string;
        extra?: {
          coop_period?: string;
          company_scale?: string;
          urgency?: "normal" | "urgent" | "critical";
        };
      }
    | {
        schema_version: 1;
        title: string;
        content: string;
        location_text: string;
        service_time:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        expires_at?: number;
        contact: {
          name: string;
          phone: string;
          exact_address?: string;
        };
        budget?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            };
        /**
         * @minItems 0
         * @maxItems 8
         */
        attachments?: {
          file_id: string;
          usage: "image" | "document";
        }[];
        type: "agriculture";
        sub_type: "harvest" | "sales" | "drone_service";
        business_scene: "village";
        region_id: string;
        extra?: {
          live_location_kind?: "campus_live_base" | "local_orchard";
          product_type?: string;
          product_name?: string;
          yield_value?: number;
          yield_unit?: string;
          logistics?: string;
          help_period?: string;
          crop_name?: string;
          operation_area?: {
            value: number;
            unit: "mu" | "hectare" | "square_meter";
          };
          equipment_provider?: "publisher" | "service_party" | "negotiable";
        };
      }
    | {
        schema_version: 1;
        title: string;
        content: string;
        location_text: string;
        service_time:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        expires_at?: number;
        contact: {
          name: string;
          phone: string;
          exact_address?: string;
        };
        budget?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            };
        /**
         * @minItems 0
         * @maxItems 8
         */
        attachments?: {
          file_id: string;
          usage: "image" | "document";
        }[];
        type: "research";
        sub_type: "planting" | "mechanical" | "intelligent";
        business_scene: "village";
        region_id: string;
        extra?: {
          project_stage?: string;
          target_university?: string;
          funding_source?: "none" | "self_funded" | "subsidy_application";
          /**
           * @minItems 0
           * @maxItems 20
           */
          lab_conditions?: string[];
        };
      }
    | {
        schema_version: 1;
        title: string;
        content: string;
        location_text: string;
        service_time:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        expires_at?: number;
        contact: {
          name: string;
          phone: string;
          exact_address?: string;
        };
        budget?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            };
        /**
         * @minItems 0
         * @maxItems 8
         */
        attachments?: {
          file_id: string;
          usage: "image" | "document";
        }[];
        type: "campus";
        sub_type: "learning_research" | "activity_support" | "technical_support" | "daily_help" | "other";
        business_scene: "campus";
        campus_organization_id: "sztu";
        extra?: {};
      };
}
export interface DemandServiceEditAndResubmitResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
}
export interface DemandServiceCloneDemandRequest {
  source_demand_id: string;
}
export interface DemandServiceCloneDemandResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
}
export interface DemandServiceUpdateDraftRequest {
  demand_id: string;
  expected_version: number;
  patch:
    | {
        schema_version?: 1;
        title?: string;
        content?: string;
        location_text?: string;
        service_time?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        expires_at?: number;
        contact?: {
          name: string;
          phone: string;
          exact_address?: string;
        };
        budget?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            };
        /**
         * @minItems 0
         * @maxItems 8
         */
        attachments?: {
          file_id: string;
          usage: "image" | "document";
        }[];
        type?: "enterprise";
        sub_type?: "production_tech" | "talent_recruit";
        business_scene?: "village";
        region_id?: string;
        extra?: {
          coop_period?: string;
          company_scale?: string;
          urgency?: "normal" | "urgent" | "critical";
        };
      }
    | {
        schema_version?: 1;
        title?: string;
        content?: string;
        location_text?: string;
        service_time?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        expires_at?: number;
        contact?: {
          name: string;
          phone: string;
          exact_address?: string;
        };
        budget?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            };
        /**
         * @minItems 0
         * @maxItems 8
         */
        attachments?: {
          file_id: string;
          usage: "image" | "document";
        }[];
        type?: "agriculture";
        sub_type?: "harvest" | "sales" | "drone_service";
        business_scene?: "village";
        region_id?: string;
        extra?: {
          live_location_kind?: "campus_live_base" | "local_orchard";
          product_type?: string;
          product_name?: string;
          yield_value?: number;
          yield_unit?: string;
          logistics?: string;
          help_period?: string;
          crop_name?: string;
          operation_area?: {
            value: number;
            unit: "mu" | "hectare" | "square_meter";
          };
          equipment_provider?: "publisher" | "service_party" | "negotiable";
        };
      }
    | {
        schema_version?: 1;
        title?: string;
        content?: string;
        location_text?: string;
        service_time?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        expires_at?: number;
        contact?: {
          name: string;
          phone: string;
          exact_address?: string;
        };
        budget?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            };
        /**
         * @minItems 0
         * @maxItems 8
         */
        attachments?: {
          file_id: string;
          usage: "image" | "document";
        }[];
        type?: "research";
        sub_type?: "planting" | "mechanical" | "intelligent";
        business_scene?: "village";
        region_id?: string;
        extra?: {
          project_stage?: string;
          target_university?: string;
          funding_source?: "none" | "self_funded" | "subsidy_application";
          /**
           * @minItems 0
           * @maxItems 20
           */
          lab_conditions?: string[];
        };
      }
    | {
        schema_version?: 1;
        title?: string;
        content?: string;
        location_text?: string;
        service_time?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        expires_at?: number;
        contact?: {
          name: string;
          phone: string;
          exact_address?: string;
        };
        budget?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            };
        /**
         * @minItems 0
         * @maxItems 8
         */
        attachments?: {
          file_id: string;
          usage: "image" | "document";
        }[];
        type?: "campus";
        sub_type?: "learning_research" | "activity_support" | "technical_support" | "daily_help" | "other";
        business_scene?: "campus";
        campus_organization_id?: "sztu";
        extra?: {};
      };
}
export interface DemandServiceUpdateDraftResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
}
export interface DemandServiceListMineRequest {
  cursor?: string;
  page_size?: number;
  status?:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  business_scene?: "village" | "campus";
  region_id?: string;
}
export interface DemandServiceListMineResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    demand_id: string;
    title: string;
    content: string;
    status:
      | "draft"
      | "pending_audit"
      | "rejected"
      | "pending_claim"
      | "claiming"
      | "processing"
      | "pending_review"
      | "completed"
      | "cancelled"
      | "expired"
      | "terminated";
    version: number;
    submission_id: string | null;
    revision: number;
    claim_id: string | null;
    completion_id: string | null;
    owner_id: string;
    updated_at: number;
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface DemandServiceListCreatedByMeRequest {
  cursor?: string;
  page_size?: number;
  status?:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  business_scene?: "village" | "campus";
  region_id?: string;
}
export interface DemandServiceListCreatedByMeResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    demand_id: string;
    title: string;
    content: string;
    status:
      | "draft"
      | "pending_audit"
      | "rejected"
      | "pending_claim"
      | "claiming"
      | "processing"
      | "pending_review"
      | "completed"
      | "cancelled"
      | "expired"
      | "terminated";
    version: number;
    submission_id: string | null;
    revision: number;
    claim_id: string | null;
    completion_id: string | null;
    owner_id: string;
    updated_at: number;
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface DemandServiceListClaimedRequest {
  cursor?: string;
  page_size?: number;
  status?:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  business_scene?: "village" | "campus";
  region_id?: string;
}
export interface DemandServiceListClaimedResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    demand_id: string;
    title: string;
    content: string;
    status:
      | "draft"
      | "pending_audit"
      | "rejected"
      | "pending_claim"
      | "claiming"
      | "processing"
      | "pending_review"
      | "completed"
      | "cancelled"
      | "expired"
      | "terminated";
    version: number;
    submission_id: string | null;
    revision: number;
    claim_id: string | null;
    completion_id: string | null;
    owner_id: string;
    updated_at: number;
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface DemandServiceListPendingAuditRequest {
  cursor?: string;
  page_size?: number;
  status?:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  business_scene?: "village" | "campus";
  region_id?: string;
}
export interface DemandServiceListPendingAuditResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    demand_id: string;
    title: string;
    content: string;
    status:
      | "draft"
      | "pending_audit"
      | "rejected"
      | "pending_claim"
      | "claiming"
      | "processing"
      | "pending_review"
      | "completed"
      | "cancelled"
      | "expired"
      | "terminated";
    version: number;
    submission_id: string | null;
    revision: number;
    claim_id: string | null;
    completion_id: string | null;
    owner_id: string;
    updated_at: number;
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface DemandServiceListManagedRequest {
  cursor?: string;
  page_size?: number;
  status?:
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  business_scene?: "village" | "campus";
  region_id?: string;
  type?: "enterprise" | "agriculture" | "research" | "campus";
  start_at?: number;
  end_at?: number;
}
export interface DemandServiceListManagedResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    demand_id: string;
    title: string;
    content: string;
    status:
      | "draft"
      | "pending_audit"
      | "rejected"
      | "pending_claim"
      | "claiming"
      | "processing"
      | "pending_review"
      | "completed"
      | "cancelled"
      | "expired"
      | "terminated";
    version: number;
    submission_id: string | null;
    revision: number;
    claim_id: string | null;
    completion_id: string | null;
    owner_id: string;
    updated_at: number;
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface DemandServiceRequestTerminationRequest {
  demand_id: string;
  expected_version: number;
  reason: string;
}
export interface DemandServiceRequestTerminationResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
  termination_request_id: string;
}
export interface DemandServiceRespondTerminationRequest {
  demand_id: string;
  expected_version: number;
  termination_request_id: string;
  request_version: number;
  decision: "agree" | "reject";
  reason?: string;
}
export interface DemandServiceRespondTerminationResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
}
export interface DemandServiceWithdrawTerminationRequest {
  demand_id: string;
  expected_version: number;
  termination_request_id: string;
  request_version: number;
}
export interface DemandServiceWithdrawTerminationResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
}
export interface DemandServiceDisputeTerminationRequest {
  demand_id: string;
  expected_version: number;
  termination_request_id: string;
  request_version: number;
  reason: string;
}
export interface DemandServiceDisputeTerminationResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
}
export interface DemandServiceResolveTerminationRequest {
  demand_id: string;
  expected_version: number;
  termination_request_id: string;
  request_version: number;
  decision: "terminate" | "continue";
  reason: string;
}
export interface DemandServiceResolveTerminationResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
}
export type DemandServiceClaimRequest =
  | {
      demand_id: string;
      expected_version: number;
      assignee_type: "user";
      message?: string;
    }
  | {
      demand_id: string;
      expected_version: number;
      assignee_type: "team";
      team_id: string;
      /**
       * @minItems 1
       * @maxItems 20
       */
      participant_user_ids: string[];
      message?: string;
    };
export interface DemandServiceClaimResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
  claim_id: string;
  claim_expires_at: number;
  assignee_type: "user" | "team";
  assignee_id: string;
}
export interface DemandServiceConfirmClaimRequest {
  demand_id: string;
  expected_version: number;
  claim_id: string;
  decision: "accept" | "reject";
  reason?: string;
}
export interface DemandServiceConfirmClaimResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
}
export interface DemandServiceWithdrawClaimRequest {
  demand_id: string;
  expected_version: number;
  claim_id: string;
  reason?: string;
}
export interface DemandServiceWithdrawClaimResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
}
export interface DemandServiceAddProgressRequest {
  demand_id: string;
  expected_version: number;
  kind: "note" | "arrived" | "milestone";
  text: string;
  /**
   * @minItems 0
   * @maxItems 8
   */
  attachment_ids?: string[];
}
export interface DemandServiceAddProgressResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
}
export interface DemandServiceSubmitCompletionRequest {
  demand_id: string;
  expected_version: number;
  summary: string;
  /**
   * @minItems 0
   * @maxItems 8
   */
  attachment_ids?: string[];
  service_started_at?: number;
  service_ended_at?: number;
}
export interface DemandServiceSubmitCompletionResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
  completion_id: string;
}
export interface DemandServiceReviewCompletionRequest {
  demand_id: string;
  expected_version: number;
  completion_id: string;
  decision: "accept" | "return";
  reason?: string;
}
export interface DemandServiceReviewCompletionResponse {
  demand_id: string;
  status:
    | "draft"
    | "pending_audit"
    | "rejected"
    | "pending_claim"
    | "claiming"
    | "processing"
    | "pending_review"
    | "completed"
    | "cancelled"
    | "expired"
    | "terminated";
  version: number;
  /**
   * @minItems 0
   * @maxItems 99
   */
  event_ids: string[];
}
export type DemandServiceCheckSubmissionRequest =
  | {
      schema_version: 1;
      title: string;
      content: string;
      location_text: string;
      service_time:
        | {
            kind: "negotiable";
          }
        | {
            kind: "period";
            description: string;
          }
        | {
            kind: "scheduled";
            start_at: number;
            end_at?: number;
          };
      expires_at?: number;
      contact: {
        name: string;
        phone: string;
        exact_address?: string;
      };
      budget?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "range";
            min_fen: number;
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_most";
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_least";
            min_fen: number;
            currency: "CNY";
          };
      /**
       * @minItems 0
       * @maxItems 8
       */
      attachments?: {
        file_id: string;
        usage: "image" | "document";
      }[];
      type: "enterprise";
      sub_type: "production_tech" | "talent_recruit";
      business_scene: "village";
      region_id: string;
      extra?: {
        coop_period?: string;
        company_scale?: string;
        urgency?: "normal" | "urgent" | "critical";
      };
    }
  | {
      schema_version: 1;
      title: string;
      content: string;
      location_text: string;
      service_time:
        | {
            kind: "negotiable";
          }
        | {
            kind: "period";
            description: string;
          }
        | {
            kind: "scheduled";
            start_at: number;
            end_at?: number;
          };
      expires_at?: number;
      contact: {
        name: string;
        phone: string;
        exact_address?: string;
      };
      budget?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "range";
            min_fen: number;
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_most";
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_least";
            min_fen: number;
            currency: "CNY";
          };
      /**
       * @minItems 0
       * @maxItems 8
       */
      attachments?: {
        file_id: string;
        usage: "image" | "document";
      }[];
      type: "agriculture";
      sub_type: "harvest" | "sales" | "drone_service";
      business_scene: "village";
      region_id: string;
      extra?: {
        live_location_kind?: "campus_live_base" | "local_orchard";
        product_type?: string;
        product_name?: string;
        yield_value?: number;
        yield_unit?: string;
        logistics?: string;
        help_period?: string;
        crop_name?: string;
        operation_area?: {
          value: number;
          unit: "mu" | "hectare" | "square_meter";
        };
        equipment_provider?: "publisher" | "service_party" | "negotiable";
      };
    }
  | {
      schema_version: 1;
      title: string;
      content: string;
      location_text: string;
      service_time:
        | {
            kind: "negotiable";
          }
        | {
            kind: "period";
            description: string;
          }
        | {
            kind: "scheduled";
            start_at: number;
            end_at?: number;
          };
      expires_at?: number;
      contact: {
        name: string;
        phone: string;
        exact_address?: string;
      };
      budget?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "range";
            min_fen: number;
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_most";
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_least";
            min_fen: number;
            currency: "CNY";
          };
      /**
       * @minItems 0
       * @maxItems 8
       */
      attachments?: {
        file_id: string;
        usage: "image" | "document";
      }[];
      type: "research";
      sub_type: "planting" | "mechanical" | "intelligent";
      business_scene: "village";
      region_id: string;
      extra?: {
        project_stage?: string;
        target_university?: string;
        funding_source?: "none" | "self_funded" | "subsidy_application";
        /**
         * @minItems 0
         * @maxItems 20
         */
        lab_conditions?: string[];
      };
    }
  | {
      schema_version: 1;
      title: string;
      content: string;
      location_text: string;
      service_time:
        | {
            kind: "negotiable";
          }
        | {
            kind: "period";
            description: string;
          }
        | {
            kind: "scheduled";
            start_at: number;
            end_at?: number;
          };
      expires_at?: number;
      contact: {
        name: string;
        phone: string;
        exact_address?: string;
      };
      budget?:
        | {
            kind: "negotiable";
          }
        | {
            kind: "range";
            min_fen: number;
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_most";
            max_fen: number;
            currency: "CNY";
          }
        | {
            kind: "at_least";
            min_fen: number;
            currency: "CNY";
          };
      /**
       * @minItems 0
       * @maxItems 8
       */
      attachments?: {
        file_id: string;
        usage: "image" | "document";
      }[];
      type: "campus";
      sub_type: "learning_research" | "activity_support" | "technical_support" | "daily_help" | "other";
      business_scene: "campus";
      campus_organization_id: "sztu";
      extra?: {};
    };
export interface DemandServiceCheckSubmissionResponse {
  content_hash: string;
  status: "pass" | "reject" | "error";
  expires_at: number;
}
export interface TeamServiceCreateTeamRequest {
  name: string;
  description?: string;
}
export interface TeamServiceCreateTeamResponse {
  team_id: string;
  name: string;
  description: string;
  leader_user_id: string;
  status: "active" | "dissolved";
  version: number;
  active_assignment_count: number;
  pending_handover: {
    handover_id: string;
    target_user_id: string;
    version: number;
  } | null;
}
export interface TeamServiceGetTeamRequest {
  team_id: string;
}
export interface TeamServiceGetTeamResponse {
  team_id: string;
  name: string;
  description: string;
  leader_user_id: string;
  status: "active" | "dissolved";
  version: number;
  active_assignment_count: number;
  pending_handover: {
    handover_id: string;
    target_user_id: string;
    version: number;
  } | null;
}
export interface TeamServiceListMyTeamsRequest {
  cursor?: string;
  page_size?: number;
}
export interface TeamServiceListMyTeamsResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    team_id: string;
    name: string;
    description: string;
    leader_user_id: string;
    status: "active" | "dissolved";
    version: number;
    active_assignment_count: number;
    pending_handover: {
      handover_id: string;
      target_user_id: string;
      version: number;
    } | null;
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface TeamServiceInviteMemberRequest {
  team_id: string;
  expected_version: number;
  invitee_code: string;
}
export interface TeamServiceInviteMemberResponse {
  invitation_id: string;
  status: "pending";
}
export interface TeamServiceListMyInvitationsRequest {
  cursor?: string;
  page_size?: number;
}
export interface TeamServiceListMyInvitationsResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    invitation_id: string;
    team_id: string;
    team_name: string;
    inviter_id: string;
    status: "pending" | "accepted" | "rejected" | "cancelled";
    version: number;
    created_at: number;
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface TeamServiceRespondInvitationRequest {
  invitation_id: string;
  expected_version: number;
  decision: "accept" | "reject";
}
export interface TeamServiceRespondInvitationResponse {
  invitation_id: string;
  status: "accepted" | "rejected";
}
export interface TeamServiceListMembersRequest {
  team_id: string;
  cursor?: string;
  page_size?: number;
}
export interface TeamServiceListMembersResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    user_id: string;
    display_name: string;
    membership_status: "active" | "left";
    active_assignment_count: number;
    joined_at: number;
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface TeamServiceLeaveTeamRequest {
  team_id: string;
  expected_version: number;
}
export interface TeamServiceLeaveTeamResponse {
  team_id: string;
  membership_status: "left";
}
export interface TeamServiceTransferLeadershipRequest {
  team_id: string;
  expected_version: number;
  new_leader_user_id: string;
}
export interface TeamServiceTransferLeadershipResponse {
  handover_id: string;
  status: "pending";
}
export interface TeamServiceAcceptLeadershipRequest {
  handover_id: string;
  expected_version: number;
  decision: "accept" | "reject";
}
export interface TeamServiceAcceptLeadershipResponse {
  handover_id: string;
  status: "accepted" | "rejected";
}
export interface TeamServiceDissolveTeamRequest {
  team_id: string;
  expected_version: number;
  reason?: string;
}
export interface TeamServiceDissolveTeamResponse {
  team_id: string;
  name: string;
  description: string;
  leader_user_id: string;
  status: "active" | "dissolved";
  version: number;
  active_assignment_count: number;
  pending_handover: {
    handover_id: string;
    target_user_id: string;
    version: number;
  } | null;
}
export interface NotificationServiceListMineRequest {
  cursor?: string;
  page_size?: number;
  unread_only?: boolean;
}
export interface NotificationServiceListMineResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    notification_id: string;
    event_type: string;
    resource_id: string;
    unread: boolean;
    created_at: number;
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface NotificationServiceUnreadCountRequest {}
export interface NotificationServiceUnreadCountResponse {
  count: number;
}
export interface NotificationServiceMarkReadRequest {
  /**
   * @minItems 1
   * @maxItems 50
   */
  notification_ids: string[];
}
export interface NotificationServiceMarkReadResponse {
  updated_count: number;
}
export interface NotificationServiceRecordSubscriptionRequest {
  template_key: string;
  result: "accept" | "reject" | "ban";
  client_request_id: string;
}
export interface NotificationServiceRecordSubscriptionResponse {
  record_id: string;
}
export interface NotificationServiceGetSubscriptionOptionsRequest {}
/**
 * @minItems 0
 * @maxItems 3
 */
export type NotificationServiceGetSubscriptionOptionsResponse = {
  template_key: string;
  template_id: string;
}[];
export interface FileServicePrepareUploadRequest {
  purpose: "identity" | "avatar" | "demand" | "progress" | "completion" | "chat" | "policy_banner";
  mime:
    | "image/jpeg"
    | "image/png"
    | "image/webp"
    | "application/pdf"
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  size: number;
  filename: string;
  demand_id?: string;
}
export interface FileServicePrepareUploadResponse {
  upload_id: string;
  cloud_path: string;
  expires_at: number;
  limits: {
    max_bytes: number;
  };
}
export interface FileServiceGetUploadTicketRequest {
  upload_id: string;
}
export interface FileServiceGetUploadTicketResponse {
  url: string;
  cloud_file_id: string;
  expires_at: number;
  form_data: {
    key: string;
    acl: "private";
    "Content-Type": string;
    success_action_status: "204";
    "x-cos-meta-fileid": string;
    "x-cos-forbid-overwrite": "true";
    "x-cos-acl": "private";
    "x-cos-grant-read": "";
    "x-cos-grant-write": "";
    "x-cos-grant-read-acp": "";
    "x-cos-grant-write-acp": "";
    "x-cos-grant-full-control": "";
    "x-cos-security-token": string;
    "q-sign-algorithm": "sha1";
    "q-ak": string;
    "q-key-time": string;
    "q-signature": string;
    policy: string;
  };
}
export interface FileServiceFinalizeUploadRequest {
  upload_id: string;
  cloud_file_id: string;
  hash: string;
}
export interface FileServiceFinalizeUploadResponse {
  file_id: string;
  check_status: "pending" | "pass" | "reject" | "error";
}
export interface FileServiceGetAccessUrlRequest {
  /**
   * @minItems 1
   * @maxItems 20
   */
  file_ids: string[];
  resource_type: "application" | "demand" | "upload" | "message" | "export" | "avatar";
  resource_id: string;
  purpose: string;
}
/**
 * @minItems 0
 * @maxItems 20
 */
export type FileServiceGetAccessUrlResponse = {
  file_id: string;
  url: string;
  expires_at: number;
  mime: string;
}[];
export interface FileServiceDeleteUnboundRequest {
  file_id: string;
}
export interface FileServiceDeleteUnboundResponse {
  deleted: true;
}
export interface PolicyServiceListPublishedRequest {
  cursor?: string;
  page_size?: number;
  region_id?: string;
  keyword?: string;
}
export interface PolicyServiceListPublishedResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    policy_id: string;
    title: string;
    content: string;
    source_url: string;
    source_authority: string;
    publish_at: number;
    effective_at?: number;
    expire_at?: number;
    scope: {
      business_scene: "village" | "campus";
      region_id?: string;
      campus_organization_id?: "sztu";
    };
    status: "draft" | "published" | "unpublished";
    version: number;
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface PolicyServiceGetDetailRequest {
  policy_id: string;
}
export interface PolicyServiceGetDetailResponse {
  policy_id: string;
  title: string;
  content: string;
  source_url: string;
  source_authority: string;
  publish_at: number;
  effective_at?: number;
  expire_at?: number;
  scope: {
    business_scene: "village" | "campus";
    region_id?: string;
    campus_organization_id?: "sztu";
  };
  status: "draft" | "published" | "unpublished";
  version: number;
}
export interface PolicyServiceListDraftsRequest {
  cursor?: string;
  page_size?: number;
}
export interface PolicyServiceListDraftsResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    policy_id: string;
    title: string;
    content: string;
    source_url: string;
    source_authority: string;
    publish_at: number;
    effective_at?: number;
    expire_at?: number;
    scope: {
      business_scene: "village" | "campus";
      region_id?: string;
      campus_organization_id?: "sztu";
    };
    status: "draft" | "published" | "unpublished";
    version: number;
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface PolicyServiceListManageRequest {
  cursor?: string;
  page_size?: number;
  status?: "draft" | "published" | "unpublished";
  keyword?: string;
}
export interface PolicyServiceListManageResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    policy_id: string;
    title: string;
    content: string;
    source_url: string;
    source_authority: string;
    publish_at: number;
    effective_at?: number;
    expire_at?: number;
    scope: {
      business_scene: "village" | "campus";
      region_id?: string;
      campus_organization_id?: "sztu";
    };
    status: "draft" | "published" | "unpublished";
    version: number;
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface PolicyServiceGetManageDetailRequest {
  policy_id: string;
}
export interface PolicyServiceGetManageDetailResponse {
  policy_id: string;
  title: string;
  content: string;
  source_url: string;
  source_authority: string;
  publish_at: number;
  effective_at?: number;
  expire_at?: number;
  scope: {
    business_scene: "village" | "campus";
    region_id?: string;
    campus_organization_id?: "sztu";
  };
  status: "draft" | "published" | "unpublished";
  version: number;
}
export interface PolicyServiceSaveDraftRequest {
  title: string;
  content: string;
  source_url: string;
  source_authority: string;
  publish_at: number;
  effective_at?: number;
  expire_at?: number;
  scope: {
    business_scene: "village" | "campus";
    region_id?: string;
    campus_organization_id?: "sztu";
  };
  policy_id?: string;
  expected_version?: number;
}
export interface PolicyServiceSaveDraftResponse {
  policy_id: string;
  title: string;
  content: string;
  source_url: string;
  source_authority: string;
  publish_at: number;
  effective_at?: number;
  expire_at?: number;
  scope: {
    business_scene: "village" | "campus";
    region_id?: string;
    campus_organization_id?: "sztu";
  };
  status: "draft" | "published" | "unpublished";
  version: number;
}
export interface PolicyServicePublishRequest {
  policy_id: string;
  expected_version: number;
  reason?: string;
}
export interface PolicyServicePublishResponse {
  policy_id: string;
  title: string;
  content: string;
  source_url: string;
  source_authority: string;
  publish_at: number;
  effective_at?: number;
  expire_at?: number;
  scope: {
    business_scene: "village" | "campus";
    region_id?: string;
    campus_organization_id?: "sztu";
  };
  status: "draft" | "published" | "unpublished";
  version: number;
}
export interface PolicyServiceUnpublishRequest {
  policy_id: string;
  expected_version: number;
  reason: string;
}
export interface PolicyServiceUnpublishResponse {
  policy_id: string;
  title: string;
  content: string;
  source_url: string;
  source_authority: string;
  publish_at: number;
  effective_at?: number;
  expire_at?: number;
  scope: {
    business_scene: "village" | "campus";
    region_id?: string;
    campus_organization_id?: "sztu";
  };
  status: "draft" | "published" | "unpublished";
  version: number;
}
export interface PolicyServiceListManageBannersRequest {
  cursor?: string;
  page_size?: number;
}
export interface PolicyServiceListManageBannersResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    banner_id: string;
    policy_id: string;
    cover_file_id: string;
    sort_order: number;
    starts_at: number;
    ends_at: number;
    enabled: boolean;
    version: number;
    cover_url: string | null;
    policy_title: string | null;
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface PolicyServiceSetBannerEnabledRequest {
  banner_id: string;
  expected_version: number;
  enabled: boolean;
}
export interface PolicyServiceSetBannerEnabledResponse {
  banner_id: string;
  policy_id: string;
  cover_file_id: string;
  sort_order: number;
  starts_at: number;
  ends_at: number;
  enabled: boolean;
  version: number;
  cover_url: string | null;
  policy_title: string | null;
}
export interface PolicyServiceSaveBannerRequest {
  banner_id?: string;
  expected_version?: number;
  policy_id: string;
  cover_file_id: string;
  sort_order: number;
  starts_at: number;
  ends_at: number;
  enabled: boolean;
}
export interface PolicyServiceSaveBannerResponse {
  banner_id: string;
  policy_id: string;
  cover_file_id: string;
  sort_order: number;
  starts_at: number;
  ends_at: number;
  enabled: boolean;
  version: number;
  cover_url: string | null;
  policy_title: string | null;
}
export interface PolicyServiceListBannersRequest {
  region_id?: string;
}
/**
 * @minItems 0
 * @maxItems 50
 */
export type PolicyServiceListBannersResponse = {
  banner_id: string;
  policy_id: string;
  cover_file_id: string;
  sort_order: number;
  starts_at: number;
  ends_at: number;
  enabled: boolean;
  version: number;
  cover_url: string | null;
  policy_title: string | null;
}[];
export interface ContactServiceListContactsRequest {
  cursor?: string;
  page_size?: number;
}
export interface ContactServiceListContactsResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    conversation_id: string;
    demand_id: string;
    demand_title: string;
    other_user_id: string;
    display_name: string;
    updated_at: number;
    can_send: boolean;
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface ChatServiceCreateDemandConversationRequest {
  demand_id: string;
  claim_id?: string;
}
export interface ChatServiceCreateDemandConversationResponse {
  conversation_id: string;
  demand_id: string;
}
export interface ChatServiceListMineRequest {
  cursor?: string;
  page_size?: number;
}
export interface ChatServiceListMineResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    conversation_id: string;
    demand_id: string;
    demand_title: string;
    other_user_id: string;
    display_name: string;
    updated_at: number;
    can_send: boolean;
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface ChatServiceGetMessagesRequest {
  conversation_id: string;
  cursor?: string;
  page_size?: number;
}
export interface ChatServiceGetMessagesResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    message_id: string;
    conversation_id: string;
    sender_user_id: string;
    content_type: "text" | "image" | "file";
    content: string;
    file_id: string | null;
    created_at: number;
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export type ChatServiceSendMessageRequest =
  | {
      conversation_id: string;
      client_message_id: string;
      content_type: "text";
      content: string;
    }
  | {
      conversation_id: string;
      client_message_id: string;
      content_type: "image" | "file";
      content: string;
      file_id: string;
    };
export interface ChatServiceSendMessageResponse {
  message_id: string;
  created_at: number;
}
export interface ChatServiceMarkReadRequest {
  conversation_id: string;
  last_read_message_id: string;
}
export interface ChatServiceMarkReadResponse {
  updated: true;
}
export interface StatsServiceGetOverviewRequest {
  business_scene?: "village" | "campus";
  campus_organization_id?: "sztu";
  scope_region_id?: string;
  start_at: number;
  end_at: number;
  type?: "enterprise" | "agriculture" | "research" | "campus";
}
export interface StatsServiceGetOverviewResponse {
  cohort: {
    demand_count: number;
    publisher_count: number;
    delegated_operator_count: number;
    published_count: number;
    completed_count: number;
    resolution_rate: number | null;
    participant_count: number;
    average_resolution_ms: number | null;
    by_status: {
      draft: number;
      pending_audit: number;
      rejected: number;
      pending_claim: number;
      claiming: number;
      processing: number;
      pending_review: number;
      completed: number;
      cancelled: number;
      expired: number;
      terminated: number;
    };
  };
  flow: {
    completed_in_period: number;
  };
  stock: {
    pending_audit: number;
    pending_claim: number;
    processing: number;
    pending_review: number;
  };
  generated_at: number;
  data_as_of: number;
  algorithm_version: string;
}
export interface StatsServiceGetTrendRequest {
  business_scene?: "village" | "campus";
  campus_organization_id?: "sztu";
  scope_region_id?: string;
  start_at: number;
  end_at: number;
  type?: "enterprise" | "agriculture" | "research" | "campus";
  interval: "day" | "week" | "month";
}
export interface StatsServiceGetTrendResponse {
  /**
   * @minItems 0
   * @maxItems 367
   */
  points: {
    start_at: number;
    submitted_count: number;
    completed_in_period: number;
  }[];
}
export interface StatsServiceGetCategoryBreakdownRequest {
  business_scene?: "village" | "campus";
  campus_organization_id?: "sztu";
  scope_region_id?: string;
  start_at: number;
  end_at: number;
  type?: "enterprise" | "agriculture" | "research" | "campus";
}
export interface StatsServiceGetCategoryBreakdownResponse {
  /**
   * @minItems 0
   * @maxItems 4
   */
  items: {
    type: "enterprise" | "agriculture" | "research" | "campus";
    demand_count: number;
    completed_count: number;
  }[];
}
export interface StatsServiceCreateExportRequest {
  business_scene?: "village" | "campus";
  campus_organization_id?: "sztu";
  scope_region_id?: string;
  start_at: number;
  end_at: number;
  type?: "enterprise" | "agriculture" | "research" | "campus";
  format: "csv" | "xlsx";
  report: "overview" | "trend" | "category";
  /**
   * @minItems 1
   * @maxItems 20
   */
  fields?: string[];
}
export interface StatsServiceCreateExportResponse {
  export_job_id: string;
  status: "pending" | "running" | "ready" | "failed";
  file_id?: string;
  expires_at?: number;
  error_code?: string;
  report_layout?: "zh_summary";
  regenerate?: {
    report: "overview" | "trend" | "category";
    query: {
      business_scene?: "village" | "campus";
      campus_organization_id?: "sztu";
      scope_region_id?: string;
      start_at: number;
      end_at: number;
      type?: "enterprise" | "agriculture" | "research" | "campus";
    };
  };
}
export interface StatsServiceGetExportRequest {
  export_job_id: string;
}
export interface StatsServiceGetExportResponse {
  status: "pending" | "running" | "ready" | "failed";
  file_id?: string;
  expires_at?: number;
  error_code?: string;
  report_layout?: "zh_summary";
  regenerate?: {
    report: "overview" | "trend" | "category";
    query: {
      business_scene?: "village" | "campus";
      campus_organization_id?: "sztu";
      scope_region_id?: string;
      start_at: number;
      end_at: number;
      type?: "enterprise" | "agriculture" | "research" | "campus";
    };
  };
}
export interface KnowledgeServiceSearchRequest {
  query?: string;
  usage?: "business_answer" | "tool_reference" | "management_answer";
  cursor?: string;
  page_size?: number;
}
export interface KnowledgeServiceSearchResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    document_id: string;
    title: string;
    body_text: string;
    assistant_usage: "business_answer" | "tool_reference" | "management_answer";
    scope: {
      business_scene: "village" | "campus";
      region_id?: string;
      campus_organization_id?: "sztu";
    };
    source_ref?: string;
    status: "draft" | "published" | "unpublished";
    version: number;
    source_type: "manual" | "official_text" | "generated_api";
    source_hash: string | null;
    release_id: string | null;
    content_hash: string;
    admin_visibility: "super_admin";
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface KnowledgeServiceGetDocumentRequest {
  document_id: string;
  version?: number;
}
export interface KnowledgeServiceGetDocumentResponse {
  document_id: string;
  title: string;
  body_text: string;
  assistant_usage: "business_answer" | "tool_reference" | "management_answer";
  scope: {
    business_scene: "village" | "campus";
    region_id?: string;
    campus_organization_id?: "sztu";
  };
  source_ref?: string;
  status: "draft" | "published" | "unpublished";
  version: number;
  source_type: "manual" | "official_text" | "generated_api";
  source_hash: string | null;
  release_id: string | null;
  content_hash: string;
  admin_visibility: "super_admin";
}
export interface KnowledgeServiceSaveDraftRequest {
  document_id?: string;
  expected_version?: number;
  title: string;
  body_text: string;
  assistant_usage: "business_answer" | "tool_reference" | "management_answer";
  scope: {
    business_scene: "village" | "campus";
    region_id?: string;
    campus_organization_id?: "sztu";
  };
  source_ref?: string;
}
export interface KnowledgeServiceSaveDraftResponse {
  document_id: string;
  title: string;
  body_text: string;
  assistant_usage: "business_answer" | "tool_reference" | "management_answer";
  scope: {
    business_scene: "village" | "campus";
    region_id?: string;
    campus_organization_id?: "sztu";
  };
  source_ref?: string;
  status: "draft" | "published" | "unpublished";
  version: number;
  source_type: "manual" | "official_text" | "generated_api";
  source_hash: string | null;
  release_id: string | null;
  content_hash: string;
  admin_visibility: "super_admin";
}
export interface KnowledgeServiceImportDraftRequest {
  source_type: "official_text";
  source_ref: string;
  title: string;
  assistant_usage: "business_answer" | "tool_reference" | "management_answer";
  scope: {
    business_scene: "village" | "campus";
    region_id?: string;
    campus_organization_id?: "sztu";
  };
}
export interface KnowledgeServiceImportDraftResponse {
  document_id: string;
  title: string;
  body_text: string;
  assistant_usage: "business_answer" | "tool_reference" | "management_answer";
  scope: {
    business_scene: "village" | "campus";
    region_id?: string;
    campus_organization_id?: "sztu";
  };
  source_ref?: string;
  status: "draft" | "published" | "unpublished";
  version: number;
  source_type: "manual" | "official_text" | "generated_api";
  source_hash: string | null;
  release_id: string | null;
  content_hash: string;
  admin_visibility: "super_admin";
}
export interface KnowledgeServicePublishRequest {
  document_id: string;
  expected_version: number;
  reason: string;
}
export interface KnowledgeServicePublishResponse {
  document_id: string;
  title: string;
  body_text: string;
  assistant_usage: "business_answer" | "tool_reference" | "management_answer";
  scope: {
    business_scene: "village" | "campus";
    region_id?: string;
    campus_organization_id?: "sztu";
  };
  source_ref?: string;
  status: "draft" | "published" | "unpublished";
  version: number;
  source_type: "manual" | "official_text" | "generated_api";
  source_hash: string | null;
  release_id: string | null;
  content_hash: string;
  admin_visibility: "super_admin";
}
export interface KnowledgeServiceUnpublishRequest {
  document_id: string;
  expected_version: number;
  reason: string;
}
export interface KnowledgeServiceUnpublishResponse {
  document_id: string;
  title: string;
  body_text: string;
  assistant_usage: "business_answer" | "tool_reference" | "management_answer";
  scope: {
    business_scene: "village" | "campus";
    region_id?: string;
    campus_organization_id?: "sztu";
  };
  source_ref?: string;
  status: "draft" | "published" | "unpublished";
  version: number;
  source_type: "manual" | "official_text" | "generated_api";
  source_hash: string | null;
  release_id: string | null;
  content_hash: string;
  admin_visibility: "super_admin";
}
export interface MaintenanceServiceCreateHoldRequest {
  resource_type: "demand" | "file" | "application" | "export" | "conversation" | "ai_session";
  resource_id: string;
  reason: string;
  review_at: number;
}
export interface MaintenanceServiceCreateHoldResponse {
  hold_id: string;
  resource_type: "demand" | "file" | "application" | "export" | "conversation" | "ai_session";
  resource_id: string;
  reason: string;
  created_by: string;
  created_at: number;
  review_at: number;
  released_at: number | null;
  version: number;
}
export interface MaintenanceServiceReleaseHoldRequest {
  hold_id: string;
  expected_version: number;
  reason: string;
}
export interface MaintenanceServiceReleaseHoldResponse {
  hold_id: string;
  resource_type: "demand" | "file" | "application" | "export" | "conversation" | "ai_session";
  resource_id: string;
  reason: string;
  created_by: string;
  created_at: number;
  review_at: number;
  released_at: number | null;
  version: number;
}
export interface MaintenanceServiceListHoldsRequest {
  cursor?: string;
  page_size?: number;
}
export interface MaintenanceServiceListHoldsResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    hold_id: string;
    resource_type: "demand" | "file" | "application" | "export" | "conversation" | "ai_session";
    resource_id: string;
    reason: string;
    created_by: string;
    created_at: number;
    review_at: number;
    released_at: number | null;
    version: number;
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface MaintenanceServiceListDeadLettersRequest {
  cursor?: string;
  page_size?: number;
  kind: "outbox" | "storage";
}
export interface MaintenanceServiceListDeadLettersResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    event_id: string;
    event_type: string;
    attempts: number;
    created_at: number;
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface MaintenanceServiceRetryDeadLetterRequest {
  event_id: string;
  kind: "outbox" | "storage";
  reason: string;
}
export interface MaintenanceServiceRetryDeadLetterResponse {
  queued: true;
}
export interface AiServiceGetExamplesRequest {}
/**
 * @minItems 0
 * @maxItems 10
 */
export type AiServiceGetExamplesResponse = string[];
export interface AiServiceCreateSessionRequest {
  mode: "assistant";
}
export interface AiServiceCreateSessionResponse {
  session_id: string;
}
export interface AiServiceListSessionsRequest {
  cursor?: string;
  page_size?: number;
}
export interface AiServiceListSessionsResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    session_id: string;
    created_at: number;
    updated_at: number;
    active_job_id: string | null;
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface AiServiceListMessagesRequest {
  session_id: string;
  cursor?: string;
  page_size?: number;
}
export interface AiServiceListMessagesResponse {
  /**
   * @minItems 0
   * @maxItems 50
   */
  items: {
    message_id: string;
    role: "user" | "assistant" | "system";
    content: string;
    created_at: number;
    operation_result: {
      intent_id: string;
      version: number;
      proposal_id: string | null;
      action: "submit_my_demand" | "claim_my_demand" | "add_my_progress" | "submit_my_completion";
      status: "collecting" | "ready" | "executed" | "cancelled" | "expired" | "failed";
      demand_id: string | null;
      demand_status:
        | (
            | "draft"
            | "pending_audit"
            | "rejected"
            | "pending_claim"
            | "claiming"
            | "processing"
            | "pending_review"
            | "completed"
            | "cancelled"
            | "expired"
            | "terminated"
          )
        | null;
      detail_path: string | null;
      error_code: string | null;
    } | null;
    quota_charged: boolean;
    /**
     * @minItems 0
     * @maxItems 8
     */
    attachment_ids: string[];
  }[];
  next_cursor: string | null;
  has_more: boolean;
}
export interface AiServiceSendMessageRequest {
  session_id: string;
  client_message_id: string;
  content: string;
  /**
   * @minItems 0
   * @maxItems 8
   */
  attachment_ids?: string[];
}
export interface AiServiceSendMessageResponse {
  job_id: string;
  message_id: string;
  status: "queued" | "running" | "succeeded" | "partial_success" | "failed";
  quota: {
    quota_kind: "general_chat";
    quota_day: string;
    limit: 10;
    used: number;
    reserved: number;
    remaining: number;
    reset_at: number;
  };
}
export interface AiServiceGetJobRequest {
  job_id: string;
}
export interface AiServiceGetJobResponse {
  status: "queued" | "running" | "succeeded" | "partial_success" | "failed";
  message_id: string | null;
  operation_result: {
    intent_id: string;
    version: number;
    proposal_id: string | null;
    action: "submit_my_demand" | "claim_my_demand" | "add_my_progress" | "submit_my_completion";
    status: "collecting" | "ready" | "executed" | "cancelled" | "expired" | "failed";
    demand_id: string | null;
    demand_status:
      | (
          | "draft"
          | "pending_audit"
          | "rejected"
          | "pending_claim"
          | "claiming"
          | "processing"
          | "pending_review"
          | "completed"
          | "cancelled"
          | "expired"
          | "terminated"
        )
      | null;
    detail_path: string | null;
    error_code: string | null;
  } | null;
  quota: {
    quota_kind: "general_chat";
    quota_day: string;
    limit: 10;
    used: number;
    reserved: number;
    remaining: number;
    reset_at: number;
  };
  retry_after_ms: number;
  error_code: string | null;
}
export interface AiServiceGetQuotaRequest {}
export interface AiServiceGetQuotaResponse {
  quota_kind: "general_chat";
  quota_day: string;
  limit: 10;
  used: number;
  reserved: number;
  remaining: number;
  reset_at: number;
}
export interface AiServiceDeleteSessionRequest {
  session_id: string;
}
export interface AiServiceDeleteSessionResponse {
  deleted: true;
}
export interface AiServiceGetProposalRequest {
  proposal_id: string;
}
export interface AiServiceGetProposalResponse {
  proposal_id: string;
  draft:
    | {
        schema_version?: 1;
        title?: string;
        content?: string;
        location_text?: string;
        service_time?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        expires_at?: number;
        contact?: {
          name: string;
          phone: string;
          exact_address?: string;
        };
        budget?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            };
        /**
         * @minItems 0
         * @maxItems 8
         */
        attachments?: {
          file_id: string;
          usage: "image" | "document";
        }[];
        type?: "enterprise";
        sub_type?: "production_tech" | "talent_recruit";
        business_scene?: "village";
        region_id?: string;
        extra?: {
          coop_period?: string;
          company_scale?: string;
          urgency?: "normal" | "urgent" | "critical";
        };
      }
    | {
        schema_version?: 1;
        title?: string;
        content?: string;
        location_text?: string;
        service_time?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        expires_at?: number;
        contact?: {
          name: string;
          phone: string;
          exact_address?: string;
        };
        budget?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            };
        /**
         * @minItems 0
         * @maxItems 8
         */
        attachments?: {
          file_id: string;
          usage: "image" | "document";
        }[];
        type?: "agriculture";
        sub_type?: "harvest" | "sales" | "drone_service";
        business_scene?: "village";
        region_id?: string;
        extra?: {
          live_location_kind?: "campus_live_base" | "local_orchard";
          product_type?: string;
          product_name?: string;
          yield_value?: number;
          yield_unit?: string;
          logistics?: string;
          help_period?: string;
          crop_name?: string;
          operation_area?: {
            value: number;
            unit: "mu" | "hectare" | "square_meter";
          };
          equipment_provider?: "publisher" | "service_party" | "negotiable";
        };
      }
    | {
        schema_version?: 1;
        title?: string;
        content?: string;
        location_text?: string;
        service_time?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        expires_at?: number;
        contact?: {
          name: string;
          phone: string;
          exact_address?: string;
        };
        budget?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            };
        /**
         * @minItems 0
         * @maxItems 8
         */
        attachments?: {
          file_id: string;
          usage: "image" | "document";
        }[];
        type?: "research";
        sub_type?: "planting" | "mechanical" | "intelligent";
        business_scene?: "village";
        region_id?: string;
        extra?: {
          project_stage?: string;
          target_university?: string;
          funding_source?: "none" | "self_funded" | "subsidy_application";
          /**
           * @minItems 0
           * @maxItems 20
           */
          lab_conditions?: string[];
        };
      }
    | {
        schema_version?: 1;
        title?: string;
        content?: string;
        location_text?: string;
        service_time?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "period";
              description: string;
            }
          | {
              kind: "scheduled";
              start_at: number;
              end_at?: number;
            };
        expires_at?: number;
        contact?: {
          name: string;
          phone: string;
          exact_address?: string;
        };
        budget?:
          | {
              kind: "negotiable";
            }
          | {
              kind: "range";
              min_fen: number;
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_most";
              max_fen: number;
              currency: "CNY";
            }
          | {
              kind: "at_least";
              min_fen: number;
              currency: "CNY";
            };
        /**
         * @minItems 0
         * @maxItems 8
         */
        attachments?: {
          file_id: string;
          usage: "image" | "document";
        }[];
        type?: "campus";
        sub_type?: "learning_research" | "activity_support" | "technical_support" | "daily_help" | "other";
        business_scene?: "campus";
        campus_organization_id?: "sztu";
        extra?: {};
      };
  /**
   * @minItems 0
   * @maxItems 50
   */
  missing_fields: string[];
  /**
   * @minItems 0
   * @maxItems 50
   */
  validation_errors: string[];
  version: number;
  status: "editing" | "ready" | "submitted" | "expired";
  intent_status: "collecting" | "ready" | "executed" | "cancelled" | "expired" | "failed";
  draft_hash: string;
}
export interface AiServiceGetOperationRequest {
  intent_id: string;
}
export interface AiServiceGetOperationResponse {
  intent_id: string;
  version: number;
  proposal_id: string | null;
  action: "submit_my_demand" | "claim_my_demand" | "add_my_progress" | "submit_my_completion";
  status: "collecting" | "ready" | "executed" | "cancelled" | "expired" | "failed";
  demand_id: string | null;
  demand_status:
    | (
        | "draft"
        | "pending_audit"
        | "rejected"
        | "pending_claim"
        | "claiming"
        | "processing"
        | "pending_review"
        | "completed"
        | "cancelled"
        | "expired"
        | "terminated"
      )
    | null;
  detail_path: string | null;
  error_code: string | null;
}
export interface AiServiceCancelPendingIntentRequest {
  intent_id: string;
  expected_version: number;
}
export interface AiServiceCancelPendingIntentResponse {
  intent_id: string;
  status: "collecting" | "ready" | "executed" | "cancelled" | "expired" | "failed";
  result_resource_id: string | null;
}
export interface UserServiceGetReleaseRequest {}
export interface UserServiceGetReleaseResponse {
  api_version: "v1";
  service: "userService";
  source_hash: string;
}
export interface DemandServiceGetReleaseRequest {}
export interface DemandServiceGetReleaseResponse {
  api_version: "v1";
  service: "demandService";
  source_hash: string;
}
export interface TeamServiceGetReleaseRequest {}
export interface TeamServiceGetReleaseResponse {
  api_version: "v1";
  service: "teamService";
  source_hash: string;
}
export interface FileServiceGetReleaseRequest {}
export interface FileServiceGetReleaseResponse {
  api_version: "v1";
  service: "fileService";
  source_hash: string;
}
export interface PolicyServiceGetReleaseRequest {}
export interface PolicyServiceGetReleaseResponse {
  api_version: "v1";
  service: "policyService";
  source_hash: string;
}
export interface NotificationServiceGetReleaseRequest {}
export interface NotificationServiceGetReleaseResponse {
  api_version: "v1";
  service: "notificationService";
  source_hash: string;
}
export interface ChatServiceGetReleaseRequest {}
export interface ChatServiceGetReleaseResponse {
  api_version: "v1";
  service: "chatService";
  source_hash: string;
}
export interface ContactServiceGetReleaseRequest {}
export interface ContactServiceGetReleaseResponse {
  api_version: "v1";
  service: "contactService";
  source_hash: string;
}
export interface StatsServiceGetReleaseRequest {}
export interface StatsServiceGetReleaseResponse {
  api_version: "v1";
  service: "statsService";
  source_hash: string;
}
export interface KnowledgeServiceGetReleaseRequest {}
export interface KnowledgeServiceGetReleaseResponse {
  api_version: "v1";
  service: "knowledgeService";
  source_hash: string;
}
export interface AiServiceGetReleaseRequest {}
export interface AiServiceGetReleaseResponse {
  api_version: "v1";
  service: "aiService";
  source_hash: string;
}
export interface MaintenanceServiceGetReleaseRequest {}
export interface MaintenanceServiceGetReleaseResponse {
  api_version: "v1";
  service: "maintenanceService";
  source_hash: string;
}
export interface ContractMap {
  'userService.bootstrap': { request: UserServiceBootstrapRequest; response: UserServiceBootstrapResponse };
  'userService.getReadiness': { request: UserServiceGetReadinessRequest; response: UserServiceGetReadinessResponse };
  'userService.getMe': { request: UserServiceGetMeRequest; response: UserServiceGetMeResponse };
  'userService.updateProfile': { request: UserServiceUpdateProfileRequest; response: UserServiceUpdateProfileResponse };
  'userService.listRegions': { request: UserServiceListRegionsRequest; response: UserServiceListRegionsResponse };
  'userService.applyRole': { request: UserServiceApplyRoleRequest; response: UserServiceApplyRoleResponse };
  'userService.applyRenewal': { request: UserServiceApplyRenewalRequest; response: UserServiceApplyRenewalResponse };
  'userService.listMyApplications': { request: UserServiceListMyApplicationsRequest; response: UserServiceListMyApplicationsResponse };
  'userService.getApplication': { request: UserServiceGetApplicationRequest; response: UserServiceGetApplicationResponse };
  'userService.getMyContact': { request: UserServiceGetMyContactRequest; response: UserServiceGetMyContactResponse };
  'userService.listPendingApplications': { request: UserServiceListPendingApplicationsRequest; response: UserServiceListPendingApplicationsResponse };
  'userService.withdrawApplication': { request: UserServiceWithdrawApplicationRequest; response: UserServiceWithdrawApplicationResponse };
  'userService.reviewRoleApplication': { request: UserServiceReviewRoleApplicationRequest; response: UserServiceReviewRoleApplicationResponse };
  'userService.listGrants': { request: UserServiceListGrantsRequest; response: UserServiceListGrantsResponse };
  'userService.requestDelegation': { request: UserServiceRequestDelegationRequest; response: UserServiceRequestDelegationResponse };
  'userService.getDelegation': { request: UserServiceGetDelegationRequest; response: UserServiceGetDelegationResponse };
  'userService.listMyDelegations': { request: UserServiceListMyDelegationsRequest; response: UserServiceListMyDelegationsResponse };
  'userService.respondDelegation': { request: UserServiceRespondDelegationRequest; response: UserServiceRespondDelegationResponse };
  'userService.revokeDelegation': { request: UserServiceRevokeDelegationRequest; response: UserServiceRevokeDelegationResponse };
  'userService.revokeGrant': { request: UserServiceRevokeGrantRequest; response: UserServiceRevokeGrantResponse };
  'userService.grantManagementRole': { request: UserServiceGrantManagementRoleRequest; response: UserServiceGrantManagementRoleResponse };
  'demandService.getFormSchema': { request: DemandServiceGetFormSchemaRequest; response: DemandServiceGetFormSchemaResponse };
  'demandService.listPublic': { request: DemandServiceListPublicRequest; response: DemandServiceListPublicResponse };
  'demandService.getDetail': { request: DemandServiceGetDetailRequest; response: DemandServiceGetDetailResponse };
  'demandService.saveDraft': { request: DemandServiceSaveDraftRequest; response: DemandServiceSaveDraftResponse };
  'demandService.getContact': { request: DemandServiceGetContactRequest; response: DemandServiceGetContactResponse };
  'demandService.getServiceLocation': { request: DemandServiceGetServiceLocationRequest; response: DemandServiceGetServiceLocationResponse };
  'demandService.listEvents': { request: DemandServiceListEventsRequest; response: DemandServiceListEventsResponse };
  'demandService.createAndSubmit': { request: DemandServiceCreateAndSubmitRequest; response: DemandServiceCreateAndSubmitResponse };
  'demandService.createDelegatedDemand': { request: DemandServiceCreateDelegatedDemandRequest; response: DemandServiceCreateDelegatedDemandResponse };
  'demandService.requestRosterChange': { request: DemandServiceRequestRosterChangeRequest; response: DemandServiceRequestRosterChangeResponse };
  'demandService.reviewRosterChange': { request: DemandServiceReviewRosterChangeRequest; response: DemandServiceReviewRosterChangeResponse };
  'demandService.submit': { request: DemandServiceSubmitRequest; response: DemandServiceSubmitResponse };
  'demandService.reopenRejected': { request: DemandServiceReopenRejectedRequest; response: DemandServiceReopenRejectedResponse };
  'demandService.withdrawSubmission': { request: DemandServiceWithdrawSubmissionRequest; response: DemandServiceWithdrawSubmissionResponse };
  'demandService.review': { request: DemandServiceReviewRequest; response: DemandServiceReviewResponse };
  'demandService.cancel': { request: DemandServiceCancelRequest; response: DemandServiceCancelResponse };
  'demandService.hide': { request: DemandServiceHideRequest; response: DemandServiceHideResponse };
  'demandService.restoreVisibility': { request: DemandServiceRestoreVisibilityRequest; response: DemandServiceRestoreVisibilityResponse };
  'demandService.editAndResubmit': { request: DemandServiceEditAndResubmitRequest; response: DemandServiceEditAndResubmitResponse };
  'demandService.cloneDemand': { request: DemandServiceCloneDemandRequest; response: DemandServiceCloneDemandResponse };
  'demandService.updateDraft': { request: DemandServiceUpdateDraftRequest; response: DemandServiceUpdateDraftResponse };
  'demandService.listMine': { request: DemandServiceListMineRequest; response: DemandServiceListMineResponse };
  'demandService.listCreatedByMe': { request: DemandServiceListCreatedByMeRequest; response: DemandServiceListCreatedByMeResponse };
  'demandService.listClaimed': { request: DemandServiceListClaimedRequest; response: DemandServiceListClaimedResponse };
  'demandService.listPendingAudit': { request: DemandServiceListPendingAuditRequest; response: DemandServiceListPendingAuditResponse };
  'demandService.listManaged': { request: DemandServiceListManagedRequest; response: DemandServiceListManagedResponse };
  'demandService.requestTermination': { request: DemandServiceRequestTerminationRequest; response: DemandServiceRequestTerminationResponse };
  'demandService.respondTermination': { request: DemandServiceRespondTerminationRequest; response: DemandServiceRespondTerminationResponse };
  'demandService.withdrawTermination': { request: DemandServiceWithdrawTerminationRequest; response: DemandServiceWithdrawTerminationResponse };
  'demandService.disputeTermination': { request: DemandServiceDisputeTerminationRequest; response: DemandServiceDisputeTerminationResponse };
  'demandService.resolveTermination': { request: DemandServiceResolveTerminationRequest; response: DemandServiceResolveTerminationResponse };
  'demandService.claim': { request: DemandServiceClaimRequest; response: DemandServiceClaimResponse };
  'demandService.confirmClaim': { request: DemandServiceConfirmClaimRequest; response: DemandServiceConfirmClaimResponse };
  'demandService.withdrawClaim': { request: DemandServiceWithdrawClaimRequest; response: DemandServiceWithdrawClaimResponse };
  'demandService.addProgress': { request: DemandServiceAddProgressRequest; response: DemandServiceAddProgressResponse };
  'demandService.submitCompletion': { request: DemandServiceSubmitCompletionRequest; response: DemandServiceSubmitCompletionResponse };
  'demandService.reviewCompletion': { request: DemandServiceReviewCompletionRequest; response: DemandServiceReviewCompletionResponse };
  'demandService.checkSubmission': { request: DemandServiceCheckSubmissionRequest; response: DemandServiceCheckSubmissionResponse };
  'teamService.createTeam': { request: TeamServiceCreateTeamRequest; response: TeamServiceCreateTeamResponse };
  'teamService.getTeam': { request: TeamServiceGetTeamRequest; response: TeamServiceGetTeamResponse };
  'teamService.listMyTeams': { request: TeamServiceListMyTeamsRequest; response: TeamServiceListMyTeamsResponse };
  'teamService.inviteMember': { request: TeamServiceInviteMemberRequest; response: TeamServiceInviteMemberResponse };
  'teamService.listMyInvitations': { request: TeamServiceListMyInvitationsRequest; response: TeamServiceListMyInvitationsResponse };
  'teamService.respondInvitation': { request: TeamServiceRespondInvitationRequest; response: TeamServiceRespondInvitationResponse };
  'teamService.listMembers': { request: TeamServiceListMembersRequest; response: TeamServiceListMembersResponse };
  'teamService.leaveTeam': { request: TeamServiceLeaveTeamRequest; response: TeamServiceLeaveTeamResponse };
  'teamService.transferLeadership': { request: TeamServiceTransferLeadershipRequest; response: TeamServiceTransferLeadershipResponse };
  'teamService.acceptLeadership': { request: TeamServiceAcceptLeadershipRequest; response: TeamServiceAcceptLeadershipResponse };
  'teamService.dissolveTeam': { request: TeamServiceDissolveTeamRequest; response: TeamServiceDissolveTeamResponse };
  'notificationService.listMine': { request: NotificationServiceListMineRequest; response: NotificationServiceListMineResponse };
  'notificationService.unreadCount': { request: NotificationServiceUnreadCountRequest; response: NotificationServiceUnreadCountResponse };
  'notificationService.markRead': { request: NotificationServiceMarkReadRequest; response: NotificationServiceMarkReadResponse };
  'notificationService.recordSubscription': { request: NotificationServiceRecordSubscriptionRequest; response: NotificationServiceRecordSubscriptionResponse };
  'notificationService.getSubscriptionOptions': { request: NotificationServiceGetSubscriptionOptionsRequest; response: NotificationServiceGetSubscriptionOptionsResponse };
  'fileService.prepareUpload': { request: FileServicePrepareUploadRequest; response: FileServicePrepareUploadResponse };
  'fileService.getUploadTicket': { request: FileServiceGetUploadTicketRequest; response: FileServiceGetUploadTicketResponse };
  'fileService.finalizeUpload': { request: FileServiceFinalizeUploadRequest; response: FileServiceFinalizeUploadResponse };
  'fileService.getAccessUrl': { request: FileServiceGetAccessUrlRequest; response: FileServiceGetAccessUrlResponse };
  'fileService.deleteUnbound': { request: FileServiceDeleteUnboundRequest; response: FileServiceDeleteUnboundResponse };
  'policyService.listPublished': { request: PolicyServiceListPublishedRequest; response: PolicyServiceListPublishedResponse };
  'policyService.getDetail': { request: PolicyServiceGetDetailRequest; response: PolicyServiceGetDetailResponse };
  'policyService.listDrafts': { request: PolicyServiceListDraftsRequest; response: PolicyServiceListDraftsResponse };
  'policyService.listManage': { request: PolicyServiceListManageRequest; response: PolicyServiceListManageResponse };
  'policyService.getManageDetail': { request: PolicyServiceGetManageDetailRequest; response: PolicyServiceGetManageDetailResponse };
  'policyService.saveDraft': { request: PolicyServiceSaveDraftRequest; response: PolicyServiceSaveDraftResponse };
  'policyService.publish': { request: PolicyServicePublishRequest; response: PolicyServicePublishResponse };
  'policyService.unpublish': { request: PolicyServiceUnpublishRequest; response: PolicyServiceUnpublishResponse };
  'policyService.listManageBanners': { request: PolicyServiceListManageBannersRequest; response: PolicyServiceListManageBannersResponse };
  'policyService.setBannerEnabled': { request: PolicyServiceSetBannerEnabledRequest; response: PolicyServiceSetBannerEnabledResponse };
  'policyService.saveBanner': { request: PolicyServiceSaveBannerRequest; response: PolicyServiceSaveBannerResponse };
  'policyService.listBanners': { request: PolicyServiceListBannersRequest; response: PolicyServiceListBannersResponse };
  'contactService.listContacts': { request: ContactServiceListContactsRequest; response: ContactServiceListContactsResponse };
  'chatService.createDemandConversation': { request: ChatServiceCreateDemandConversationRequest; response: ChatServiceCreateDemandConversationResponse };
  'chatService.listMine': { request: ChatServiceListMineRequest; response: ChatServiceListMineResponse };
  'chatService.getMessages': { request: ChatServiceGetMessagesRequest; response: ChatServiceGetMessagesResponse };
  'chatService.sendMessage': { request: ChatServiceSendMessageRequest; response: ChatServiceSendMessageResponse };
  'chatService.markRead': { request: ChatServiceMarkReadRequest; response: ChatServiceMarkReadResponse };
  'statsService.getOverview': { request: StatsServiceGetOverviewRequest; response: StatsServiceGetOverviewResponse };
  'statsService.getTrend': { request: StatsServiceGetTrendRequest; response: StatsServiceGetTrendResponse };
  'statsService.getCategoryBreakdown': { request: StatsServiceGetCategoryBreakdownRequest; response: StatsServiceGetCategoryBreakdownResponse };
  'statsService.createExport': { request: StatsServiceCreateExportRequest; response: StatsServiceCreateExportResponse };
  'statsService.getExport': { request: StatsServiceGetExportRequest; response: StatsServiceGetExportResponse };
  'knowledgeService.search': { request: KnowledgeServiceSearchRequest; response: KnowledgeServiceSearchResponse };
  'knowledgeService.getDocument': { request: KnowledgeServiceGetDocumentRequest; response: KnowledgeServiceGetDocumentResponse };
  'knowledgeService.saveDraft': { request: KnowledgeServiceSaveDraftRequest; response: KnowledgeServiceSaveDraftResponse };
  'knowledgeService.importDraft': { request: KnowledgeServiceImportDraftRequest; response: KnowledgeServiceImportDraftResponse };
  'knowledgeService.publish': { request: KnowledgeServicePublishRequest; response: KnowledgeServicePublishResponse };
  'knowledgeService.unpublish': { request: KnowledgeServiceUnpublishRequest; response: KnowledgeServiceUnpublishResponse };
  'maintenanceService.createHold': { request: MaintenanceServiceCreateHoldRequest; response: MaintenanceServiceCreateHoldResponse };
  'maintenanceService.releaseHold': { request: MaintenanceServiceReleaseHoldRequest; response: MaintenanceServiceReleaseHoldResponse };
  'maintenanceService.listHolds': { request: MaintenanceServiceListHoldsRequest; response: MaintenanceServiceListHoldsResponse };
  'maintenanceService.listDeadLetters': { request: MaintenanceServiceListDeadLettersRequest; response: MaintenanceServiceListDeadLettersResponse };
  'maintenanceService.retryDeadLetter': { request: MaintenanceServiceRetryDeadLetterRequest; response: MaintenanceServiceRetryDeadLetterResponse };
  'aiService.getExamples': { request: AiServiceGetExamplesRequest; response: AiServiceGetExamplesResponse };
  'aiService.createSession': { request: AiServiceCreateSessionRequest; response: AiServiceCreateSessionResponse };
  'aiService.listSessions': { request: AiServiceListSessionsRequest; response: AiServiceListSessionsResponse };
  'aiService.listMessages': { request: AiServiceListMessagesRequest; response: AiServiceListMessagesResponse };
  'aiService.sendMessage': { request: AiServiceSendMessageRequest; response: AiServiceSendMessageResponse };
  'aiService.getJob': { request: AiServiceGetJobRequest; response: AiServiceGetJobResponse };
  'aiService.getQuota': { request: AiServiceGetQuotaRequest; response: AiServiceGetQuotaResponse };
  'aiService.deleteSession': { request: AiServiceDeleteSessionRequest; response: AiServiceDeleteSessionResponse };
  'aiService.getProposal': { request: AiServiceGetProposalRequest; response: AiServiceGetProposalResponse };
  'aiService.getOperation': { request: AiServiceGetOperationRequest; response: AiServiceGetOperationResponse };
  'aiService.cancelPendingIntent': { request: AiServiceCancelPendingIntentRequest; response: AiServiceCancelPendingIntentResponse };
  'userService.getRelease': { request: UserServiceGetReleaseRequest; response: UserServiceGetReleaseResponse };
  'demandService.getRelease': { request: DemandServiceGetReleaseRequest; response: DemandServiceGetReleaseResponse };
  'teamService.getRelease': { request: TeamServiceGetReleaseRequest; response: TeamServiceGetReleaseResponse };
  'fileService.getRelease': { request: FileServiceGetReleaseRequest; response: FileServiceGetReleaseResponse };
  'policyService.getRelease': { request: PolicyServiceGetReleaseRequest; response: PolicyServiceGetReleaseResponse };
  'notificationService.getRelease': { request: NotificationServiceGetReleaseRequest; response: NotificationServiceGetReleaseResponse };
  'chatService.getRelease': { request: ChatServiceGetReleaseRequest; response: ChatServiceGetReleaseResponse };
  'contactService.getRelease': { request: ContactServiceGetReleaseRequest; response: ContactServiceGetReleaseResponse };
  'statsService.getRelease': { request: StatsServiceGetReleaseRequest; response: StatsServiceGetReleaseResponse };
  'knowledgeService.getRelease': { request: KnowledgeServiceGetReleaseRequest; response: KnowledgeServiceGetReleaseResponse };
  'aiService.getRelease': { request: AiServiceGetReleaseRequest; response: AiServiceGetReleaseResponse };
  'maintenanceService.getRelease': { request: MaintenanceServiceGetReleaseRequest; response: MaintenanceServiceGetReleaseResponse };
}
