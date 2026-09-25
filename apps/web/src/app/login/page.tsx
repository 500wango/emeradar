'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { useAuth } from '@/lib/auth-context';
import {
  Sparkles,
  ShieldCheck,
  ArrowRight,
  Lock,
  Mail,
  AlertCircle,
  Loader2,
} from 'lucide-react';

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get('next') || '/feed';

  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeDemo, setActiveDemo] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError('Please enter your email address');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await login(email, password, false);
      router.push(nextUrl);
    } catch (err: any) {
      setError(err.message || 'Failed to sign in. Please verify your email and password.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async (demoEmail: string, demoLabel: string) => {
    try {
      setActiveDemo(demoLabel);
      setError(null);
      await login(demoEmail, undefined, true);
      router.push(nextUrl);
    } catch (err: any) {
      setError(err.message || 'Demo login failed');
      setActiveDemo(null);
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col justify-center py-12 sm:px-6 lg:px-8 bg-gradient-to-b from-slate-50 via-white to-slate-100">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <Link href="/" className="inline-block mb-6">
          <Logo variant="header" className="h-10 w-auto mx-auto" idPrefix="login" />
        </Link>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          Welcome back
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          Find markets before they get crowded. Sign in to your workspace.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-lg px-4 sm:px-0">
        <div className="bg-white py-8 px-6 sm:px-10 shadow-xl shadow-slate-200/50 rounded-2xl border border-slate-200/80">
          {error && (
            <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block">Authentication Failed</span>
                <span>{error}</span>
              </div>
            </div>
          )}

          {/* Quick 1-Click Demo Logins */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                1-Click Demo Access
              </span>
              <span className="text-xs text-slate-400">Instant test login</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => handleDemoLogin('pro@emeradar.com', 'Builder Pro')}
                disabled={loading || activeDemo !== null}
                className="p-3 text-left rounded-xl border border-emerald-200 bg-emerald-50/60 hover:bg-emerald-100/70 hover:border-emerald-300 transition-all flex flex-col justify-between group disabled:opacity-60"
              >
                <div>
                  <div className="flex items-center justify-between text-xs font-bold text-emerald-800">
                    <span>Sarah</span>
                    <span className="px-1.5 py-0.5 rounded bg-emerald-200/80 text-[10px] text-emerald-900">PRO</span>
                  </div>
                  <p className="text-[11px] text-emerald-600 mt-0.5">Builder Pro</p>
                </div>
                <div className="mt-3 flex items-center text-xs font-semibold text-emerald-700 group-hover:translate-x-0.5 transition-transform">
                  {activeDemo === 'Builder Pro' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>
                      Enter <ArrowRight className="w-3 h-3 ml-1" />
                    </>
                  )}
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleDemoLogin('admin@emeradar.com', 'Michael Admin')}
                disabled={loading || activeDemo !== null}
                className="p-3 text-left rounded-xl border border-blue-200 bg-blue-50/60 hover:bg-blue-100/70 hover:border-blue-300 transition-all flex flex-col justify-between group disabled:opacity-60"
              >
                <div>
                  <div className="flex items-center justify-between text-xs font-bold text-blue-800">
                    <span>Michael</span>
                    <span className="px-1.5 py-0.5 rounded bg-blue-200/80 text-[10px] text-blue-900">TEAM</span>
                  </div>
                  <p className="text-[11px] text-blue-600 mt-0.5">Admin & Scale</p>
                </div>
                <div className="mt-3 flex items-center text-xs font-semibold text-blue-700 group-hover:translate-x-0.5 transition-transform">
                  {activeDemo === 'Michael Admin' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>
                      Enter <ArrowRight className="w-3 h-3 ml-1" />
                    </>
                  )}
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleDemoLogin('free@emeradar.com', 'Alex Free')}
                disabled={loading || activeDemo !== null}
                className="p-3 text-left rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-all flex flex-col justify-between group disabled:opacity-60"
              >
                <div>
                  <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                    <span>Alex</span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-200 text-[10px] text-slate-700">FREE</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">Starter Tier</p>
                </div>
                <div className="mt-3 flex items-center text-xs font-semibold text-slate-700 group-hover:translate-x-0.5 transition-transform">
                  {activeDemo === 'Alex Free' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>
                      Enter <ArrowRight className="w-3 h-3 ml-1" />
                    </>
                  )}
                </div>
              </button>
            </div>
          </div>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-3 text-slate-400 font-medium tracking-wider">
                Or sign in with email
              </span>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Email Address
              </label>
              <div className="relative rounded-xl shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Mail className="h-4 w-4" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@emeradar.com"
                  required
                  className="block w-full pl-10 pr-3 py-2.5 bg-slate-50/50 border border-slate-300 rounded-xl text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white focus:border-transparent transition"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-slate-700">
                  Password
                </label>
                <span className="text-xs text-slate-400">
                  Default demo: any or empty
                </span>
              </div>
              <div className="relative rounded-xl shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="h-4 w-4" />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="block w-full pl-10 pr-3 py-2.5 bg-slate-50/50 border border-slate-300 rounded-xl text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white focus:border-transparent transition"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || activeDemo !== null}
              className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 shadow-sm shadow-blue-500/20 disabled:opacity-60 transition"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Signing in...</span>
                </>
              ) : (
                <>
                  <span>Sign In to Dashboard</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Footer inside card */}
          <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>New to EmeRadar?</span>
            <Link
              href="/register"
              className="font-semibold text-blue-600 hover:text-blue-700 hover:underline"
            >
              Create an account →
            </Link>
          </div>
        </div>

        {/* Security badge */}
        <div className="mt-6 text-center text-xs text-slate-400 flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          <span>Encrypted sessions · RFC 9457 error contracts · PBKDF2 salt</span>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
        </div>
      }
    >
      <LoginFormContent />
    </Suspense>
  );
}
