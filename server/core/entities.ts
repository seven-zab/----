import type { Entity } from './repository';

export type Role = 'farmer' | 'teacher_student' | 'local_admin' | 'super_admin';
export interface User extends Entity {
  _openid: string;
  user_code: string;
  display_name: string;
  avatar_file_id: string | null;
  account_status: 'active' | 'banned' | 'deactivated';
  auth_version: number;
  operation_seq: number;
  grant_ids: string[];
  application_ids: string[];
  created_at: number;
}
export interface Grant extends Entity {
  user_id: string;
  role: Role;
  profile_kind: 'farmer' | 'merchant' | 'teacher' | 'student' | null;
  organization_id: string | null;
  scope_type: 'self' | 'region' | 'platform';
  scope_region_id: string | null;
  status: 'active' | 'expired' | 'revoked';
  expires_at: number | null;
  renewed_from: string | null;
  revoked_at: number | null;
}
export interface Region extends Entity {
  name: string;
  level: 'province' | 'city' | 'county' | 'town' | 'village';
  ancestor_ids: string[];
  active: boolean;
}
export interface Scene {
  business_scene: 'village' | 'campus';
  region_id?: string | null;
  campus_organization_id?: string | null;
  region_path_ids?: string[];
}
export interface Application extends Entity {
  applicant_id: string;
  requested_role: Role;
  profile_kind: Grant['profile_kind'];
  scope_region_id: string | null;
  organization_id: string | null;
  material_ids: string[];
  review_scope: string;
  source_grant_id: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  version: number;
  created_at: number;
  reviewed_at: number | null;
  reviewed_by: string | null;
  reason: string | null;
  lock_id: string;
}
