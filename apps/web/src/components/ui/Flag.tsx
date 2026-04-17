import type { CSSProperties, SVGProps } from 'react';
import * as FlagIcons from 'country-flag-icons/react/3x2';

export interface FlagProps {
  /** Code ISO 3166-1 alpha-2 (ex: 'FR', 'NL'). Case insensitive. */
  code: string;
  /** Classe CSS optionnelle. */
  className?: string | undefined;
  /** Style inline optionnel (width/height). Par défaut inherit du parent. */
  style?: CSSProperties | undefined;
  /** Label d'accessibilité — sinon le drapeau est aria-hidden. */
  title?: string | undefined;
}

/**
 * Drapeau national rendu comme SVG inline via `country-flag-icons`.
 * Remplace les anciennes classes CSS `.fr .nl .it…` qui peignaient des
 * linear-gradients approximatifs. Supporte les 250 pays ISO 3166-1.
 */
/** Alias ISO historiques → codes ISO 3166-1 alpha-2 officiels.
 *  Ex : 'UK' (usage courant) → 'GB' (code ISO du Royaume-Uni). */
const ISO_ALIASES: Record<string, string> = {
  UK: 'GB',
};

export function Flag({ code, className, style, title }: FlagProps): React.ReactElement | null {
  const upper = code.toUpperCase();
  const iso = ISO_ALIASES[upper] ?? upper;
  type FlagComponent = React.FC<SVGProps<SVGSVGElement> & { title?: string }>;
  const Component = (FlagIcons as unknown as Record<string, FlagComponent>)[iso];
  if (!Component) return null;
  const svgProps: SVGProps<SVGSVGElement> & { title?: string } = {
    'aria-hidden': title ? undefined : true,
  };
  if (className !== undefined) svgProps.className = className;
  if (style !== undefined) svgProps.style = style;
  if (title !== undefined) svgProps.title = title;
  return <Component {...svgProps} />;
}
