'use client';

import { useState } from 'react';
import { CheckCircle2, ExternalLink, Link2, Unlink } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

type GscStatus = { connected: boolean; propertyUrl?: string; lastSyncedAt?: string };

export function ProjectLifecyclePanel({ projectId, initialStatus, initialProjectStatus, domain }: {
  projectId: string;
  initialStatus: GscStatus;
  initialProjectStatus: string;
  domain?: string | null;
}) {
  const { isZh } = useI18n();
  const [gsc, setGsc] = useState(initialStatus);
  const [projectStatus, setProjectStatus] = useState(initialProjectStatus);
  const [properties, setProperties] = useState<Array<{ siteUrl: string; permissionLevel: string }>>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadProperties() {
    setPending('properties'); setError(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/gsc/properties`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || (isZh ? '读取 GSC 属性失败。' : 'Could not read Search Console properties.'));
      setProperties(payload);
    } catch (err: any) { setError(err.message); } finally { setPending(null); }
  }

  async function selectProperty(propertyUrl: string) {
    setPending('select'); setError(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/gsc/properties`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyUrl }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || (isZh ? '选择 GSC 属性失败。' : 'Could not select this property.'));
      setGsc({ ...gsc, connected: true, propertyUrl }); setProperties([]);
    } catch (err: any) { setError(err.message); } finally { setPending(null); }
  }

  async function disconnect() {
    setPending('disconnect'); setError(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}`, { method: 'DELETE' });
      if (!response.ok) { const payload = await response.json(); throw new Error(payload.detail || 'Could not disconnect.'); }
      setGsc({ connected: false });
    } catch (err: any) { setError(err.message); } finally { setPending(null); }
  }

  async function updateStatus(status: 'IN_DEVELOPMENT' | 'LAUNCHED') {
    setPending('status'); setError(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, domain }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Could not update project status.');
      setProjectStatus(payload.status);
    } catch (err: any) { setError(err.message); } finally { setPending(null); }
  }

  return (
    <section className="mt-5 grid gap-4 md:grid-cols-2">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{isZh ? '上线状态' : 'Launch status'}</h2>
            <p className="mt-1 text-xs text-slate-500">{isZh ? '标记上线后才开始计算 T+7 / T+14 / T+30。' : 'T+7 / T+14 / T+30 starts after launch is recorded.'}</p>
          </div>
          <span className="text-xs font-semibold text-slate-700">{projectStatus}</span>
        </div>
        <button type="button" onClick={() => updateStatus(projectStatus === 'LAUNCHED' ? 'IN_DEVELOPMENT' : 'LAUNCHED')} disabled={pending === 'status'} className="mt-4 inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">
          <CheckCircle2 className="h-4 w-4" />
          {projectStatus === 'LAUNCHED' ? (isZh ? '恢复开发中' : 'Move back to development') : (isZh ? '标记已上线' : 'Mark as launched')}
        </button>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Google Search Console</h2>
            <p className="mt-1 text-xs text-slate-500">{gsc.propertyUrl ? `${isZh ? '已选择属性：' : 'Selected property: '}${gsc.propertyUrl}` : (isZh ? '连接后选择要同步的 property。' : 'Connect and select a property to sync search metrics.')}</p>
          </div>
          {gsc.connected ? <Link2 className="h-4 w-4 text-emerald-600" /> : <Unlink className="h-4 w-4 text-slate-400" />}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {!gsc.connected && <a href={`/api/v1/projects/${projectId}/gsc/connect`} className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"><ExternalLink className="h-4 w-4" />{isZh ? '连接 GSC' : 'Connect GSC'}</a>}
          {gsc.connected && !gsc.propertyUrl && <button type="button" onClick={loadProperties} disabled={pending === 'properties'} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">{isZh ? '选择属性' : 'Choose property'}</button>}
          {gsc.connected && <button type="button" onClick={disconnect} disabled={pending === 'disconnect'} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">{isZh ? '断开连接' : 'Disconnect'}</button>}
        </div>
        {properties.length > 0 && <div className="mt-3 space-y-2">{properties.map((property) => <button type="button" key={property.siteUrl} onClick={() => selectProperty(property.siteUrl)} className="block w-full rounded-md border border-slate-200 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600">{property.siteUrl} <span className="text-slate-400">({property.permissionLevel})</span></button>)}</div>}
      </div>
      {error && <p className="md:col-span-2 text-xs text-rose-700" role="alert">{error}</p>}
    </section>
  );
}
