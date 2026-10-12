'use client';

import { useState } from 'react';
import { CheckCircle2, ExternalLink, Link2, Unlink } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Badge } from '@/components/ui/Badge';
import { Button, buttonVariants } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';

type GscStatus = { connected: boolean; propertyUrl?: string; lastSyncedAt?: string };

export function ProjectLifecyclePanel({ projectId, initialStatus, initialProjectStatus, domain }: {
  projectId: string;
  initialStatus: GscStatus;
  initialProjectStatus: string;
  domain?: string | null;
}) {
  const { t } = useI18n();
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
      if (!response.ok) throw new Error(payload.detail || t('projects.errorReadProperties'));
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
      if (!response.ok) throw new Error(payload.detail || t('projects.errorSelectProperty'));
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
    <section className="mt-6 grid gap-4 md:grid-cols-2">
      <Panel className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-sm font-semibold text-fg">{t('projects.launchStatusTitle')}</h2>
            <p className="mt-1 text-xs leading-relaxed text-fg-subtle">{t('projects.launchStatusDesc')}</p>
          </div>
          <Badge tone={projectStatus === 'LAUNCHED' ? 'signal' : 'warn'} dot>
            {projectStatus}
          </Badge>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => updateStatus(projectStatus === 'LAUNCHED' ? 'IN_DEVELOPMENT' : 'LAUNCHED')}
          disabled={pending === 'status'}
          className="mt-4"
        >
          <CheckCircle2 className="h-4 w-4" />
          {projectStatus === 'LAUNCHED' ? t('projects.moveBackToDev') : t('projects.markAsLaunched')}
        </Button>
      </Panel>

      <Panel className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-sm font-semibold text-fg">Google Search Console</h2>
            <p className="mt-1 text-xs leading-relaxed text-fg-subtle">
              {gsc.propertyUrl ? t('projects.selectedProperty', { url: gsc.propertyUrl }) : t('projects.connectPrompt')}
            </p>
          </div>
          <span className="flex items-center gap-2">
            {gsc.connected ? <Link2 className="h-4 w-4 text-signal" /> : <Unlink className="h-4 w-4 text-fg-subtle" />}
            <Badge tone={gsc.connected ? 'signal' : 'neutral'}>
              {gsc.connected ? 'CONNECTED' : 'DISCONNECTED'}
            </Badge>
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {!gsc.connected && (
            <a href={`/api/v1/projects/${projectId}/gsc/connect`} className={buttonVariants({ size: 'sm' })}>
              <ExternalLink className="h-4 w-4" />
              {t('projects.connectGsc')}
            </a>
          )}
          {gsc.connected && !gsc.propertyUrl && (
            <Button type="button" variant="outline" size="sm" onClick={loadProperties} disabled={pending === 'properties'}>
              {t('projects.chooseProperty')}
            </Button>
          )}
          {gsc.connected && (
            <Button type="button" variant="outline" size="sm" onClick={disconnect} disabled={pending === 'disconnect'}>
              {t('projects.disconnect')}
            </Button>
          )}
        </div>
        {properties.length > 0 && (
          <div className="mt-3 space-y-2">
            {properties.map((property) => (
              <button
                key={property.siteUrl}
                type="button"
                onClick={() => selectProperty(property.siteUrl)}
                className="block w-full border border-line-control px-3 py-2 text-left text-xs text-fg-muted transition-colors hover:border-accent hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {property.siteUrl} <span className="text-fg-subtle">({property.permissionLevel})</span>
              </button>
            ))}
          </div>
        )}
      </Panel>
      {error && <p className="text-xs text-danger md:col-span-2" role="alert">{error}</p>}
    </section>
  );
}
