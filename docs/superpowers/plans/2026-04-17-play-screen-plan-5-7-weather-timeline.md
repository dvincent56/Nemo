# Play Screen Redesign — Plans 5+7: Météo & Timeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter les overlays météo (vent particules + houle colormap), la WeatherTimeline (scrubber), le LayersWidget, et la WindLegend. Mock data pour l'instant, branchable sur un vrai endpoint quand le backend sera prêt.

**Architecture:** Mock weather grid generator fournit des données synthétiques réalistes. WindOverlay utilise un canvas HTML overlay (plus simple et performant que WebGL custom layer pour des particules). SwellOverlay utilise un canvas colormap. WeatherTimeline est un composant React dans la row 3 du grid. Tous réagissent au timelineSlice (scrubber position).

**Tech Stack:** Canvas 2D (particules vent), MapLibre GL, CSS Modules, Zustand

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `apps/web/src/lib/weather/mockGrid.ts` | Générateur de grille météo mock (vent + houle) |
| `apps/web/src/lib/weather/interpolate.ts` | Interpolation bilinéaire sur la grille |
| `apps/web/src/components/play/WindOverlay.tsx` | Particules vent animées (canvas overlay) |
| `apps/web/src/components/play/SwellOverlay.tsx` | Colormap houle (canvas overlay) |
| `apps/web/src/components/play/WindLegend.tsx` + `.module.css` | Légende vent/houle |
| `apps/web/src/components/play/LayersWidget.tsx` + `.module.css` | Toggles couches carte |
| `apps/web/src/components/play/WeatherTimeline.tsx` + `.module.css` | Scrubber temporel |

---

## Résumé des livrables

- ✅ Mock weather grid (vent + houle, réaliste, interpolable)
- ✅ WindOverlay (particules canvas animées selon direction/force vent)
- ✅ SwellOverlay (colormap canvas selon hauteur houle)
- ✅ LayersWidget (toggles vent/houle exclusifs + adversaires + zones)
- ✅ WindLegend (échelle couleur adaptative vent/houle)
- ✅ WeatherTimeline (scrubber passé/futur + contrôles vitesse + bouton Live)
- ✅ Intégration dans PlayClient
