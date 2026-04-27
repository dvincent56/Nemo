# Roadmap Nemo

> Source de vérité du plan de livraison. Tenir à jour au fil des commits. Cocher quand c'est vraiment en prod (tests verts + revue OK), pas quand c'est "en cours".

## État actuel (2026-04-15)

- ✅ Phase 1 — Tick loop, polaires, fixtures météo
- ✅ Phase 2 — Sails + zones + wear + segments + e2e 1 h
- 🟢 Phase 3 — **95 %** (backend live, reste le refactor design de `/play` + admin, et Cognito réel)
- ⏳ Phase 4 — Pas commencée (Stripe, marina DB, routeur, NOAA)
- ⏳ Phase 5 — Pas commencée (social DB, admin, AWS)
- ⏳ Phase 6 — Pas commencée (calibration, V2, légal)

**Chemin critique vers le lancement** :
```
Phase 3 terminée
  → Config AWS (Cognito + Neon ou RDS dev)
  → Phase 4 : Stripe d'abord (sans revenus, pas de business)
  → Phase 4 : Marina + upgrades (différenciateur vs VR)
  → Phase 5 : Deploy AWS (premier vrai utilisateur possible)
  → Phase 6 : Calibration avec joueurs VR réels
```

---

## Phase 3 — En cours (à terminer)

### Backend ✅
- [x] Broadcast réel game-engine → Redis → ws-gateway → client
- [x] Ordres RPC client → serveur (compas APPLIQUER + voile CONFIRMER)
- [x] Hydratation DB (races, boats, players depuis Postgres, seed-on-empty)
- [ ] Auth Cognito câblée (attente config AWS — stub dev opérationnel)

### Frontend — Intégration design Direction B
Pages alignées sur les mockups validés (Nautical Luxury — ivory/navy/gold) :

- [x] `/` (redirection)
- [x] `/login` (manifesto 4 items + form)
- [x] `/races` (filtres classe, dates + heure, leader/vainqueur)
- [x] `/marina` (5 slots, 1 par classe, CTA débloquer)
- [x] `/marina/[boatId]` (6 catégories upgrades + comparatif variantes)
- [x] `/marina/[boatId]/customize` (4 zones × 3 modes + marquages)
- [x] `/classement` (filtres Classe + Périmètre, rang local recalculé)
- [x] `/classement/courses` (En cours + Terminées)
- [x] `/classement/[raceId]` (podium + filtres périmètre)
- [x] `/profile` (stats, palmarès, flotte, activité)
- [x] `/profile/[username]` (profil public, classement par classe)
- [x] `/profile/settings` (identité, compte, préférences, notifications)
- [x] `/profile/social` (amis paginés, équipe, invitations fonctionnelles)
- [x] `/team/[slug]` (roster paginé, stats agrégées équipe)
- [ ] **`/play/[raceId]`** — chantier restant, refonte complète depuis `mockups/play-v1.html`
  - [ ] HUD top slim navy + bloc rang gold prominent
  - [ ] Fond de carte bleu nuit océan
  - [ ] Slide-out gauche (classement avec filtres périmètre)
  - [ ] Stack droite (boutons + boussole fixe bottom-right)
  - [ ] Slide-out droite (Voiles + Programmation)
  - [ ] Widget Couches bottom-left
  - [ ] Timeline météo scrubbable bottom
- [ ] **`/admin/races`** — liste admin (5 statuts)
- [ ] **`/admin/races/[id]`** — éditeur studio 3 colonnes (tools / map / inspector)

### Design system (primitives réutilisables) ✅
- [x] `Button` (primary/secondary/danger/dangerSolid/ghost)
- [x] `Field` / `Card` / `Chip` / `Eyebrow`
- [x] `Pagination` (ellipsis > 7 pages, meta "X–Y / Z")
- [x] `SiteShell` / `SiteFooter` / `Topbar` / `Drawer` (burger mobile)

---

## Phase 4 — Mode carrière + Stripe (Semaines 13–16)

### Prérequis bloquant : extensions schéma backend
Les pages Social/Settings/Marina sont mockées avec des champs qui n'existent pas encore en DB. Liste exhaustive dans [`memory/project_backend_schema_gaps.md`](.claude/memory/project_backend_schema_gaps.md).

- [ ] Table `profiles` (country, city, dpt, region, tagline, member_since)
- [ ] Tables `teams`, `team_members` (capitaine / modérateur / membre)
- [ ] Table `friendships`
- [ ] Table `invitations` (FRIEND | TEAM)
- [ ] Table `player_class_stats` (ranking par classe de bateau)
- [ ] Table `user_settings` (unités, langue, notifs)
- [ ] Colonnes `boats` : `deck_color`, `hull_number`, `sail_pattern`, `hull_pattern`, `custom_emblem_url`

### Refactoring architecture (critique avant tout le reste)
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

### Marina (branchement DB)
- [ ] CRUD bateaux (achat 0 crédit, multi-bateaux, 1 course/bateau)
- [ ] Customisation persistée en DB (couleur, dégradé, image, numéro)
- [ ] Upgrades : achat avec crédits, effets appliqués dans Game Engine
- [ ] Réparation : timer + coût en crédits
- [ ] Revente : upgrades × 70 % + bonus palmarès
- [ ] Page Marina complète (mocks existants à brancher API)

