# Roadmap Nemo

> Source de vérité du plan de livraison. Tenir à jour au fil des commits. Cocher quand c'est vraiment en prod (tests verts + revue OK), pas quand c'est "en cours".

## État actuel (2026-04-28)

- ✅ Phase 1 — Tick loop, polaires, fixtures météo
- ✅ Phase 2 — Sails + zones + wear + segments + e2e 1 h
- 🟢 Phase 3 — **~75 %** (refonte design quasi finie ; reste polish `/play` + démock progressif + schémas DB)
- ⏳ Phase 4 — Pas commencée (i18n prioritaire, Stripe, marina DB, crédits, routeur final, NOAA final)
- ⏳ Phase 5 — Pas commencée (Admin = nouvelle phase dédiée)
- ⏳ Phase 6 — Pas commencée (social DB, push, AWS, charge)
- ⏳ Phase 7 — Pas commencée (calibration, V2, légal)

**Chemin critique vers le lancement** :
```
Phase 3 terminée (play + démock complet)
  → Phase 4 : i18n d'abord (sinon ingérable plus tard)
  → Phase 4 : Stripe (sans revenus, pas de business)
  → Phase 4 : Marina + upgrades (différenciateur vs VR)
  → Phase 5 : Admin (gestion ops avant exposition publique)
  → Phase 6 : Deploy AWS (premier vrai utilisateur possible)
  → Phase 7 : Calibration avec joueurs VR réels
```

---

## Phase 3 — En cours (refonte design + démock)

### Backend ✅
- [x] Broadcast réel game-engine → Redis → ws-gateway → client
- [x] Ordres RPC client → serveur (compas APPLIQUER + voile CONFIRMER)
- [x] Hydratation DB (races, boats, players depuis Postgres, seed-on-empty)
- [ ] Auth Cognito câblée — **non bloquant**, stub dev opérationnel, à brancher quand AWS sera dispo

### Frontend — Intégration design Direction B
Pages alignées sur les mockups validés (Nautical Luxury — ivory/navy/gold) :

- [x] `/` (redirection)
- [x] `/login` (manifesto 4 items + form)
- [x] `/races` (filtres classe, dates + heure, leader/vainqueur)
- [x] `/marina` (5 slots, 1 par classe, CTA débloquer)
- [x] `/marina/[boatId]` (6 catégories upgrades + comparatif variantes)
- [x] `/marina/[boatId]/customize` (4 zones × 3 modes + marquages)
- [x] `/ranking` (filtres Classe + Périmètre, rang local recalculé)
- [x] `/ranking/courses` (En cours + Terminées)
- [x] `/ranking/[raceId]` (podium + filtres périmètre)
- [x] `/profile` (stats, palmarès, flotte, activité)
- [x] `/profile/[username]` (profil public, classement par classe)
- [x] `/profile/settings` (identité, compte, préférences, notifications)
- [x] `/profile/social` (amis paginés, équipe, invitations fonctionnelles)
- [x] `/team/[slug]` (roster paginé, stats agrégées équipe)
- [x] `/play/[raceId]` — **refonte structurelle terminée** (HUD slim navy + rang gold, fond océan, slide-outs G/D, stack droite, widget Couches, timeline météo)

### `/play/[raceId]` — items restants identifiés
- [ ] **Refonte ergonomie `ProgPanel`** — composant trop complexe et partiellement mocké. Brainstorm dédié avec Claude design avant tout code
- [ ] **Affichage des bateaux adverses sur la carte** — sprites + tooltip survol
- [ ] **Clic bateau adverse** → panneau détail (skipper, classe, classement, stats course)
- [ ] **Clic nom dans `RankingPanel`** → focus carte + highlight bateau correspondant
- [ ] **Mode replay multi-sélection** — sélectionner plusieurs bateaux et rejouer leurs trajectoires (pas seulement le sien)

### Démock progressif (à terminer en Phase 3)
> Tracking précis de ce qui est encore mocké côté front et ce qui est déjà sur la vraie API.
> Audit feature-par-feature à mener une fois la liste sous contrôle.

