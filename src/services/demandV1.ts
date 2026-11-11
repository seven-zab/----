import { cloudCall } from './cloudClient';
import { useSessionStore } from '../stores/session';
import type { ContractMap, DemandCreateInput, DraftInput } from '../../contracts/generated/dto';
import { businessCommand } from './businessCommand';
export const demandCommand = businessCommand;
export const publicDemands = (query: ContractMap['demandService.listPublic']['request']) =>
  cloudCall('demandService.listPublic', query);
export const demandDetail = (demand_id: string) =>
  cloudCall('demandService.getDetail', { demand_id }, useSessionStore().options());
export const saveDraft = (form: DraftInput) => demandCommand('demandService.saveDraft', form);
export async function submitDemand(form: DemandCreateInput) {
  const check = await demandCommand('demandService.checkSubmission', form);
  if (check.status !== 'pass') throw new Error('内容检查未通过，请修改后再提交');
  return demandCommand('demandService.createAndSubmit', form);
}
