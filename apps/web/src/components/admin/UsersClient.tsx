'use client';

import React, { useState } from 'react';
import {
  Users,
  UserPlus,
  Shield,
  ShieldCheck,
  Search,
  Key,
  RotateCw,
  Lock,
  CheckCircle2,
  AlertCircle,
  X,
  Copy,
  Check,
  FolderKanban,
  Bell,
  CreditCard,
  UserX,
} from 'lucide-react';
import { AdminUserListItem, AdminUserStats } from '@emeradar/services';
import { resolvePlanCode } from '@/lib/plan-display';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { Stat } from '@/components/ui/Stat';
import { cn } from '@/lib/cn';

interface UsersClientProps {
  initialItems: AdminUserListItem[];
  initialTotal: number;
  initialStats: AdminUserStats;
}

const roleTone = (role: string): BadgeTone => {
  if (role === 'ADMIN') return 'warn';
  if (role === 'ANALYST') return 'accent';
  if (role === 'SUPPORT') return 'info';
  return 'neutral';
};

const tierTone = (tier: string): BadgeTone => {
  if (tier === 'TEAM') return 'signal';
  if (tier === 'PRO') return 'info';
  return 'neutral';
};

/**
 * Plan wording for the admin table, matching the filter dropdown above it.
 *
 * `TEAM` is a legacy compatibility value — the product sells Free and Builder
 * Pro — so an account holding it is named as legacy here rather than printed as
 * a tier someone could buy. The rest of the interface goes through
 * `planLabelKey`, which is translated; this file carries hardcoded Chinese copy
 * throughout, so it reuses the dropdown's vocabulary instead of mixing in a
 * second source of switchable wording.
 */
const tierLabel = (tier: string): string => {
  if (tier === 'TEAM') return '历史套餐 (TEAM)';
  if (tier === 'PRO') return '专业版 (PRO)';
  return '免费版 (FREE)';
};

const statusTone = (status: string): BadgeTone => {
  if (status === 'ACTIVE') return 'signal';
  if (status === 'SUSPENDED') return 'danger';
  return 'neutral';
};

