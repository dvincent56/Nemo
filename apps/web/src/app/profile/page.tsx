import { SiteShell } from '@/components/ui';
import ProfileView from './ProfileView';

export default function ProfilePage(): React.ReactElement {
  return (
    <SiteShell>
      <ProfileView />
    </SiteShell>
  );
}
