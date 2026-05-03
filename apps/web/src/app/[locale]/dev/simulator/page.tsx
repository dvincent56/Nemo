// apps/web/src/app/dev/simulator/page.tsx
import { notFound } from 'next/navigation';
import { DevSimulatorClient } from './DevSimulatorClient';

export default function DevSimulatorPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <DevSimulatorClient />;
}