**✅ Déjà branchés sur la vraie API**
- `/races` → `fetchRaces()` (Postgres)
- `/play/[raceId]` boat + zones → `fetchMyBoat()`, `fetchRaceZones()`
- `/marina` + `/marina/[boatId]` → `marina-api.ts` (CRUD bateaux + upgrades)
- WS deltas live → `connectRace()`

**❌ Encore mockés — à débrancher**

| Source mock | Pages consommatrices | Endpoint cible |
|---|---|---|
| `apps/web/src/app/ranking/data.ts` (PLAYERS, PLAYER_CLASS_STATS, RACES) | `/ranking`, `/ranking/courses`, `/ranking/[raceId]`, `/team/[slug]`, `/profile/social` | `GET /api/v1/rankings/season`, `/rankings/courses`, `/rankings/race/:id` |
| `apps/web/src/app/profile/data.ts` (ProfileStats, palmarès, flotte, activité) | `/profile`, `/profile/[username]` | `GET /api/v1/players/me`, `/api/v1/players/:username` |
| `apps/web/src/app/team/data.ts` (TeamSeed) | `/team/[slug]` | `GET /api/v1/teams/:slug` (+ membres) |
| `apps/web/src/app/profile/social/api.ts` (searchPlayers, friends, invitations) | `/profile/social` | `GET /api/v1/players/search`, friendships endpoints |
| `MOCK_RANKING` dans `RankingPanel.tsx` | `/play/[raceId]` (slide-out gauche) | `GET /api/v1/races/:id/ranking` |

**Schéma backend manquant — bloquant pour la démock**
- [ ] Table `profiles` (country, city, dpt, region, tagline, member_since)
- [ ] Tables `teams`, `team_members` (capitaine / modérateur / membre)
- [ ] Table `friendships`
- [ ] Table `invitations` (FRIEND | TEAM)
- [ ] Table `player_class_stats` (ranking par classe de bateau)
- [ ] Table `user_settings` (unités, langue, notifs)
- [ ] Colonnes `boats` cosmétiques : `deck_color`, `hull_number`, `sail_pattern`, `hull_pattern`, `custom_emblem_url`

**Audit features (à faire)**
- [ ] Pour chaque écran ✅ ci-dessus : vérifier que TOUS les flux (lecture + écriture + edge cases) passent par l'API réelle, pas un mock résiduel
- [ ] Documenter les écarts mock/API trouvés

### Design system (primitives réutilisables) ✅
- [x] `Button` (primary/secondary/danger/dangerSolid/ghost)
- [x] `Field` / `Card` / `Chip` / `Eyebrow`
- [x] `Pagination` (ellipsis > 7 pages, meta "X–Y / Z")
- [x] `SiteShell` / `SiteFooter` / `Topbar` / `Drawer` (burger mobile)

---

## Phase 4 — i18n + Stripe + Marina + Crédits (Semaines 13–16)

### i18n (priorité #1 — remontée parce que les FR hardcodés s'accumulent)
- [ ] Configuration `next-intl` + routing `app/[locale]/*`
- [ ] Fichiers `apps/web/messages/{fr,en,es,de}.json`
- [ ] Migration de **tous** les textes FR hardcodés vers `useTranslations()`
- [ ] Audit final : `grep` exhaustif pour s'assurer qu'aucun texte FR ne reste hors fichiers de traductions

### Refactoring architecture (critique avant Stripe)
- [ ] 1 Worker Thread par course (WorkerPool)
- [ ] Métriques tick duration dans Redis
- [ ] Variable `RACE_IDS_HANDLED` pour le scaling horizontal futur

### Stripe + abonnements
- [ ] Produits Stripe : Free (0 €) / Carrière (15 €/mois ou 120 €/an)
- [ ] Webhook Stripe → mise à jour `subscription_tier` dans players
- [ ] Gate features : routeur, marina, upgrades bloqués si `tier = FREE`
- [ ] Page `/subscribe` + flow checkout
- [ ] Annulation abonnement (user story SU-03 à SU-07)
- [ ] Tables `subscriptions`, `stripe_events`, `credit_transactions`

