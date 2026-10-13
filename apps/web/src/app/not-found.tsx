import Link from 'next/link';
import { PageFrame, PageHeader } from '@/components/ui/PageFrame';

export default function NotFound() {
  return (
    <div>
      <PageFrame width="prose">
        <PageHeader eyebrow="404" title="Page not found" lede="The page you requested is unavailable." />
        <Link href="/" className="mt-8 inline-block text-accent underline">Back to home</Link>
      </PageFrame>
    </div>
  );
}
