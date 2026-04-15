// Bootstrap ESM pour le Worker thread en dev.
// En prod, manager.ts spawn directement worker.js compilé — ce fichier n'est pas utilisé.
//
// Problème : `execArgv: ['--import', 'tsx']` passé au Worker ne propage pas
// fiablement le loader ESM de tsx aux imports internes du worker (les specs
// `./tick.js` ne sont pas redirigées vers `./tick.ts`).
// Solution : utiliser la fonction `register()` de `tsx/esm/api` explicitement
// dans un bootstrap .mjs qui enregistre le hook AVANT l'import de worker.ts.
import { register } from 'tsx/esm/api';

register();
await import('./worker.ts');
