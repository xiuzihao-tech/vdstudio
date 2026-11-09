// 后台账号和权限：超级管理员（服务器 ADMIN_EMAILS 里的邮箱）能加别的后台账号，按角色给能看的页面。
export type AdminPerm = 'overview' | 'skills' | 'upstreams' | 'points' | 'referral' | 'orders' | 'jobs' | 'users' | 'modules' | 'codes' | 'feedback' | 'admins' | 'audit';
export type AdminRole = 'super' | 'ops' | 'finance' | 'tech' | 'cs';
export const ROLES: Record<AdminRole, { n: string; d: string; perms: AdminPerm[] }> = {
  super: { n: '超级管理员', d: '全部权限，能加后台账号', perms: ['overview', 'skills', 'upstreams', 'points', 'referral', 'orders', 'jobs', 'users', 'modules', 'codes', 'feedback', 'admins', 'audit'] },
  ops: { n: '运营', d: '技能、模块开关、用户、兑换码、反馈、邀请赠送', perms: ['overview', 'skills', 'referral', 'jobs', 'users', 'modules', 'codes', 'feedback'] },
  finance: { n: '财务', d: '订单、积分、邀请赠送、退款', perms: ['overview', 'points', 'referral', 'orders', 'users'] },
  tech: { n: '技术', d: '技能、上游接口、出片任务、操作日志', perms: ['overview', 'skills', 'upstreams', 'jobs', 'modules', 'audit'] },
  cs: { n: '客服', d: '查用户、订单、出片任务，处理反馈', perms: ['overview', 'users', 'orders', 'jobs', 'feedback'] },
};
export interface AdminMe { email: string; role: AdminRole; roleName: string; perms: AdminPerm[] }
