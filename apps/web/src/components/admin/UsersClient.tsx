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

interface UsersClientProps {
  initialItems: AdminUserListItem[];
  initialTotal: number;
  initialStats: AdminUserStats;
}

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
        throw new Error(data.error || '操作失败');
      }

      setUsers((prev) => prev.map((u) => (u.id === userId ? data : u)));
      setMessage({ text: '用户信息已成功更新', type: 'success' });
      fetchUsers(); // Refresh stats
      return true;
    } catch (err: any) {
      setMessage({ text: err.message || '更新失败', type: 'error' });
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
        throw new Error(data.error || '创建用户失败');
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
      setMessage({ text: err.message || '创建失败', type: 'error' });
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetPwdUser) return;
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/admin/users/${resetPwdUser.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: customPassword || undefined }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '重置密码失败');
      }

      setTemporaryPasswordResult(data.temporaryPassword);
      setMessage({ text: `已成功为 ${resetPwdUser.email} 重置密码！`, type: 'success' });
    } catch (err: any) {
      setMessage({ text: err.message || '重置失败', type: 'error' });
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-black text-white tracking-tight">用户与权限治理</h1>
              <p className="text-xs text-slate-400">
                平台用户全生命周期管理、角色提权、套餐配额调整与账户安全控制
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => fetchUsers()}
            disabled={loading}
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition border border-slate-700 disabled:opacity-50"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>刷新</span>
          </button>
          <button
            onClick={() => {
              setTemporaryPasswordResult(null);
              setIsCreateOpen(true);
            }}
            className="px-3.5 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition shadow-lg shadow-purple-600/20"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>新建用户</span>
          </button>
        </div>
      </div>

      {/* Global Alert Notification */}
      {message && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
            message.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {message.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400" />
            )}
            <span>{message.text}</span>
          </div>
          <button onClick={() => setMessage(null)} className="text-slate-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* High-level User Statistics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">总注册用户</div>
          <div className="text-2xl font-black text-white mt-1">{stats.totalUsers}</div>
          <div className="text-[11px] text-slate-500 mt-1">全平台注册账号总数</div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4">
          <div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">活跃账户</div>
          <div className="text-2xl font-black text-emerald-400 mt-1">{stats.activeUsers}</div>
          <div className="text-[11px] text-slate-500 mt-1">正常状态可登录用户</div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4">
          <div className="text-[11px] font-semibold text-blue-400 uppercase tracking-wider">付费会员</div>
          <div className="text-2xl font-black text-blue-400 mt-1">{stats.paidUsers}</div>
          <div className="text-[11px] text-slate-500 mt-1">PRO 或 TEAM 商业订阅</div>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-4">
          <div className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider">运营与分析人员</div>
          <div className="text-2xl font-black text-amber-400 mt-1">{stats.staffUsers}</div>
          <div className="text-[11px] text-slate-500 mt-1">具有 ADMIN / ANALYST 权限</div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col md:flex-row items-center gap-3 bg-slate-950/40 border border-slate-800/80 p-3 rounded-2xl">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchUsers()}
            placeholder="搜索邮箱、昵称或 User ID..."
            className="w-full bg-slate-900 border border-slate-700/70 rounded-xl pl-9 pr-4 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-purple-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          {/* Role Filter */}
          <select
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter(e.target.value);
            }}
            className="bg-slate-900 border border-slate-700/70 text-slate-300 text-xs rounded-xl px-2.5 py-1.5 focus:outline-none focus:border-purple-500"
          >
            <option value="">全部角色</option>
            <option value="USER">普通用户 (USER)</option>
            <option value="ANALYST">分析师 (ANALYST)</option>
            <option value="ADMIN">管理员 (ADMIN)</option>
            <option value="SUPPORT">客服支持 (SUPPORT)</option>
          </select>

          {/* Tier Filter */}
          <select
            value={tierFilter}
            onChange={(e) => {
              setTierFilter(e.target.value);
            }}
            className="bg-slate-900 border border-slate-700/70 text-slate-300 text-xs rounded-xl px-2.5 py-1.5 focus:outline-none focus:border-purple-500"
          >
            <option value="">全部套餐</option>
            <option value="FREE">免费版 (FREE)</option>
            <option value="PRO">专业版 (PRO)</option>
            <option value="TEAM">团队版 (TEAM)</option>
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
            }}
            className="bg-slate-900 border border-slate-700/70 text-slate-300 text-xs rounded-xl px-2.5 py-1.5 focus:outline-none focus:border-purple-500"
          >
            <option value="">全部状态</option>
            <option value="ACTIVE">正常 (ACTIVE)</option>
            <option value="SUSPENDED">已冻结 (SUSPENDED)</option>
            <option value="DELETED">已注销 (DELETED)</option>
          </select>

          <button
            onClick={() => fetchUsers()}
            className="px-3 py-1.5 bg-purple-600/80 hover:bg-purple-600 text-white rounded-xl text-xs font-semibold shrink-0"
          >
            筛选
          </button>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-200">用户列表</span>
            <span className="text-[11px] text-slate-400">共 {total} 个匹配账户</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/60 text-slate-400 border-b border-slate-800/80 font-mono text-[11px]">
              <tr>
                <th className="py-3 px-4">账户与标识</th>
                <th className="py-3 px-4">角色权限</th>
                <th className="py-3 px-4">会员等级</th>
                <th className="py-3 px-4">状态</th>
                <th className="py-3 px-4">业务资产</th>
                <th className="py-3 px-4">注册时间</th>
                <th className="py-3 px-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-500">
                    未找到符合条件的用户
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const roleColors: Record<string, string> = {
                    ADMIN: 'bg-amber-400/20 text-amber-300 border-amber-400/40',
                    ANALYST: 'bg-blue-400/20 text-blue-300 border-blue-400/40',
                    SUPPORT: 'bg-purple-400/20 text-purple-300 border-purple-400/40',
                    USER: 'bg-slate-800 text-slate-300 border-slate-700',
                  };

                  const tierColors: Record<string, string> = {
                    TEAM: 'bg-emerald-400/20 text-emerald-300 border-emerald-400/40',
                    PRO: 'bg-indigo-400/20 text-indigo-300 border-indigo-400/40',
                    FREE: 'bg-slate-800 text-slate-400 border-slate-700',
                  };

                  const statusColors: Record<string, string> = {
                    ACTIVE: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
                    SUSPENDED: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
                    DELETED: 'bg-slate-800 text-slate-500 border-slate-700',
                  };

                  return (
                    <tr key={u.id} className="hover:bg-slate-900/40 transition">
                      {/* Identity */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-xs text-slate-300 shrink-0">
                            {u.displayName?.slice(0, 2).toUpperCase() || u.email.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-200 truncate flex items-center gap-1.5">
                              <span>{u.displayName || 'Builder'}</span>
                              {u.hasActiveSubscription && (
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="Active Subscription" />
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono truncate">{u.email}</div>
                            <div className="text-[10px] text-slate-500 font-mono">{u.id}</div>
                          </div>
                        </div>
                      </td>

                      {/* Role */}
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                            roleColors[u.role] || roleColors.USER
                          }`}
                        >
                          <Shield className="w-3 h-3" />
                          <span>{u.role}</span>
                        </span>
                      </td>

                      {/* Tier */}
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                            tierColors[u.tier] || tierColors.FREE
                          }`}
                        >
                          <CreditCard className="w-3 h-3" />
                          <span>{u.tier}</span>
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                            statusColors[u.status] || statusColors.ACTIVE
                          }`}
                        >
                          {u.status === 'ACTIVE' && <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                          {u.status === 'SUSPENDED' && <AlertCircle className="w-3 h-3 text-rose-400" />}
                          {u.status === 'DELETED' && <UserX className="w-3 h-3 text-slate-500" />}
                          <span>{u.status}</span>
                        </span>
                      </td>

                      {/* Linked Resources */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3 text-slate-400 font-mono text-[11px]">
                          <span title="项目数" className="flex items-center gap-1">
                            <FolderKanban className="w-3.5 h-3.5 text-indigo-400" />
                            <span>{u.projectsCount}</span>
                          </span>
                          <span title="告警规则数" className="flex items-center gap-1">
                            <Bell className="w-3.5 h-3.5 text-amber-400" />
                            <span>{u.alertsCount}</span>
                          </span>
                          <span title="活跃 API Key" className="flex items-center gap-1">
                            <Key className="w-3.5 h-3.5 text-emerald-400" />
                            <span>{u.apiKeysCount}</span>
                          </span>
                        </div>
                      </td>

                      {/* Created At */}
                      <td className="py-3.5 px-4 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                        {u.createdAt.slice(0, 16)}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              setEditRoleUser(u);
                              setSelectedRole(u.role);
                            }}
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold border border-slate-700 transition"
                            title="修改角色权限"
                          >
                            设角色
                          </button>

                          <button
                            onClick={() => {
                              setEditTierUser(u);
                              setSelectedTier(u.tier);
                            }}
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold border border-slate-700 transition"
                            title="调整会员套餐"
                          >
                            调套餐
                          </button>

                          {u.status === 'ACTIVE' ? (
                            <button
                              onClick={() => handleUpdate(u.id, { status: 'SUSPENDED' })}
                              className="px-2 py-1 rounded bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/40 text-[11px] font-semibold transition"
                              title="冻结账号并登出所有会话"
                            >
                              冻结
                            </button>
                          ) : (
                            <button
                              onClick={() => handleUpdate(u.id, { status: 'ACTIVE' })}
                              className="px-2 py-1 rounded bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-800/40 text-[11px] font-semibold transition"
                              title="解冻并恢复正常访问"
                            >
                              解冻
                            </button>
                          )}

                          <button
                            onClick={() => {
                              setResetPwdUser(u);
                              setCustomPassword('');
                              setTemporaryPasswordResult(null);
                            }}
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white text-[11px] font-semibold border border-slate-700 transition"
                            title="重置登录密码"
                          >
                            重置密码
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Create User */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-purple-400" />
                <h3 className="font-bold text-white text-base">管理员新建用户</h3>
              </div>
              <button onClick={() => setIsCreateOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {temporaryPasswordResult ? (
              <div className="space-y-4 py-2">
                <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-200 text-xs space-y-2">
                  <div className="font-bold flex items-center gap-1.5 text-emerald-300">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>用户创建成功，初始密码如下：</span>
                  </div>
                  <p className="text-[11px] text-emerald-400/80">
                    请将密码安全送达该用户，关闭弹窗后无法再次查看明文。
                  </p>
                  <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-lg border border-emerald-500/30 font-mono text-sm text-white">
                    <span>{temporaryPasswordResult}</span>
                    <button
                      onClick={() => copyToClipboard(temporaryPasswordResult)}
                      className="px-2 py-1 rounded bg-emerald-600/30 text-emerald-300 hover:bg-emerald-600/50 flex items-center gap-1 text-xs"
                    >
                      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? '已复制' : '复制'}</span>
                    </button>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      setIsCreateOpen(false);
                      setTemporaryPasswordResult(null);
                    }}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-bold"
                  >
                    完成
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateUser} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    邮箱地址 <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="user@example.com"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">用户显示昵称</label>
                  <input
                    type="text"
                    value={newDisplayName}
                    onChange={(e) => setNewDisplayName(e.target.value)}
                    placeholder="例如: Alex Builder"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">角色权限</label>
                    <select
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value as any)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                    >
                      <option value="USER">USER (普通用户)</option>
                      <option value="ANALYST">ANALYST (分析师)</option>
                      <option value="ADMIN">ADMIN (管理员)</option>
                      <option value="SUPPORT">SUPPORT (支持)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">套餐等级</label>
                    <select
                      value={newTier}
                      onChange={(e) => setNewTier(e.target.value as any)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                    >
                      <option value="FREE">FREE (免费版)</option>
                      <option value="PRO">PRO (专业版)</option>
                      <option value="TEAM">TEAM (团队版)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    指定初始密码 <span className="text-slate-500 font-normal">(留空则自动生成随机高强度密码)</span>
                  </label>
                  <input
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="至少 8 位，留空自动生成"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-purple-500 font-mono"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsCreateOpen(false)}
                    className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={createSubmitting}
                    className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold disabled:opacity-50"
                  >
                    {createSubmitting ? '创建中...' : '确认创建'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Modal: Edit Role */}
      {editRoleUser && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-white text-base">修改用户角色权限</h3>
              </div>
              <button onClick={() => setEditRoleUser(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-300">
              目标账户: <span className="font-bold text-white">{editRoleUser.email}</span>
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
                  className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition ${
                    selectedRole === r.value
                      ? 'bg-purple-950/40 border-purple-500/60 text-white'
                      : 'bg-slate-950/40 border-slate-800 text-slate-300 hover:bg-slate-800/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="roleOption"
                    value={r.value}
                    checked={selectedRole === r.value}
                    onChange={() => setSelectedRole(r.value as any)}
                    className="mt-0.5 text-purple-600 focus:ring-0"
                  />
                  <div>
                    <div className="font-bold text-xs">{r.label}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{r.desc}</div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setEditRoleUser(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold"
              >
                取消
              </button>
              <button
                type="button"
                onClick={async () => {
                  const ok = await handleUpdate(editRoleUser.id, { role: selectedRole });
                  if (ok) setEditRoleUser(null);
                }}
                className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold"
              >
                保存变更
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Edit Tier */}
      {editTierUser && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-indigo-400" />
                <h3 className="font-bold text-white text-base">调整会员等级</h3>
              </div>
              <button onClick={() => setEditTierUser(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-300">
              目标账户: <span className="font-bold text-white">{editTierUser.email}</span>
            </div>

            <div className="space-y-2">
              {[
                { value: 'FREE', label: 'FREE (免费版)', desc: '查看基础雷达、1个追踪项目' },
                { value: 'PRO', label: 'PRO (专业版)', desc: '解锁高置信深度报告、5个项目、无限实时扫描' },
                { value: 'TEAM', label: 'TEAM (团队版)', desc: '团队协同席位、无限项目、优先支持与数据导出' },
              ].map((t) => (
                <label
                  key={t.value}
                  className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition ${
                    selectedTier === t.value
                      ? 'bg-indigo-950/40 border-indigo-500/60 text-white'
                      : 'bg-slate-950/40 border-slate-800 text-slate-300 hover:bg-slate-800/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="tierOption"
                    value={t.value}
                    checked={selectedTier === t.value}
                    onChange={() => setSelectedTier(t.value as any)}
                    className="mt-0.5 text-indigo-600 focus:ring-0"
                  />
                  <div>
                    <div className="font-bold text-xs">{t.label}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{t.desc}</div>
                  </div>
                </label>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setEditTierUser(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold"
              >
                取消
              </button>
              <button
                type="button"
                onClick={async () => {
                  const ok = await handleUpdate(editTierUser.id, { tier: selectedTier });
                  if (ok) setEditTierUser(null);
                }}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold"
              >
                保存变更
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Reset Password */}
      {resetPwdUser && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Lock className="w-5 h-5 text-rose-400" />
                <h3 className="font-bold text-white text-base">重置用户密码</h3>
              </div>
              <button onClick={() => setResetPwdUser(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-300">
              目标账户: <span className="font-bold text-white">{resetPwdUser.email}</span>
            </div>

            {temporaryPasswordResult ? (
              <div className="space-y-4">
                <div className="p-3 bg-emerald-950/40 border border-emerald-500/30 rounded-xl space-y-2">
                  <div className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>新密码设置成功:</span>
                  </div>
                  <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-lg border border-emerald-500/30 font-mono text-sm text-white">
                    <span>{temporaryPasswordResult}</span>
                    <button
                      onClick={() => copyToClipboard(temporaryPasswordResult)}
                      className="px-2 py-1 rounded bg-emerald-600/30 text-emerald-300 hover:bg-emerald-600/50 flex items-center gap-1 text-xs"
                    >
                      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? '已复制' : '复制'}</span>
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    该用户的现有登录会话已被强制注销，需使用新密码重新登录。
                  </p>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      setResetPwdUser(null);
                      setTemporaryPasswordResult(null);
                    }}
                    className="px-4 py-1.5 bg-slate-800 text-white rounded-lg text-xs font-semibold"
                  >
                    关闭
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[11px] text-slate-400">
                  重置后，该用户的所有已登录设备均会强制下线。请输入指定的新密码或留空由系统自动生成随机密码。
                </p>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    指定新密码 (可选，至少 8 位)
                  </label>
                  <input
                    type="text"
                    value={customPassword}
                    onChange={(e) => setCustomPassword(e.target.value)}
                    placeholder="留空则自动生成高强度临时密码"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 font-mono focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setResetPwdUser(null)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs font-semibold"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleResetPassword}
                    className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold"
                  >
                    确认重置
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
