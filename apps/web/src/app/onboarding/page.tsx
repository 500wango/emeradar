import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthService } from '@emeradar/services';
import { OnboardingForm } from '@/components/OnboardingForm';

export default async function OnboardingPage() {
  const token = (await cookies()).get('emeradar_session')?.value;
  const session = token ? await AuthService.getSessionUser(token) : null;
  if (!session) redirect('/login?next=/onboarding');
  if (session.preferences.onboardingCompleted) redirect('/feed');
  return <OnboardingForm initialPreferences={session.preferences} />;
}
