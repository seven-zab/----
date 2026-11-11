import type { DemandStatus, Role } from '../../contracts/enums';
export const demandStatusLabels: Record<DemandStatus, string> = {
  draft: '草稿',
  pending_audit: '待审核',
  rejected: '审核未通过',
  pending_claim: '待接取',
  claiming: '待发布者确认',
  processing: '服务中',
  pending_review: '待验收',
  completed: '已完成',
  cancelled: '已取消',
  expired: '已到期',
  terminated: '已终止',
};
export const roleLabels: Record<Role, string> = {
  general_user: '普通用户',
  farmer: '农商户',
  teacher_student: '本校师生',
  local_admin: '村委',
  super_admin: '超级管理员',
};
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '请求失败，请稍后重试';
