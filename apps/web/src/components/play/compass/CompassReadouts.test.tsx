// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import CompassReadouts from './CompassReadouts';

describe('<CompassReadouts>', () => {
  it('formats heading as 3-digit integer with degree sign', () => {
    const { container } = render(
      <CompassReadouts headingDeg={45} twaDeg={-12} bspKn={6.7} twaLocked={false} vmgGlow={false} />
    );
    expect(container.textContent).toContain('45°');
  });

  it('formats bsp with 2 decimals when provided', () => {
    const { container } = render(
      <CompassReadouts headingDeg={180} twaDeg={90} bspKn={9.123} twaLocked={false} vmgGlow={false} />
    );
    expect(container.textContent).toContain('9.12');
    expect(container.textContent).toContain('nds');
  });

  it('omits the BSP cell when bspKn is undefined', () => {
    const { container } = render(
      <CompassReadouts headingDeg={180} twaDeg={90} twaLocked={false} vmgGlow={false} />
    );
    expect(container.textContent).not.toContain('nds');
    expect(container.textContent).not.toContain('Vitesse');
  });

  it('renders the manoeuvre hint above the readouts when provided', () => {
    const { container } = render(
      <CompassReadouts
        headingDeg={45}
        twaDeg={-12}
        bspKn={6}
        twaLocked={false}
        vmgGlow={false}
        pendingHint={{ kind: 'tack', label: 'Virement — vitesse −40% (~90s)', className: 'hintTack' }}
      />
    );
    expect(container.textContent).toContain('Virement');
  });
});