### Marina (fonctionnalités au-delà du CRUD déjà branché)
- [ ] Customisation persistée en DB (couleur, dégradé, image, numéro) — colonnes `boats` ajoutées en Phase 3
- [ ] Upgrades : achat avec crédits, effets appliqués dans Game Engine
- [ ] Réparation : timer + coût en crédits
- [ ] Revente : upgrades × 70 % + bonus palmarès

### Système de crédits
- [ ] Calcul récompenses après course :
      `distance × tarif classe × multiplicateur rang + sponsor + streak`
- [ ] Table `credit_transactions` (audit trail complet)
- [ ] Crédits **non achetables avec argent réel** (anti-P2W — vérification `reason != 'PURCHASE'`)
- [ ] Affichage crédits dans HUD + marina + profil

### Routeur isochrones — 🟢 majoritairement implémenté, à finaliser
- [x] Worker Node.js dédié (timeout 8 s) — fait
- [x] Algorithme isochrones (360 secteurs, élagage) — fait
- [x] Éditeur de route UI (clic droit, waypoints) — fait
- [x] Envoi des waypoints dans la file d'ordres — fait
- [ ] Cache Redis 10 min
- [ ] ETA waypoints par simulation avance rapide (validation)
- [ ] Gate Carrière (lié à Stripe)

### Programmateur d'ordres UI complet
- [ ] Refonte ergonomique `ProgPanel` (suite brainstorm Phase 3)
- [ ] Panneau VR-style (grille de slots)
- [ ] Éditeur de slot (CAP / TWA / WPT / VOILE)
- [ ] Time picker heures/minutes
- [ ] ETA calculé et affiché par slot WPT
- [ ] Tous les triggers câblés côté UI

### NOAA pipeline — 🟢 bien avancé, à finaliser
- [x] Pipeline NOAA opérationnelle (cf. `project_session_2026_04_18`)
- [x] SwellOverlay particules
- [x] Fixes GRIB / lat-lon
- [ ] Script Python `ingest.py` finalisé en prod
- [ ] Job toutes les 6 h automatisé
- [ ] Tests avec vraies données météo

---

## Phase 5 — Admin (NOUVELLE PHASE — Semaines 17–18)

> Toutes les pages d'administration regroupées ici. Mockups `admin-races-v1.html` et `admin-races-edit-v1.html` validés.

### `/admin/races` — liste admin
- [ ] 5 statuts (DRAFT / PUBLISHED / BRIEFING / LIVE / FINISHED / ARCHIVED)
- [ ] Filtres + recherche
- [ ] Actions : publier, archiver, dupliquer

### `/admin/races/[id]` — éditeur studio 3 colonnes
- [ ] Carte MapLibre + outils dessin
- [ ] Portes (GATE / MARK / FINISH) avec config tribord/bâbord
- [ ] Zones d'exclusion (WARN ×0,8 / PENALTY ×0,5 / HARD_BLOCK)
- [ ] Paramètres course (classe, dates, récompenses)
- [ ] Publication / dépublication

### KPI dashboard
- [ ] Joueurs actifs, courses en cours, revenus Stripe
- [ ] Métriques tick duration, latence broadcast

### Modération + sanctions
- [ ] Gestion joueurs : suspension, ban, remboursement crédits (`player_sanctions`)
- [ ] File de signalements
- [ ] Table `audit_log` pour traçabilité actions admin

### Page super-admin `/admin/system`
Gardée par middleware `role === 'super_admin'`, regroupe les manettes ops :

- [ ] Toggle **mode maintenance** global : flag DB → middleware web qui répond 503 (sauf `/admin/*`) avec page maintenance dédiée. Toggle instantané, pas de redeploy nécessaire.
- [ ] Éditeur **bandeaux d'incident** (CRUD sur `system_status`) : sévérité, message multilingue, fenêtre de validité, preview du rendu avant publication.
- [ ] Vue temps réel de l'état des services (lus depuis les `/health`) : game-engine, ws-gateway, weather-engine, Postgres, Redis. Voyants vert/orange/rouge.
- [ ] Bouton **kill-switch** par feature flag : désactiver Stripe (lecture seule abonnements), désactiver les inscriptions, désactiver le routeur, etc. Tous les flags loggés dans `audit_log`.
- [ ] Toutes les actions super-admin tracées dans `audit_log` (qui, quand, quel toggle, valeur avant/après).
- [ ] Table `system_status` (id, severity: INFO/WARN/CRITICAL, message_fr/en/es/de, active_from, active_until) éditée depuis l'admin
- [ ] Composant `<SystemStatusBanner />` lu en SSR layout, masqué si pas d'incident actif — sévérité contrôle la couleur (gold WARN / red CRITICAL)
- [ ] Dégradés granulaires auto-poussés dans le bandeau via `WeatherStatus` (delayed → "Météo retardée, dernière mise à jour il y a Xh") et état du tick loop (game-engine downtime > 30 s → "Course en pause technique")
- [ ] Maintenance planifiée : flag dans `system_status` + désactivation des inscriptions/lancements de course pendant la fenêtre

