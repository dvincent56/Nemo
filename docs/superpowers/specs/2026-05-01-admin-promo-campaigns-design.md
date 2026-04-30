# Campagnes promotionnelles admin — Design

**Date :** 2026-05-01
**Statut :** Spec validée, prêt pour plan d'implémentation

## Contexte et motivation

Pour stimuler l'acquisition autour d'événements (lancement d'une course, période creuse, communication marketing), Project Nemo a besoin d'un outil admin qui permet de distribuer des "cadeaux" sans intervention en base. Trois types de cadeaux couvrent les cas d'usage actuels :

1. **Crédits in-game** offerts aux joueurs payants (rétention)
2. **Upgrade de bateau** offert aux joueurs payants (rétention)
3. **Mois d'abonnement Carrière** offert aux nouveaux inscrits pendant la fenêtre de la promo (acquisition)

Bénéfices :
- Évite la manipulation directe de la base, qui est risquée et non auditée.
- Pose les fondations de la page super-admin Phase 5 (audit log, RBAC, première feature de gestion).
- Pose un système de notifications réutilisable, dont on aura besoin pour les invitations d'équipe (Phase 4 sociale) et les rappels de course.

## Périmètre

Cette feature livre :
- Les 3 types de campagnes ci-dessus avec leur UI admin et joueur.
- Un mécanisme léger de durée d'abonnement via `players.trial_until` — juste assez pour soutenir le cas 3 sans préjuger du modèle Stripe complet de Phase 4.
- Une table de notifications générique réutilisable.
- Une table d'audit générique pour les futures actions admin.
- Un flag RBAC `is_admin` minimal sur `players`.

Hors scope (voir section dédiée en fin de doc) : modèle Stripe complet, segmentation fine, ciblage par classe/pays, programmation différée, dashboards stats avancés, i18n des messages admin.

## Définitions

- **Campagne** : ensemble (type, audience, payload, expiration) défini par un admin, qui distribue un cadeau à un ou plusieurs joueurs éligibles.
- **Audience** : `SUBSCRIBERS` (tous les joueurs payants au moment du claim) ou `NEW_SIGNUPS` (tous les joueurs créés pendant la fenêtre d'activité de la campagne).
- **Claim** : action d'un joueur qui réclame un cadeau. Pour les cas 1 et 2, le claim est explicite (clic "Réclamer" en marina). Pour le cas 3, le claim est créé automatiquement par le serveur à l'inscription.
- **Trial** : période pendant laquelle un joueur `FREE` est traité comme un payant. Stockée dans `players.trial_until`.
- **Carrière virtuelle** : statut d'un joueur dont `tier = FREE` mais `trial_until > now()`. Du point de vue gameplay, indistinguable d'un payant.
- **Helper `isCareer(player)`** : `player.tier === 'CAREER' || (player.trial_until && player.trial_until > now())`. **Toute** vérification d'éligibilité tier dans l'application doit passer par ce helper.

## Modèle de données

### Nouvelles tables

#### `campaigns`

Une campagne par row. Modèle table unique avec colonnes typées (Option 1 retenue après comparaison avec un payload `jsonb` et avec des tables séparées par type).

```sql
campaigns(
  id                   uuid PK,
  type                 enum('CREDITS', 'UPGRADE', 'TRIAL') NOT NULL,
  credits_amount       integer NULL,           -- non-null ssi type='CREDITS'
  upgrade_catalog_id   varchar NULL FK → upgrade_catalog,  -- non-null ssi type='UPGRADE'
  trial_days           integer NULL,           -- non-null ssi type='TRIAL'
  audience             enum('SUBSCRIBERS', 'NEW_SIGNUPS') NOT NULL,
  expires_at           timestamptz NOT NULL,
  linked_race_id       uuid NULL FK → races,   -- messaging uniquement, pas un filtre
  message_title        varchar(100) NOT NULL,
  message_body         varchar(500) NOT NULL,
  created_by_admin_id  uuid NOT NULL FK → players,
  created_at           timestamptz NOT NULL DEFAULT now(),
  cancelled_at         timestamptz NULL,

  CONSTRAINT campaigns_payload_chk CHECK (
    (type = 'CREDITS' AND credits_amount IS NOT NULL AND upgrade_catalog_id IS NULL AND trial_days IS NULL) OR
    (type = 'UPGRADE' AND upgrade_catalog_id IS NOT NULL AND credits_amount IS NULL AND trial_days IS NULL) OR
    (type = 'TRIAL'   AND trial_days IS NOT NULL AND credits_amount IS NULL AND upgrade_catalog_id IS NULL)
  ),
  CONSTRAINT campaigns_audience_chk CHECK (
    (type = 'TRIAL' AND audience = 'NEW_SIGNUPS') OR
    (type IN ('CREDITS', 'UPGRADE') AND audience = 'SUBSCRIBERS')
  )
)
```

Les deux contraintes CHECK enforcent l'intégrité au niveau DB :
- Le payload de la campagne doit correspondre à son type.
- TRIAL ⇔ NEW_SIGNUPS et CREDITS/UPGRADE ⇔ SUBSCRIBERS (les autres combinaisons n'ont pas de sens métier).

#### `campaign_claims`

Un claim par paire (campaign, player). La contrainte UNIQUE garantit l'unicité au niveau DB et porte l'idempotence.

```sql
campaign_claims(
  id            uuid PK,
  campaign_id   uuid NOT NULL FK → campaigns,
  player_id     uuid NOT NULL FK → players,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, player_id)
)
```

Index `(player_id)` pour la query "campagnes déjà réclamées par X" (utilisée par `/campaigns/eligible`).

#### `notifications`

Table générique réutilisable pour toutes les notifs in-app à venir (cadeaux, invitations d'équipe, demandes d'amis, rappels de course).

```sql
notifications(
  id          uuid PK,
  player_id   uuid NOT NULL FK → players,
  type        enum('GIFT_AVAILABLE', 'TRIAL_GRANTED', 'TEAM_INVITE',
                  'FRIEND_REQUEST', 'RACE_REMINDER') NOT NULL,
  payload     jsonb NOT NULL,        -- ce qu'il faut pour rendre la notif
  read_at     timestamptz NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
)
```

Index `(player_id, read_at, created_at DESC)` pour servir efficacement le badge non-lues et la liste paginée.

`payload` selon le type :
- `GIFT_AVAILABLE` : `{ campaign_id, message_title, message_body }`
- `TRIAL_GRANTED` : `{ campaign_id, trial_days, expires_at }`
- Autres types : payloads définis par les features qui les introduiront (hors scope).

#### `admin_actions`

Audit log générique append-only, réutilisable pour toute action admin future (kill-switches, bandeaux d'incident, etc.).

```sql
admin_actions(
  id           uuid PK,
  admin_id     uuid NOT NULL FK → players,
  action_type  varchar NOT NULL,     -- 'CAMPAIGN_CREATED', 'CAMPAIGN_CANCELLED', …
  target_type  varchar NULL,
  target_id    varchar NULL,
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
)
```

Aucun endpoint UPDATE/DELETE sur cette table. Une annulation est une nouvelle entrée (`action_type = 'CAMPAIGN_CANCELLED'`), pas une modification.

### Modifications à `players`

```sql
ALTER TABLE players
  ADD COLUMN trial_until timestamptz NULL,
  ADD COLUMN is_admin    boolean NOT NULL DEFAULT FALSE;
```

- `trial_until` : quand non-null et `> now()`, le joueur est traité comme `CAREER` virtuel (voir helper `isCareer`).
- `is_admin` : flag minimal RBAC. **Non modifiable par API** — seules une migration ou une requête manuelle peuvent le passer à `TRUE`. Pas d'endpoint d'élévation de privilèges.

## Sécurité

Tous les contrôles ci-dessous sont serveur. L'UI peut cacher des éléments mais c'est le serveur qui décide.

### Authentification & RBAC

- Tous les endpoints `/api/v1/admin/*` derrière un middleware `requireAdmin` qui exige `req.player.is_admin === true`, **lu depuis la DB** à chaque requête (pas depuis le JWT).
- Le JWT contient uniquement `cognitoSub` / `playerId` — jamais le tier ni le statut admin (un token volé ne donne pas de droits étendus).
- `is_admin` non modifiable par API : pas d'endpoint d'élévation de privilèges. Promotion via migration ou requête DB manuelle uniquement.

### Atomicité & idempotence des claims

- Contrainte `UNIQUE (campaign_id, player_id)` sur `campaign_claims` → un claim ne peut **pas** être enregistré deux fois (garantie DB, pas applicative).
- L'endpoint claim s'exécute en **transaction Drizzle** : insert claim + side effect (credits/upgrade) dans la même transaction. Rollback intégral si l'un des deux échoue.
- Idempotence côté handler : si la requête arrive deux fois (réseau pourri, double-clic), la 2e détecte le claim existant et retourne le même résultat (HTTP 200), pas une erreur 5xx.

### Server-side trust (anti-spoofing)

- `player_id` lu de la session, **jamais** du body de la requête.
- `tier` et `trial_until` lus depuis la DB à chaque check, jamais d'un cache client.
- Toute vérification d'éligibilité (audience, expiration, cancellation) refaite côté serveur **au moment du claim**.

### Monotonicité du trial (anti-prolongation)

- `trial_until` ne peut **que** s'allonger :
  ```sql
  UPDATE players
  SET trial_until = greatest(coalesce(trial_until, now()), now() + trial_days * interval '1 day')
  WHERE id = $player_id
  ```
- Si un attaquant arrive d'une manière ou d'une autre à retrigger le grant signup pour son compte, le trial ne se prolonge pas s'il est déjà actif.
- Un joueur ne peut claim qu'une trial campaign : la contrainte UNIQUE bloque.
- La création de comptes multiples pour cumuler des trials reste un problème de l'enrôlement Cognito (vérification email obligatoire) — hors scope de cette feature.

### Anti-flood

- Rate limit sur `/api/v1/campaigns/:id/claim` : 5 req/min par player (largement suffisant pour un humain).
- Rate limit sur les endpoints admin : 30 req/min par admin.

### Validation des entrées admin

- Payload de création campagne validé par Zod : `type ∈ enum`, `audience ∈ enum`, montants `> 0`, `expires_at > now()`, longueurs de message bornées (titre 100, body 500).
- Cohérence `(type, payload, audience)` validée par Zod côté API **et** par les CHECK constraints côté DB (défense en profondeur).
- `message_title` et `message_body` rendus en **texte pur** côté UI (pas de `dangerouslySetInnerHTML`, pas de markdown rendu en HTML brut). XSS impossible même si l'admin colle du JS dans un titre.

### Audit append-only

- Pas d'endpoint UPDATE/DELETE sur `admin_actions`.
- L'annulation d'une campagne est une **nouvelle entrée** (`action_type = 'CAMPAIGN_CANCELLED'`), pas une modification.
- L'historique reste consultable et reconstructible.

## API backend

Localisation : `apps/game-engine/src/api/`, à côté de `marina.ts`.

```
campaigns.admin.ts        — endpoints admin
campaigns.player.ts       — endpoints joueur (eligible + claim)
notifications.ts          — endpoints joueur (list, unread-count, read)
services/isCareer.ts      — helper central tier check
services/audit.ts         — helper logAdminAction()
middleware/requireAdmin.ts — middleware RBAC
```

### Endpoints admin

Préfixe `/api/v1/admin/`, middleware `requireAdmin`.

| Méthode | Chemin | Description |
|---|---|---|
| POST | `/campaigns` | Créer une campagne (Zod validé) |
| GET | `/campaigns` | Lister, filtres `status=active|expired|cancelled|all` |
| GET | `/campaigns/:id` | Détail + stats (nombre de claims, taille audience estimée) |
| POST | `/campaigns/:id/cancel` | Annuler (set `cancelled_at`, ≠ delete) |
| GET | `/audit-log` | Liste paginée des `admin_actions`, filtres `admin_id` / `action_type` |

### Endpoints joueur

| Méthode | Chemin | Description |
|---|---|---|
| GET | `/campaigns/eligible` | Campagnes claimables par le joueur (filtre live audience + expiration) |
| POST | `/campaigns/:id/claim` | Réclamer une campagne |
| GET | `/notifications` | Liste paginée (non-lues d'abord) |
| GET | `/notifications/unread-count` | Compteur pour le badge marina (cheap query) |
| POST | `/notifications/:id/read` | Marquer une notif lue |

### Modification de l'endpoint signup existant (déclencheur cas 3)

Le grant s'exécute **après commit** de la transaction de signup, dans une **transaction séparée**. C'est délibéré : un échec d'octroi de cadeau ne doit jamais faire échouer une inscription. Mieux vaut un signup réussi sans cadeau qu'un signup raté pour cause de cadeau.

```
[Transaction signup] → COMMIT
[Nouvelle transaction grant trial] :
  1. SELECT * FROM campaigns
     WHERE type='TRIAL' AND audience='NEW_SIGNUPS'
       AND cancelled_at IS NULL AND expires_at > now()
  2. Pour chaque campagne (en pratique 0 ou 1) :
       - INSERT campaign_claims(campaign_id, new_player_id)
       - UPDATE players SET trial_until = greatest(now() + trial_days * interval '1 day',
                                                    coalesce(trial_until, now()))
       - INSERT notifications(type='TRIAL_GRANTED', payload={campaign_id, trial_days, expires_at})
  3. COMMIT (ou ROLLBACK silencieux + log si erreur)
[Réponse signup envoyée au client normalement]
```

Si la transaction grant échoue, log l'erreur (avec contexte : `player_id`, campaigns ciblées) mais **ne propage pas l'exception** vers l'endpoint signup. Le joueur est inscrit sans cadeau ; l'admin pourra créer une campagne ciblée plus tard si besoin de rattrapage manuel.

### Flow critique : claim (cas 1 et 2)

```
1. Read campaign by id
2. Validate côté serveur (à refaire systématiquement, indépendamment de l'UI) :
     - cancelled_at IS NULL                           → sinon 409 Gone
     - expires_at > now()                             → sinon 409 Gone
     - audience match :
         SUBSCRIBERS → isCareer(player) === true      → sinon 403 Forbidden
         NEW_SIGNUPS → ne devrait jamais arriver via claim → 400 Bad Request
3. Transaction Drizzle :
     - INSERT campaign_claims(campaign_id, player_id)  -- UNIQUE = idempotence
     - Side effect selon type :
         CREDITS → UPDATE players SET credits = credits + N WHERE id = player_id
         UPGRADE → INSERT player_upgrades(player_id, upgrade_catalog_id, source='GIFT')
     - UPDATE notifications SET read_at = now()
       WHERE player_id = X AND type = 'GIFT_AVAILABLE'
         AND payload->>'campaign_id' = Y::text
4. Sur conflit UNIQUE (claim déjà présent) → renvoyer 200 avec le claim existant (idempotent), pas 409
```

### Distribution des notifs cas 1 et 2

À la création d'une campagne SUBSCRIBERS, le serveur push une notif `GIFT_AVAILABLE` à **tous les payants actuels** (snapshot, en batch insert dans la même transaction que la création de campagne). Pour les abonnés qui rejoignent **après** la création de la campagne, la marina résoudra leur éligibilité via `GET /campaigns/eligible` au prochain refresh — ils verront la `<ClaimCard>` sans avoir reçu de notif spécifique.

Pourquoi ce mix snapshot+live :
- Le snapshot évite des queries d'éligibilité à chaque page load pour la majorité des joueurs.
- `/eligible` couvre proprement le cas du nouvel abonné post-création.

## UI admin

Route : `/[locale]/admin/campaigns` (sous le routing next-intl existant `app/[locale]/*`). Layout admin minimal (header avec lien vers `/[locale]/admin/audit-log`, sidebar éventuelle pour les futures sections de la page super-admin).

### Page liste

```
┌─ /admin/campaigns ─────────────────────────────────────┐
│ [+ Nouvelle campagne]                                  │
│                                                        │
│ Filtres : (●)Active  ( )Expirée  ( )Annulée            │
│ ┌────────────────────────────────────────────────────┐ │
│ │ Type    Audience       Expire    Claims    Action │ │
│ │ CREDITS Subscribers    03/05     47/120    [Annul]│ │
│ │ UPGRADE Subscribers    02/05     12/120    [Annul]│ │
│ │ TRIAL   New signups    05/05     3 nouv.   [Annul]│ │
│ └────────────────────────────────────────────────────┘ │
│ [Voir l'audit log →]                                   │
└────────────────────────────────────────────────────────┘
```

Stats par ligne :
- `claims/audience` pour SUBSCRIBERS : combien de payants ont claim sur le total éligible au moment du chargement.
- `N nouv.` pour NEW_SIGNUPS : combien de nouveaux inscrits ont reçu la promo.

### Formulaire création (modal ou page dédiée)

- **Type** : select (CREDITS | UPGRADE | TRIAL)
- **Champs conditionnels** selon le type :
  - CREDITS → input number "Montant de crédits"
  - UPGRADE → dropdown du catalogue d'upgrades existant (label + slot + classe compatible)
  - TRIAL → input number "Jours d'essai" (défaut 30)
- **Audience** : select (Subscribers | Nouveaux inscrits) — **disabled et auto-renseigné** selon le type (TRIAL → NEW_SIGNUPS, autres → SUBSCRIBERS) pour respecter la contrainte CHECK.
- **Expire le** : datetime picker (défaut J+7).
- **Course liée** : dropdown optionnel des courses à venir (pour insertion dans le messaging).
- **Titre** (100 char max) et **Message** (500 char max), avec **preview live** de la `<ClaimCard>` joueur dans le formulaire pour validation visuelle avant création.

### Page audit log

`/admin/audit-log` : table paginée des `admin_actions`, filtres par admin et par `action_type`. Affiche horodatage, admin, type d'action, target, payload (jsonb pretty-printed).

## UI joueur

Additions à la marina existante (`apps/web/src/app/marina/MarinaClient.tsx`).

```
┌─ Marina ─────────────────────────────────────────────────┐
│  Mes bateaux             Crédits 12,450    [Notif (3)]   │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Tu as un cadeau                                    │  │
│  │ "500 crédits offerts pour la Vendée Globe"         │  │
│  │                                       [Réclamer]   │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  [bateaux existants …]                                   │
└──────────────────────────────────────────────────────────┘
```

### Composants nouveaux

- **`<NotifBadge>`** : pastille avec compteur `unread-count` dans le header marina. Ouvre le `<NotifPanel>` au clic.
- **`<NotifPanel>`** : dropdown listant les notifications récentes du joueur. Rendu différencié selon `notification.type` : un switch sur le type sélectionne le composant de rendu adapté (pour l'instant `<GiftAvailableNotif>` et `<TrialGrantedNotif>` ; les autres types seront ajoutés par leurs features respectives).
- **`<ClaimCard>`** : carte cadeau au-dessus de la liste de bateaux. Une carte par campagne éligible, max 2-3 visibles directement, le reste accessible via le `<NotifPanel>`. Boutons : `[Réclamer]` qui appelle `POST /campaigns/:id/claim` avec optimistic update (la carte disparaît immédiatement avec animation, rollback si erreur serveur).

### Comportement cas 3 — welcome trial à l'inscription

À la **première** visite marina post-inscription, le `<NotifPanel>` s'ouvre **automatiquement** avec la notif `TRIAL_GRANTED` mise en avant. Détection : la notif TRIAL_GRANTED est `read_at IS NULL` ET le joueur a un `trial_until` actif. Une fois la notif lue (ou explicitement fermée), le panel ne s'ouvre plus tout seul.

Objectif : aucun nouveau joueur ne rate son cadeau de bienvenue avant d'aller naviguer ailleurs dans l'app.

### Workflow design

Conformément au workflow "mockups first" du projet, les nouveaux écrans (page admin liste, formulaire de création, `<ClaimCard>`, `<NotifPanel>`) seront livrés en **HTML standalone** dans `mockups/` (palette Nautical Luxury — ivory/navy/gold, sans néon, sans glow, sans backdrop-blur excessif) pour validation visuelle avant intégration dans le code Next.js.

## Stratégie de tests

### Backend (Vitest + DB de test isolée, pattern existant)

**Unitaires sur `isCareer()`**
- `tier=CAREER` → true
- `tier=FREE`, `trial_until=null` → false
- `tier=FREE`, `trial_until` passé → false
- `tier=FREE`, `trial_until` futur → true
- `tier=CAREER`, `trial_until` passé → true (le trial est ignoré quand tier suffit)

**Intégration claim (cas 1 et 2)**
- Happy path CREDITS : éligible → claim → `players.credits` incrémenté + `campaign_claims` créé + notif `GIFT_AVAILABLE` marquée lue.
- Happy path UPGRADE : éligible → claim → `player_upgrades` créé avec `source='GIFT'`.
- Double claim séquentiel et concurrent : idempotent, un seul side effect, deux réponses 200 identiques.
- Claim sur campagne expirée → 409.
- Claim sur campagne annulée → 409.
- Claim par `tier=FREE` sans trial sur audience SUBSCRIBERS → 403.
- Claim par `tier=FREE` avec `trial_until` actif sur audience SUBSCRIBERS → 200 (trial = Carrière virtuelle).
- Claim avec `player_id` forgé dans le body → ignoré, le `player_id` de la session prime.

**Intégration trial à l'inscription (cas 3)**
- Signup avec campagne TRIAL active → `trial_until` set à `now + trial_days`, notif `TRIAL_GRANTED` créée, claim row insérée.
- Signup sans campagne active → comportement normal, pas de side effect.
- Deux signups successifs pendant que la campagne est active → chacun reçoit son trial, deux claim rows distinctes.
- Monotonicité : appel répété du grant pour le même player → `trial_until` ne raccourcit jamais.
- Échec du grant (ex. erreur DB) → l'inscription réussit quand même, l'erreur est loggée.

**Sécurité**
- Appel `/admin/*` par non-admin → 403.
- Tentative d'auto-promotion via API → impossible (aucun endpoint).
- Rate limit : 6 claims rapides du même player → la 6e bloquée avec 429.
- XSS : campagne créée avec `message_title = '<script>alert(1)</script>'` → rendu en texte pur côté UI, pas d'exécution.

### Frontend (Playwright + tests composants existants)

- Marina : `<NotifBadge>` affiche le bon compteur de notifs non-lues.
- Marina : `<ClaimCard>` visible pour campagne éligible, disparaît après claim avec optimistic update, réapparaît si erreur serveur.
- Marina nouveau joueur : `<NotifPanel>` s'ouvre automatiquement avec la notif `TRIAL_GRANTED`.
- Admin : formulaire de création avec validation conditionnelle (champs typés selon type sélectionné, audience auto-disabled).
- Admin : annulation d'une campagne la fait passer en "Annulée" sans casser les claims existants (vérifier que les données joueur restent intactes).

## Hors scope (explicite)

Ces sujets sont **délibérément exclus** de cette feature. Ils relèvent d'autres phases ou d'évolutions ultérieures.

- **Modèle d'abonnement Stripe complet** (`subscriptions` table, `current_period_end`, webhooks Stripe, renouvellement, gestion CB, factures) → **Phase 4**. Cette feature pose seulement `trial_until` comme mécanisme léger transitoire ; Phase 4 absorbera la gestion des trials dans le modèle Stripe.
- **Détection multi-comptes pour cumuler des trials** → relève de la qualité d'enrôlement Cognito (vérification email obligatoire, déjà en place).
- **Sécurité Stripe** (signature webhook, idempotency keys Stripe, etc.) → Phase 4.
- **Campagnes ciblées par segment fin** (par classe de bateau, pays, niveau, ELO, période d'inactivité) → V2 si besoin.
- **Tableau de bord stats poussé** sur les campagnes (taux de claim dans le temps, conversion trial → payant, A/B testing) → V2.
- **Programmation différée** d'une campagne (créer maintenant, activer dans 3 jours) → V2. Pour le MVP, créer = active immédiatement.
- **Édition d'une campagne après création** → V2. Pour le MVP, modification = annuler + recréer.
- **i18n des messages admin** → l'admin écrit le titre et le body en une seule langue (français). Auto-traduction = V2.
- **Page super-admin Phase 5 complète** (kill-switches, bandeaux d'incident, mode maintenance) → cette feature pose les fondations (RBAC, audit log) mais n'implémente que la sous-section "Campagnes".
- **Comportement post-expiration du trial** (que faire des upgrades installés, accès marina, ranking Série, etc., quand `trial_until` passe) → règle métier à définir avec la gestion complète du downgrade Carrière→Free en Phase 4. Pour le MVP, on suppose qu'un trial expiré se comporte exactement comme une fin d'abonnement Carrière classique — comportement qui n'est lui-même pas encore implémenté et que Phase 4 traitera de bout en bout. À court terme, les premières campagnes TRIAL seront calées pour expirer dans une fenêtre où ce flou n'a pas d'impact (par exemple : trials longs, ou validation manuelle de la conversion avant expiration).

## Récapitulatif des décisions

| Décision | Choix retenu |
|---|---|
| Scope | C — 3 cas (crédits, upgrade, trial) avec mécanisme léger `trial_until` |
| Cas 3 (trial) | Durée fixe 30 jours, auto-grant à l'inscription |
| Éligibilité cas 1+2 | Vérifiée live au claim via helper `isCareer` |
| Expiration | Date paramétrée par l'admin, indépendante du départ de course |
| Système notifs | Table générique `notifications` réutilisable (équipes/amis à venir) |
| Audit log | Table générique `admin_actions` réutilisable pour Phase 5 |
| Modèle campagne | Table unique avec colonnes typées + CHECK constraints SQL |
| RBAC | Flag `is_admin` non promouvable par API |
| Sécurité | Atomicité Drizzle + UNIQUE DB + idempotence + server-side trust |
| Workflow UI | Mockups HTML standalone Nautical Luxury d'abord, intégration code après |
