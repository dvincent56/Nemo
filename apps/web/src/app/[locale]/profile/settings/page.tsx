import { SiteShell } from '@/components/ui/SiteShell';
import SettingsView from './SettingsView';

export default function SettingsPage(): React.ReactElement {
  return (
    <SiteShell>
      <SettingsView />
    </SiteShell>
  );
}