### Observabilité
- [ ] **Sentry** SDK serveur (game-engine, weather-engine, ws-gateway) — capture exceptions + traces
- [ ] **Sentry** SDK browser dans `apps/web` — erreurs runtime client (incluant le source-map upload CI)
- [ ] Alerting Slack/email sur erreurs Sentry haute sévérité (≥ ERROR avec seuil de fréquence)
- [ ] Endpoints `/health` sur chaque service (game-engine, ws-gateway, weather-engine) — status JSON simple, lus par les health checks ECS
- [ ] Synthetic check externe (UptimeRobot ou équivalent) sur la home + un endpoint courses, alerte Slack si down > 2 min

---

## Phase 6 — Social + Push + AWS + Charge (Semaines 19–22)

### Social (branchement DB)
- [ ] Système d'amis (invite, accepter, bloquer) — tables créées Phase 3
- [ ] Chat équipe (max 20 membres, pas de chat global de course)
- [ ] DM 1-to-1
- [ ] Signalement images / contenu
- [ ] Page équipe avec gestion des membres (Capitaine peut kick / transférer capitanat)

### Push notifications PWA
- [ ] Service Worker configuré (`sw.js`)
- [ ] Tables `notifications`, `notification_deliveries`, `push_tokens`
- [ ] Alertes gameplay : échouage, mauvaise voile, mode conservatif auto
- [ ] Alertes course : départ dans 1 h, course terminée, rang final
- [ ] Alertes marina : bateau prêt après réparation
- [ ] Toggle par type dans les paramètres profil (déjà UI-ready)

### Backup & Disaster Recovery (**bloquant avant toute mise en prod**)
> Aucune ouverture publique tant que les trois cases ci-dessous ne sont pas cochées.
> Un backup non testé n'est pas un backup — le restore drill est obligatoire.

- [ ] **RDS automated backups** activés sur la base prod : rétention 14 jours minimum, fenêtre de backup hors heures de pointe (ex. 03:00–04:00 UTC)
- [ ] **Point-in-time recovery (PITR)** activé — RPO cible ≤ 5 min
- [ ] **Snapshot manuel** systématique avant chaque migration Drizzle prod (procédure documentée + checklist CI/CD)
- [ ] **Cross-region snapshot copy** (réplication automatique vers une seconde région AWS) — survit à la perte d'une région
- [ ] **Restore drill** réel sur env de staging documenté : restaurer le dernier snapshot, relancer game-engine + web, vérifier que tout repart. RTO cible ≤ 30 min
- [ ] Runbook DR rédigé dans `docs/runbooks/disaster-recovery.md` : qui appelle qui, quel snapshot prendre, commandes exactes
- [ ] Alerte Slack/email si un backup automatique échoue (CloudWatch event sur RDS)
- [ ] Rétention long terme : export mensuel d'un snapshot vers S3 Glacier (conservation 1 an minimum, conformité RGPD article 32)

### Audit pages légales (**bloquant avant ouverture publique**)
> Les pages publiques (`cookies`, `privacy`, `cgu`, `legal`) ont été rédigées en Phase 3 sur la base
> de l'état projeté à la mise en prod. Elles doivent être re-vérifiées contre la réalité avant
> d'ouvrir au public, sinon elles annoncent des traitements/cookies non encore actifs (faux) ou
> omettent ceux qui le sont (sanction CNIL possible).

