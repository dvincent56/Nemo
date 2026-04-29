// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import CompassDial from './CompassDial';

describe('<CompassDial>', () => {
  it('renders a square SVG with the configured viewBox', () => {
    const { container } = render(<CompassDial value={0} windDir={0} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 220 220');
  });

  it('renders 4 cardinal labels (French: N E S O)', () => {
    const { container } = render(<CompassDial value={0} windDir={0} />);
    const texts = Array.from(container.querySelectorAll('text')).map((t) => t.textContent);
    const cardinals = texts.filter((t) => t === 'N' || t === 'E' || t === 'S' || t === 'O').sort();
    expect(cardinals).toEqual(['E', 'N', 'O', 'S']);
  });

  it('rotates the boat group to the value prop', () => {
    const { container } = render(<CompassDial value={45} windDir={0} />);
    const boat = container.querySelector('[id="boat"]');
    expect(boat).not.toBeNull();
    expect(boat?.getAttribute('transform')).toContain('rotate(45');
  });

  it('renders the ghost group with opacity 0 by default (no edit in progress)', () => {
    const { container } = render(<CompassDial value={45} windDir={0} />);
    const ghost = container.querySelector('[id="ghost"]') as SVGGElement | null;
    expect(ghost).not.toBeNull();
    expect(ghost?.style.opacity).toBe('0');
  });

  it('shows the ghost when ghostValue differs from value', () => {
    const { container } = render(<CompassDial value={45} ghostValue={20} windDir={0} />);
    const ghost = container.querySelector('[id="ghost"]') as SVGGElement;
    expect(ghost).not.toBeNull();
    expect(ghost.getAttribute('transform')).toContain('rotate(20');
    expect(parseFloat(ghost.style.opacity)).toBeGreaterThan(0);
  });

  it('omits the boat group when showBoat=false', () => {
    const { container } = render(<CompassDial value={45} windDir={0} showBoat={false} />);
    expect(container.querySelector('[id="boat"]')).toBeNull();
  });

  it('does not register pointer handlers when readOnly', () => {
    const onChange = vi.fn();
    const { container } = render(<CompassDial value={0} windDir={0} onChange={onChange} readOnly />);
    const svg = container.querySelector('svg')!;
    // Trigger a synthetic pointerdown — onChange should not fire.
    svg.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 200, clientY: 100 }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
