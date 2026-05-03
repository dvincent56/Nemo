/**
 * Stubs API pour les 4 sections de paramètres. Ces fonctions miment la
 * latence d'un vrai appel réseau et ne font rien d'autre pour l'instant.
 *
 * Phase 4 : remplacer le corps de chaque fonction par un fetch vers les
 * endpoints correspondants (cf. `project_backend_schema_gaps`). Les
 * signatures publiques doivent rester stables pour que SettingsView
 * fonctionne tel quel.
 */

export interface IdentityPatch {
  pseudo: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** Code INSEE / identifiant département, ou 'ALL' pour pays sans dpt. */
  dpt: string;
  city: string;
  tagline: string;
}

export interface AccountPatch {
  /** Seul l'email est patchable en l'état. */
  email?: string;
  /** Couple actuel + nouveau ; vide si l'utilisateur ne change pas. */
  passwordOld?: string;
  passwordNew?: string;
}

export interface PreferencesPatch {
  speedUnit: 'kts' | 'kmh' | 'mph';
  distanceUnit: 'NM' | 'km' | 'mi';
  timeFormat: '24' | '12';
  language: 'fr' | 'en' | 'es' | 'de';
}

export interface NotificationsPatch {
  start: boolean;
  gate: boolean;
  podium: boolean;
  newRaces: boolean;
  weekly: boolean;
}

/** Latence réseau simulée en dev pour que le flash "Enregistré" soit
 *  perceptible. À retirer quand les vrais appels remplaceront les stubs. */
async function simulateLatency(): Promise<void> {
  await new Promise((r) => setTimeout(r, 400));
}

/** PATCH /api/v1/me/profile — identité publique (pseudo + géo + tagline). */
export async function updateIdentity(_patch: IdentityPatch): Promise<void> {
  await simulateLatency();
}

/** PATCH /api/v1/me/account — email + couple mot de passe. */
export async function updateAccount(_patch: AccountPatch): Promise<void> {
  await simulateLatency();
}

/** PATCH /api/v1/me/preferences — unités, format d'heure, langue. */
export async function updatePreferences(_patch: PreferencesPatch): Promise<void> {
  await simulateLatency();
}

/** PATCH /api/v1/me/notifications — canaux email opt-in. */
export async function updateNotifications(_patch: NotificationsPatch): Promise<void> {
  await simulateLatency();
}
