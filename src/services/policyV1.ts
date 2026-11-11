import { cloudCall } from './cloudClient';
import { businessCommand } from './businessCommand';
import { useSessionStore } from '../stores/session';
import type { ContractMap } from '../../contracts/generated/dto';
export const listBanners = () => cloudCall('policyService.listBanners', {});
export const listPolicies = (query: ContractMap['policyService.listManage']['request']) =>
  cloudCall('policyService.listManage', query, useSessionStore().options());
export const getPolicy = (policy_id: string) =>
  cloudCall('policyService.getManageDetail', { policy_id }, useSessionStore().options());
export const listManageBanners = (cursor?: string) =>
  cloudCall(
    'policyService.listManageBanners',
    { ...(cursor ? { cursor } : {}) },
    useSessionStore().options(),
  );
export const savePolicy = (data: ContractMap['policyService.saveDraft']['request']) =>
  businessCommand('policyService.saveDraft', data);
export const publishPolicy = (policy_id: string, expected_version: number) =>
  businessCommand('policyService.publish', { policy_id, expected_version });
export const unpublishPolicy = (policy_id: string, expected_version: number, reason: string) =>
  businessCommand('policyService.unpublish', { policy_id, expected_version, reason });
export const saveBanner = (data: ContractMap['policyService.saveBanner']['request']) =>
  businessCommand('policyService.saveBanner', data);
export const setBannerEnabled = (banner_id: string, expected_version: number, enabled: boolean) =>
  businessCommand('policyService.setBannerEnabled', { banner_id, expected_version, enabled });
