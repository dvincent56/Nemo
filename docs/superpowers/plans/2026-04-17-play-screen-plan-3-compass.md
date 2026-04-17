# Play Screen Redesign — Plan 3: Compass

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refondre le Compass vers le design Nautical Luxury : silhouette bateau, flèche vent extérieure, 2 modes (CAP/LOCK TWA), VMG glow, readouts, modale annulation, notification changement voile.

**Architecture:** Réécriture complète de Compass.tsx et Compass.module.css. Conservation de la logique drag DOM directe (60fps). Ajout d'un sous-composant CompassConfirmModal.

**Tech Stack:** SVG inline, CSS Modules, Zustand store (selectionSlice.editMode)

**Spec de référence :** `docs/superpowers/specs/2026-04-17-play-screen-redesign.md` §5.1

---

## Task 1: Réécriture complète Compass.module.css

**Files:**
- Modify: `apps/web/src/components/play/Compass.module.css`

Réécrire entièrement avec le design Nautical Luxury (navy/gold/ivory).

## Task 2: Réécriture complète Compass.tsx

**Files:**
- Modify: `apps/web/src/components/play/Compass.tsx`

Refonte complète. Le nouveau compass doit :

**Structure visuelle :**
- Widget 280px avec fond `rgba(12,20,36,0.92)`, border `rgba(245,240,232,0.16)`, border-radius 4px
- 4 readouts en haut (grille 2×2) : Vit. bateau (BSP), Vent local (TWS), Cap (HDG), TWA
- SVG compass au centre avec :
  - Rose des vents (cercles, graduations 10°, labels N/E/S/O en français)
  - Silhouette bateau (gold `#c9a227`) orientée selon le cap - un path simple type `M 0,-18 C 5,-16 7,-10 7,-2 C 7,6 5,12 3,16 L 0,18 L -3,16 C -5,12 -7,6 -7,-2 C -7,-10 -5,-16 0,-18 Z`
  - Flèche vent à l'EXTÉRIEUR du cercle indiquant d'où vient le vent
  - Hub central avec la valeur du cap en degrés
  - PAS de zones colorées (pas de rouge/vert/doré)
  - PAS de flèche TWA
- 2 boutons en bas : 🔒 TWA (toggle) + Appliquer

**Modes :**
- CAP (défaut) : cap fixe absolu
- LOCK TWA : angle relatif au vent. Bouton 🔒 TWA devient gold quand actif.
- PAS de mode VMG AUTO

**Mode édition (drag) :**
- `setEditMode(true)` quand le joueur commence à dragger
- Ghost pointillé de l'ancienne position du bateau
- Readouts Cap et TWA passent en mode "CIBLE" / "ESTIMÉ"
- Bouton Appliquer devient gold actif avec "✓ Appliquer {deg}°"
- Notification changement de voile si le nouveau cap implique un changement en mode auto

**VMG glow :**
- Quand le TWA est dans la zone VMG optimale (38-54° ou 140-162°), le widget reçoit un box-shadow vert

**Annulation :**
- Echap avec cap modifié → modale confirmation
- Clic hors compass avec cap modifié → modale confirmation

**Conservation technique :**
- Drag DOM directe sur le SVG (pas de re-render React pendant le drag)
- Pointer capture
- Wheel ±1°
- sendOrder() pour CAP et TWA

## Task 3: CompassConfirmModal

**Files:**
- Create: `apps/web/src/components/play/CompassConfirmModal.tsx`
- Create: `apps/web/src/components/play/CompassConfirmModal.module.css`

Petite modale qui apparaît quand le joueur quitte le compass avec un cap non appliqué.

---

## Résumé des livrables

- ✅ Compass refondu Nautical Luxury (silhouette bateau, flèche vent O, gold/navy)
- ✅ 2 modes (CAP / LOCK TWA)
- ✅ VMG glow vert
- ✅ Mode édition avec ghost + notification voile
- ✅ Modale de confirmation annulation
- ✅ Readouts 4 valeurs