export function UsersClient({
  initialItems,
  initialTotal,
  initialStats,
}: UsersClientProps) {
  const [users, setUsers] = useState<AdminUserListItem[]>(initialItems);
  const [total, setTotal] = useState<number>(initialTotal);
  const [stats, setStats] = useState<AdminUserStats>(initialStats);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editRoleUser, setEditRoleUser] = useState<AdminUserListItem | null>(null);
  const [selectedRole, setSelectedRole] = useState<'USER' | 'ANALYST' | 'ADMIN' | 'SUPPORT'>('USER');
  const [editTierUser, setEditTierUser] = useState<AdminUserListItem | null>(null);
  const [selectedTier, setSelectedTier] = useState<'FREE' | 'PRO' | 'TEAM'>('FREE');
  const [resetPwdUser, setResetPwdUser] = useState<AdminUserListItem | null>(null);
  const [customPassword, setCustomPassword] = useState('');
  const [temporaryPasswordResult, setTemporaryPasswordResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Create form state
  const [newEmail, setNewEmail] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newRole, setNewRole] = useState<'USER' | 'ANALYST' | 'ADMIN' | 'SUPPORT'>('USER');
  const [newTier, setNewTier] = useState<'FREE' | 'PRO' | 'TEAM'>('FREE');
  const [newPassword, setNewPassword] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [resetPending, setResetPending] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (roleFilter) params.set('role', roleFilter);
      if (tierFilter) params.set('tier', tierFilter);
      if (statusFilter) params.set('status', statusFilter);
      params.set('limit', '50');

      const res = await fetch(`/api/v1/admin/users?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data.items);
        setTotal(data.total);
        setStats(data.stats);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async (userId: string, updates: { role?: string; tier?: string; status?: string }) => {
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error('update-failed');
      }

      setUsers((prev) => prev.map((u) => (u.id === userId ? data : u)));
      setMessage({ text: '用户信息已成功更新', type: 'success' });
      fetchUsers(); // Refresh stats
      return true;
    } catch (err: any) {
      console.error('更新用户信息失败:', err);
      setMessage({ text: '更新用户信息失败，请稍后重试', type: 'error' });
      return false;
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch('/api/v1/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newEmail,
          displayName: newDisplayName || undefined,
          role: newRole,
          tier: newTier,
          password: newPassword || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error('create-failed');
      }

      setTemporaryPasswordResult(data.temporaryPassword);
      setUsers((prev) => [data.user, ...prev]);
      setTotal((prev) => prev + 1);
      setMessage({ text: `用户 ${data.user.email} 创建成功！`, type: 'success' });
      // Reset form fields but keep modal open to copy password
      setNewEmail('');
      setNewDisplayName('');
      setNewPassword('');
      fetchUsers();
    } catch (err: any) {
      console.error('创建用户失败:', err);
      setMessage({ text: '创建用户失败，请稍后重试', type: 'error' });
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetPwdUser) return;
    if (resetPending) return;
    setResetPending(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/admin/users/${resetPwdUser.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: customPassword || undefined }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error('reset-failed');
      }

      setTemporaryPasswordResult(data.temporaryPassword);
      setMessage({ text: `已成功为 ${resetPwdUser.email} 重置密码！`, type: 'success' });
    } catch (err: any) {
      console.error('重置用户密码失败:', err);
      setMessage({ text: '重置密码失败，请稍后重试', type: 'error' });
    } finally {
      setResetPending(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-line pb-5 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-info/40 bg-info/10 text-info">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold tracking-tight text-fg">用户与权限治理</h1>
              <p className="text-xs text-fg-muted">
                平台用户全生命周期管理、角色提权、套餐配额调整与账户安全控制
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fetchUsers()}
            disabled={loading}
          >
            <RotateCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>刷新</span>
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setTemporaryPasswordResult(null);
              setIsCreateOpen(true);
            }}
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>新建用户</span>
          </Button>
        </div>
      </div>

      {/* Global Alert Notification */}
      {message && (
        <div
          className={cn(
            'flex items-center justify-between rounded-sm border p-3 text-xs',
            message.type === 'success'
              ? 'border-signal/40 bg-signal/10 text-signal'
              : 'border-danger/40 bg-danger/10 text-danger'
          )}
        >
          <div className="flex items-center gap-2">
            {message.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            <span>{message.text}</span>
          </div>
          <button type="button" aria-label="关闭提示" onClick={() => setMessage(null)} className="text-fg-subtle hover:text-fg">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* High-level User Statistics Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Panel tone="sunken" className="p-4">
          <Stat value={stats.totalUsers} label="TOTAL USERS" />
          <p className="mt-1 text-[11px] text-fg-subtle">全平台注册账号总数</p>
        </Panel>

        <Panel tone="sunken" className="p-4">
          <Stat value={stats.activeUsers} label="ACTIVE" tone="signal" />
          <p className="mt-1 text-[11px] text-fg-subtle">正常状态可登录用户</p>
        </Panel>

        <Panel tone="sunken" className="p-4">
          <Stat value={stats.paidUsers} label="PAID" tone="accent" />
          <p className="mt-1 text-[11px] text-fg-subtle">PRO 订阅（含历史 TEAM）</p>
        </Panel>

        <Panel tone="sunken" className="p-4">
          <Stat value={stats.staffUsers} label="STAFF" tone="warn" />
          <p className="mt-1 text-[11px] text-fg-subtle">具有 ADMIN / ANALYST 权限</p>
        </Panel>
      </div>

      {/* Filters Bar */}
      <Panel tone="raised" className="flex flex-col items-center gap-3 p-3 md:flex-row">
        <div className="relative w-full flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
          <Input
            id="admin-user-search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchUsers()}
            placeholder="搜索邮箱、昵称或 User ID..."
            className="pl-9"
          />
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:flex-nowrap">
          {/* Role Filter */}
          <Select
            id="admin-user-role-filter"
            aria-label="按角色筛选"
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value);
            }}
            className="w-auto min-w-0 flex-1 md:flex-none"
          >
            <option value="">全部角色</option>
            <option value="USER">普通用户 (USER)</option>
            <option value="ANALYST">分析师 (ANALYST)</option>
            <option value="ADMIN">管理员 (ADMIN)</option>
            <option value="SUPPORT">客服支持 (SUPPORT)</option>
          </Select>

          {/* Tier Filter */}
          <Select
            id="admin-user-tier-filter"
            aria-label="按套餐筛选"
            value={tierFilter}
            onChange={(e) => {
              setTierFilter(e.target.value);
            }}
            className="w-auto min-w-0 flex-1 md:flex-none"
          >
            <option value="">全部套餐</option>
            <option value="FREE">免费版 (FREE)</option>
            <option value="PRO">专业版 (PRO)</option>
            <option value="TEAM">TEAM（历史兼容）</option>
          </Select>

          {/* Status Filter */}
          <Select
            id="admin-user-status-filter"
            aria-label="按状态筛选"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
            }}
            className="w-auto min-w-0 flex-1 md:flex-none"
          >
            <option value="">全部状态</option>
            <option value="ACTIVE">正常 (ACTIVE)</option>
            <option value="SUSPENDED">已冻结 (SUSPENDED)</option>
            <option value="DELETED">已注销 (DELETED)</option>
          </Select>

          <Button
            type="button"
            size="sm"
            onClick={() => fetchUsers()}
            className="shrink-0"
          >
            筛选
          </Button>
        </div>
      </Panel>

      {/* Users Table */}
      <Panel tone="raised" className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line p-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-fg">用户列表</span>
            <span className="text-[11px] text-fg-subtle">共 {total} 个匹配账户</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-line font-mono text-[10px] uppercase tracking-[0.14em] text-fg-subtle">
              <tr>
                <th className="px-4 py-3 font-semibold">ACCOUNT</th>
                <th className="px-4 py-3 font-semibold">ROLE</th>
                <th className="px-4 py-3 font-semibold">TIER</th>
                <th className="px-4 py-3 font-semibold">STATUS</th>
                <th className="px-4 py-3 font-semibold">ASSETS</th>
                <th className="px-4 py-3 font-semibold">JOINED</th>
                <th className="px-4 py-3 text-right font-semibold">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-fg-subtle">
                    未找到符合条件的用户
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  return (
                    <tr key={u.id} className="transition hover:bg-surface-2">
                      {/* Identity */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-xs font-bold text-fg-muted">
                            {u.displayName?.slice(0, 2).toUpperCase() || u.email.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 truncate font-semibold text-fg">
                              <span>{u.displayName || 'Builder'}</span>
                              {u.hasActiveSubscription && (
                                <span className="h-1.5 w-1.5 rounded-full bg-signal" title="Active Subscription" />
                              )}
                            </div>
                            <div className="truncate font-mono text-[11px] text-fg-subtle">{u.email}</div>
                            <div className="font-mono text-[10px] text-fg-subtle">{u.id}</div>
                          </div>
                        </div>
                      </td>

                      {/* Role */}
                      <td className="px-4 py-3.5">
                        <Badge tone={roleTone(u.role)}>
                          <Shield className="h-3 w-3" />
                          <span>{u.role}</span>
                        </Badge>
                      </td>

                      {/* Plan — named from the resolved plan code rather than the
                          raw `tier` column: `tier` is a mirror that only agrees
                          with the entitlements while every writer keeps it in
                          step, and this column is what an operator reads when
                          deciding whether someone is paying. */}
                      <td className="px-4 py-3.5">
                        <Badge tone={tierTone(resolvePlanCode(u))}>
                          <CreditCard className="h-3 w-3" />
                          <span>{tierLabel(resolvePlanCode(u))}</span>
                        </Badge>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5">
                        <Badge tone={statusTone(u.status)}>
                          {u.status === 'ACTIVE' && <CheckCircle2 className="h-3 w-3" />}
                          {u.status === 'SUSPENDED' && <AlertCircle className="h-3 w-3" />}
                          {u.status === 'DELETED' && <UserX className="h-3 w-3" />}
                          <span>{u.status}</span>
                        </Badge>
                      </td>

                      {/* Linked Resources */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3 font-mono text-[11px] text-fg-muted">
                          <span title="项目数" className="flex items-center gap-1">
                            <FolderKanban className="h-3.5 w-3.5 text-info" />
                            <span>{u.projectsCount}</span>
                          </span>
                          <span title="告警规则数" className="flex items-center gap-1">
                            <Bell className="h-3.5 w-3.5 text-warn" />
                            <span>{u.alertsCount}</span>
                          </span>
                          <span title="活跃 API Key" className="flex items-center gap-1">
                            <Key className="h-3.5 w-3.5 text-signal" />
                            <span>{u.apiKeysCount}</span>
                          </span>
                        </div>
                      </td>

                      {/* Created At */}
                      <td className="whitespace-nowrap px-4 py-3.5 font-mono text-[11px] text-fg-subtle">
                        {u.createdAt.slice(0, 16)}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditRoleUser(u);
                              setSelectedRole(u.role);
                            }}
                            title="修改角色权限"
                          >
                            设角色
                          </Button>

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditTierUser(u);
                              setSelectedTier(resolvePlanCode(u) as 'FREE' | 'PRO' | 'TEAM');
                            }}
                            title="调整会员套餐"
                          >
                            调套餐
                          </Button>

                          {u.status === 'ACTIVE' ? (
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => handleUpdate(u.id, { status: 'SUSPENDED' })}
                              title="冻结账号并登出所有会话"
                            >
                              冻结
                            </Button>
                          ) : (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => handleUpdate(u.id, { status: 'ACTIVE' })}
                              title="解冻并恢复正常访问"
                            >
                              解冻
                            </Button>
                          )}

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setResetPwdUser(u);
                              setCustomPassword('');
                              setTemporaryPasswordResult(null);
                            }}
                            title="重置登录密码"
                          >
                            重置密码
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Modal: Create User */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/70 p-4 backdrop-blur-sm">
          <Panel tone="raised" className="w-full max-w-md space-y-4 p-6">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-info" />
                <h2 className="text-base font-bold text-fg">管理员新建用户</h2>
              </div>
              <button type="button" aria-label="关闭新建用户弹窗" onClick={() => setIsCreateOpen(false)} className="text-fg-subtle hover:text-fg">
                <X className="h-4 w-4" />
              </button>
            </div>

            {temporaryPasswordResult ? (
              <div className="space-y-4 py-2">
                <div className="space-y-2 rounded-sm border border-signal/40 bg-signal/10 p-4 text-xs text-signal">
                  <div className="flex items-center gap-1.5 font-bold">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>用户创建成功，初始密码如下：</span>
                  </div>
                  <p className="text-[11px] text-signal">
                    请将密码安全送达该用户，关闭弹窗后无法再次查看明文。
                  </p>
                  <div className="flex items-center justify-between rounded-sm border border-signal/40 bg-canvas p-2.5 font-mono text-sm text-fg">
                    <span>{temporaryPasswordResult}</span>
                    <button
                      type="button"
                      aria-label="复制初始密码"
                      onClick={() => copyToClipboard(temporaryPasswordResult)}
                      className="flex items-center gap-1 rounded-sm border border-signal/40 bg-signal/10 px-2 py-1 text-xs text-signal hover:bg-signal/20"
                    >
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      <span>{copied ? '已复制' : '复制'}</span>
                    </button>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsCreateOpen(false);
                      setTemporaryPasswordResult(null);
                    }}
                  >
                    完成
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateUser} className="space-y-4">
                <div>
                  <label htmlFor="admin-new-email" className="mb-1 block text-xs font-semibold text-fg-muted">
                    邮箱地址 <span className="text-danger">*</span>
                  </label>
                  <Input
                    id="admin-new-email"
                    name="email"
                    autoComplete="email"
                    type="email"
                    required
                    maxLength={254}
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="user@example.com"
                  />
                </div>

                <div>
                  <label htmlFor="admin-new-display-name" className="mb-1 block text-xs font-semibold text-fg-muted">用户显示昵称</label>
                  <Input
                    id="admin-new-display-name"
                    name="displayName"
                    type="text"
                    maxLength={80}
                    value={newDisplayName}
                    onChange={(e) => setNewDisplayName(e.target.value)}
                    placeholder="例如: Alex Builder"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="admin-new-role" className="mb-1 block text-xs font-semibold text-fg-muted">角色权限</label>
                    <Select
                      id="admin-new-role"
                      name="role"
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value as any)}
                    >
                      <option value="USER">USER (普通用户)</option>
                      <option value="ANALYST">ANALYST (分析师)</option>
                      <option value="ADMIN">ADMIN (管理员)</option>
                      <option value="SUPPORT">SUPPORT (支持)</option>
                    </Select>
                  </div>

                  <div>
                    <label htmlFor="admin-new-tier" className="mb-1 block text-xs font-semibold text-fg-muted">套餐等级</label>
                    <Select
                      id="admin-new-tier"
                      name="tier"
                      value={newTier}
                      onChange={(e) => setNewTier(e.target.value as any)}
                    >
                      <option value="FREE">FREE (免费版)</option>
                      <option value="PRO">PRO (专业版)</option>
                      <option value="TEAM">TEAM（历史兼容）</option>
                    </Select>
                  </div>
                </div>

                <div>
                  <label htmlFor="admin-new-password" className="mb-1 block text-xs font-semibold text-fg-muted">
                    指定初始密码 <span className="font-normal text-fg-subtle">(留空则自动生成随机高强度密码)</span>
                  </label>
                  <Input
                    id="admin-new-password"
                    name="password"
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="至少 8 位，留空自动生成"
                    className="font-mono"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-line pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsCreateOpen(false)}
                  >
                    取消
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={createSubmitting}
                  >
                    {createSubmitting ? '创建中...' : '确认创建'}
                  </Button>
                </div>
              </form>
            )}
          </Panel>
        </div>
      )}

      {/* Modal: Edit Role */}
      {editRoleUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/70 p-4 backdrop-blur-sm">
          <Panel tone="raised" className="w-full max-w-sm space-y-4 p-6">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-warn" />
                <h2 className="text-base font-bold text-fg">修改用户角色权限</h2>
              </div>
              <button type="button" aria-label="关闭角色编辑弹窗" onClick={() => setEditRoleUser(null)} className="text-fg-subtle hover:text-fg">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="text-xs text-fg-muted">
              目标账户: <span className="font-bold text-fg">{editRoleUser.email}</span>
            </div>

            <div className="space-y-2">
              {[
                { value: 'USER', label: 'USER (普通用户)', desc: '前台机会发现、个人项目管理与告警' },
                { value: 'ANALYST', label: 'ANALYST (生态分析师)', desc: '可查看候选池大屏与打分评估' },
                { value: 'ADMIN', label: 'ADMIN (系统管理员)', desc: '全权管理后台、流水线、数据源与用户' },
                { value: 'SUPPORT', label: 'SUPPORT (客户支持)', desc: '只读权限与用户支持辅助' },
              ].map((r) => (
                <label
                  key={r.value}
                  className={cn(
                    'flex cursor-pointer items-start gap-2.5 rounded-sm border p-3 transition',
                    selectedRole === r.value
                      ? 'border-accent bg-accent/10 text-fg'
                      : 'border-line bg-surface-2 text-fg-muted hover:bg-surface-2/70'
                  )}
                >
                  <input
                    type="radio"
                    name="roleOption"
                    value={r.value}
                    checked={selectedRole === r.value}
                    onChange={() => setSelectedRole(r.value as any)}
                    className="mt-0.5 text-accent focus:ring-0"
                  />
                  <div>
                    <div className="text-xs font-bold">{r.label}</div>
                    <div className="mt-0.5 text-[11px] text-fg-subtle">{r.desc}</div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-line pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditRoleUser(null)}
              >
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={async () => {
                  const ok = await handleUpdate(editRoleUser.id, { role: selectedRole });
                  if (ok) setEditRoleUser(null);
                }}
              >
                保存变更
              </Button>
            </div>
          </Panel>
        </div>
      )}

      {/* Modal: Edit Tier */}
      {editTierUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/70 p-4 backdrop-blur-sm">
          <Panel tone="raised" className="w-full max-w-sm space-y-4 p-6">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-info" />
                <h2 className="text-base font-bold text-fg">调整会员等级</h2>
              </div>
              <button type="button" aria-label="关闭套餐编辑弹窗" onClick={() => setEditTierUser(null)} className="text-fg-subtle hover:text-fg">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="text-xs text-fg-muted">
              目标账户: <span className="font-bold text-fg">{editTierUser.email}</span>
            </div>

            <div className="space-y-2">
              {[
                { value: 'FREE', label: 'FREE (免费版)', desc: '查看基础雷达、1个追踪项目、1 条告警规则' },
                // The numbers here mirror `plans.entitlements`, which is what the
                // grant actually inserts. They used to read "5个项目、无限实时扫描"
                // while the catalog said 50 projects and 30 scans/day, so an
                // operator picked PRO expecting one thing and shipped another.
                { value: 'PRO', label: 'PRO (专业版)', desc: '解锁高置信深度报告、50 个项目、20 条告警规则、每日 30 次实时扫描' },
                { value: 'TEAM', label: 'TEAM（历史兼容）', desc: '团队版已下线：仅用于存量账号，不提供团队协同席位' },
              ].map((t) => (
                <label
                  key={t.value}
                  className={cn(
                    'flex cursor-pointer items-start gap-2.5 rounded-sm border p-3 transition',
                    selectedTier === t.value
                      ? 'border-accent bg-accent/10 text-fg'
                      : 'border-line bg-surface-2 text-fg-muted hover:bg-surface-2/70'
                  )}
                >
                  <input
                    type="radio"
                    name="tierOption"
                    value={t.value}
                    checked={selectedTier === t.value}
                    onChange={() => setSelectedTier(t.value as any)}
                    className="mt-0.5 text-accent focus:ring-0"
                  />
                  <div>
                    <div className="text-xs font-bold">{t.label}</div>
                    <div className="mt-0.5 text-[11px] text-fg-subtle">{t.desc}</div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-line pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditTierUser(null)}
              >
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={async () => {
                  const ok = await handleUpdate(editTierUser.id, { tier: selectedTier });
                  if (ok) setEditTierUser(null);
                }}
              >
                保存变更
              </Button>
            </div>
          </Panel>
        </div>
      )}

      {/* Modal: Reset Password */}
      {resetPwdUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/70 p-4 backdrop-blur-sm">
          <Panel tone="raised" className="w-full max-w-sm space-y-4 p-6">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <Lock className="h-5 w-5 text-danger" />
                <h2 className="text-base font-bold text-fg">重置用户密码</h2>
              </div>
              <button type="button" aria-label="关闭密码重置弹窗" onClick={() => setResetPwdUser(null)} className="text-fg-subtle hover:text-fg">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="text-xs text-fg-muted">
              目标账户: <span className="font-bold text-fg">{resetPwdUser.email}</span>
            </div>

            {temporaryPasswordResult ? (
              <div className="space-y-4">
                <div className="space-y-2 rounded-sm border border-signal/40 bg-signal/10 p-3">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-signal">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>新密码设置成功:</span>
                  </div>
                  <div className="flex items-center justify-between rounded-sm border border-signal/40 bg-canvas p-2.5 font-mono text-sm text-fg">
                    <span>{temporaryPasswordResult}</span>
                    <button
                      type="button"
                      aria-label="复制新密码"
                      onClick={() => copyToClipboard(temporaryPasswordResult)}
                      className="flex items-center gap-1 rounded-sm border border-signal/40 bg-signal/10 px-2 py-1 text-xs text-signal hover:bg-signal/20"
                    >
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      <span>{copied ? '已复制' : '复制'}</span>
                    </button>
                  </div>
                  <p className="text-[10px] text-fg-subtle">
                    该用户的现有登录会话已被强制注销，需使用新密码重新登录。
                  </p>
                </div>

                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setResetPwdUser(null);
                      setTemporaryPasswordResult(null);
                    }}
                  >
                    关闭
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[11px] text-fg-subtle">
                  重置后，该用户的所有已登录设备均会强制下线。请输入指定的新密码或留空由系统自动生成随机密码。
                </p>

                <div>
                  <label htmlFor="admin-reset-password" className="mb-1 block text-xs font-semibold text-fg-muted">
                    指定新密码 (可选，至少 8 位)
                  </label>
                  <Input
                    id="admin-reset-password"
                    name="password"
                    type="text"
                    value={customPassword}
                    onChange={(e) => setCustomPassword(e.target.value)}
                    placeholder="留空则自动生成高强度临时密码"
                    className="font-mono"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-line pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setResetPwdUser(null)}
                  >
                    取消
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={handleResetPassword}
                    disabled={resetPending}
                  >
                    {resetPending ? '重置中...' : '确认重置'}
                  </Button>
                </div>
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