### Système de crédits
- [ ] Calcul récompenses après course :
      `distance × tarif classe × multiplicateur rang + sponsor + streak`
- [ ] Table `credit_transactions` (audit trail complet)
- [ ] Crédits **non achetables avec argent réel** (anti-P2W — vérification `reason != 'PURCHASE'`)
- [ ] Affichage crédits dans HUD + marina + profil

### Routeur isochrones (Carrière uniquement)
- [ ] Worker Node.js dédié (timeout 8 s)
- [ ] Algorithme isochrones : 360 secteurs, pas 1 h, max 240 h
- [ ] Élagage further-from-start
- [ ] Cache Redis 10 min
- [ ] Éditeur de route complet (clic droit, waypoints, portes)
- [ ] ETA waypoints par simulation avance rapide
- [ ] Envoi des waypoints dans la file d'ordres

### Programmateur d'ordres UI complet
- [ ] Panneau VR-style (grille de slots)
- [ ] Éditeur de slot (CAP / TWA / WPT / VOILE)
- [ ] Time picker heures/minutes
- [ ] ETA calculé et affiché par slot WPT
- [ ] Tous les triggers câblés côté UI

### NOAA pipeline complet
- [ ] Script Python `ingest.py` finalisé (GRIB2 → Redis)
- [ ] Job toutes les 6 h
- [ ] Tests avec vraies données météo

### i18n
- [ ] Configuration `next-intl` + routing `app/[locale]/*`
- [ ] Fichiers `apps/web/messages/{fr,en,es,de}.json`
- [ ] Migration de tous les textes FR hardcodés vers `useTranslations()`

---

## Phase 5 — Social + Admin + Lancement (Semaines 17–20)

### Social (branchement DB)
- [ ] Système d'amis (invite, accepter, bloquer) — tables créées Phase 4
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

### Backoffice admin
- [ ] Éditeur de course complet (mockup `admin-races-edit-v1.html` validé) :
  - Carte MapLibre + outils dessin
  - Portes (GATE / MARK / FINISH) avec config tribord/bâbord
  - Zones d'exclusion (WARN ×0,8 / PENALTY ×0,5 / HARD_BLOCK)
  - Paramètres course (classe, dates, récompenses)
  - Publication / dépublication
- [ ] KPI dashboard :
  - Joueurs actifs, courses en cours, revenus Stripe
  - Métriques tick duration, latence broadcast
- [ ] Gestion joueurs : suspension, ban, remboursement crédits (`player_sanctions`)
- [ ] Modération : file de signalements
- [ ] Table `audit_log` pour traçabilité actions admin

### Page super-admin / management (`/admin/system`)
Gardée par middleware `role === 'super_admin'`, regroupe les manettes ops :

- [ ] Toggle **mode maintenance** global : flag DB → middleware web qui répond 503 (sauf `/admin/*`) avec une page maintenance dédiée. Le toggle est instantané, pas de redeploy nécessaire.
- [ ] Éditeur **bandeaux d'incident** (CRUD sur `system_status`) : sévérité, message multilingue, fenêtre de validité, preview du rendu avant publication.
- [ ] Vue temps réel de l'état des services (lus depuis les `/health`) : game-engine, ws-gateway, weather-engine, Postgres, Redis. Voyants vert/orange/rouge.
- [ ] Bouton **kill-switch** par feature flag : désactiver Stripe (lecture seule abonnements), désactiver les inscriptions, désactiver le routeur, etc. Tous les flags loggés dans `audit_log`.
- [ ] Toutes les actions super-admin tracées dans `audit_log` (qui, quand, quel toggle, valeur avant/après).
- [ ] **Sentry** SDK serveur (game-engine, weather-engine, ws-gateway) — capture exceptions + traces
- [ ] **Sentry** SDK browser dans `apps/web` — erreurs runtime client (incluant le source-map upload CI)
- [ ] Alerting Slack/email sur erreurs Sentry haute sévérité (≥ ERROR avec seuil de fréquence)
- [ ] Endpoints `/health` sur chaque service (game-engine, ws-gateway, weather-engine) — status JSON simple, lus par les health checks ECS
- [ ] Synthetic check externe (UptimeRobot ou équivalent) sur la home + un endpoint courses, alerte Slack si down > 2 min
- [ ] Table `system_status` (id, severity: INFO/WARN/CRITICAL, message_fr/en/es/de, active_from, active_until) éditée depuis l'admin
- [ ] Composant `<SystemStatusBanner />` lu en SSR layout, masqué si pas d'incident actif — sévérité contrôle la couleur (gold WARN / red CRITICAL)
- [ ] Dégradés granulaires auto-poussés dans le bandeau via `WeatherStatus` (delayed → "Météo retardée, dernière mise à jour il y a Xh") et état du tick loop (game-engine downtime > 30 s → "Course en pause technique")
- [ ] Maintenance planifiée : flag dans `system_status` + désactivation des inscriptions/lancements de course pendant la fenêtre

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

## Phase 6 — Post-lancement (selon retours)

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
- [ ] Internationalisation EN / FR minimum (poussée Phase 4 si possible)

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
