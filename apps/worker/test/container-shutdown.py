"""Real 120s stop test. No production configuration, credentials, or jobs used."""
import json
import pathlib
import subprocess
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[3]
TAG = 'worker-stop-' + uuid.uuid4().hex[:8]
DB = 'emeradar_worker_test_shutdown'

def docker(*args, check=True):
    return subprocess.run(['docker', *args], text=True, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, check=check).stdout.strip()

def sql(statement):
    return docker('exec', TAG + '-db', 'psql', '-U', 'postgres', '-d', DB, '-Atc', statement)

def wait_for(check, seconds=40):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(.25)
    raise AssertionError('readiness deadline exceeded')

try:
    docker('network', 'create', '--internal', TAG)
    docker('run', '-d', '--name', TAG + '-db', '--network', TAG,
           '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=' + DB, 'postgres:16-alpine')
    wait_for(lambda: 'accepting connections' in docker('exec', TAG + '-db', 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', check=False))
    # Only the table used by queue receipts; never provision application data.
    sql("CREATE TABLE audit_log (id text primary key, actor_type text, action text, target_type text, target_id text, payload jsonb, occurred_at timestamptz default now())")
    mounts = []
    for name in ['apps', 'packages', 'node_modules', 'package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'tsconfig.json']:
        mounts += ['-v', f'{ROOT / name}:/app/{name}:ro']
    for mode in ['drain', 'timeout']:
        name = TAG + '-' + mode
        url = f'postgresql://postgres@{TAG}-db:5432/{DB}'
        docker('run', '-d', '--name', name, '--network', TAG, '--stop-timeout', '150',
               '--entrypoint', 'node',
               '-e', 'DATABASE_URL=' + url, '-e', 'DATABASE_DIRECT_URL=' + url,
               '-e', 'SHUTDOWN_MODE=' + mode, *mounts, 'emeradar-worker:latest',
               '--import', '/app/apps/worker/node_modules/tsx/dist/loader.mjs',
               '/app/apps/worker/test/shutdown-fixture.ts', 'start')
        try:
            wait_for(lambda: '调度器已启动' in docker('logs', name))
        except AssertionError:
            print(docker('logs', name), flush=True)
            raise
        sql("INSERT INTO pgboss.job(name, data) VALUES ('test-container-shutdown', '{}')")
        wait_for(lambda: 'SYNTHETIC_STARTED' in docker('logs', name))
        started = time.monotonic()
        docker('stop', name)
        elapsed = time.monotonic() - started
        logs = docker('logs', name)
        state = json.loads(docker('inspect', name, '--format', '{{json .State}}'))
        job = sql("SELECT state || ':' || retry_count FROM pgboss.job WHERE name='test-container-shutdown' ORDER BY created_on DESC LIMIT 1")
        print(json.dumps({'mode': mode, 'elapsed_seconds': round(elapsed, 3), 'exit_code': state['ExitCode'], 'job': job, 'logs': logs}), flush=True)
        assert '收到 SIGTERM' in logs, 'real CLI never received SIGTERM'
        assert state['ExitCode'] == 0, 'container was killed or failed'
        if mode == 'drain':
            assert 'SYNTHETIC_FINISHED' in logs
            assert job.startswith('completed:')
        else:
            assert 119 <= elapsed < 145, f'drain deadline not respected: {elapsed}'
            assert 'SYNTHETIC_FINISHED' not in logs
            assert job.startswith('retry:'), f'unfinished work not retryable: {job}'
finally:
    for suffix in ['drain', 'timeout', 'db']:
        docker('rm', '-f', TAG + '-' + suffix, check=False)
    docker('network', 'rm', TAG, check=False)