- [ ] `cookies/page.tsx` : aligner sur les cookies réellement posés (`nemo_access_token` toujours présent ; ajouter `nemo_csrf` si CSRF middleware Phase 4 livré, `nemo_prefs` si feature préférences livrée, `__cf_bm` si Cloudflare est devant le domaine prod)
- [ ] `privacy/page.tsx` : vérifier sous-traitants RGPD réels (Stripe, Cognito, AWS région retenue, SES, éventuels analytics) et durées de conservation effectives
- [ ] `cgu/page.tsx` : aligner sur Stripe (modèle d'abonnement final), Cognito prod, conditions de remboursement, hébergeur réel
- [ ] `legal/page.tsx` : éditeur, hébergeur, contact, numéro RCS/SIRET si la micro-entreprise est créée
- [ ] Mettre à jour la date `LAST_UPDATED` sur les 4 pages
- [ ] Ajouter le bandeau de consentement explicite si un cookie analytique soumis à consentement est introduit (cf. article 05 cookies)

### Premier déploiement AWS
- [ ] ECS Fargate : game-engine + ws-gateway
- [ ] RDS PostgreSQL prod (`db.t3.small`)
- [ ] ElastiCache Redis prod (`cache.t3.small`)
- [ ] S3 + CloudFront : assets météo + images bateaux
- [ ] SES : emails transactionnels Cognito
- [ ] GitHub Actions CI/CD : test → build → push ECR → deploy ECS
- [ ] Variables d'env prod dans AWS Secrets Manager
- [ ] Cognito production (remplace le stub dev)

### Tests de charge
- [ ] Scripts k6 dans `packages/load-test/`
- [ ] Scénarios : 1k / 5k / 10k bateaux simultanés
- [ ] Objectifs : latence broadcast p95 < 500 ms, zéro message perdu
- [ ] Intégré dans CI avant chaque deploy prod
- [ ] 3 optims payload identifiées au bench (voir `memory/project_scaling_benchmarks`) :
      delta diff, quantization positions, visibility cone

---

## Phase 7 — Post-lancement (selon retours)

### Calibration gameplay
- [ ] Test avec joueurs VR réels
- [ ] Ajustements `game-balance.json` selon retours :
  - Taux d'usure
  - Valeurs upgrades
  - Récompenses et progression
- [ ] Rechargement à chaud via Redis event (sans redémarrage serveur)

### Features V2 (selon priorité)
- [ ] Replay de course (visualisation après coup)
- [ ] Classements globaux cross-courses
- [ ] Saisons et ligues
- [ ] API publique (données courses en temps réel)
- [ ] Mode spectateur visiteur (sans inscription) — déjà partiellement en place (`decideRaceAccess`)

### Structure légale
- [ ] Micro-entreprise via formalites.entreprises.gouv.fr
      (à créer quand la facturation commence — ACRE dans les 45 jours)
- [ ] INPI trademark "NEMO" classes 41/42 (~250 €)
- [ ] CGU + politique de confidentialité RGPD
- [ ] Mention légale vitrine nemo-app.fr

---

## Règles de travail

1. **Cocher uniquement ce qui est en prod** (tests verts + revue OK). Pas "en cours".
2. **Mocks alignés backend** — tout nouveau seed `data.ts` reprend les noms de champs du schéma Drizzle (cf. `memory/feedback_mock_models_match_backend`).
3. **Composants fonctionnels** — pas de UI mockée. La donnée peut être seed, le composant doit marcher (pagination, filtres, boutons — cf. `memory/feedback_no_mock_components`).
4. **Mockup-first** — tout nouvel écran commence par un HTML standalone dans `mockups/`. Validation visuelle avant intégration React.
5. **Priorité des specs** : V3 > UX/UI V2 > addendum V2 > addendum HUD/Balance > spec V1.
6. **Anti-P2W** — `computeBoatSpeed()` ne prend jamais `tier`, `stripeCustomerId`, `hasPaid`. Pas de crédits achetés en €.
7. **Démock obligatoire avant Phase 4** — toute feature qui repose encore sur `data.ts` ou stub `api.ts` doit être branchée à la vraie API avant qu'on attaque Stripe.
