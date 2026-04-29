// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import TimeStepper from './TimeStepper';

const HOUR = 3600;
const MIN = 60;

describe('<TimeStepper>', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the value as HH:MM in the center display', () => {
    const noon = 12 * HOUR;
    const { container } = render(
      <TimeStepper value={noon} onChange={() => {}} minValue={0} nowSec={0} />
    );
    expect(container.textContent).toContain('12:00');
  });

  it('formats relative offset under 1h as +Nmin', () => {
    const now = 12 * HOUR;
    const target = now + 30 * MIN;
    const { container } = render(
      <TimeStepper value={target} onChange={() => {}} minValue={0} nowSec={now} />
    );
    expect(container.textContent).toContain('+30min');
  });

  it('formats relative offset over 1h as +Xh Ymin', () => {
    const now = 12 * HOUR;
    const target = now + 2 * HOUR + 27 * MIN;
    const { container } = render(
      <TimeStepper value={target} onChange={() => {}} minValue={0} nowSec={now} />
    );
    expect(container.textContent).toContain('+2h 27min');
  });

  it('disables the minus button when value === minValue', () => {
    const t = 12 * HOUR;
    const { getByLabelText } = render(
      <TimeStepper value={t} onChange={() => {}} minValue={t} nowSec={t} />
    );
    const minus = getByLabelText('Reculer');
    expect(minus).toHaveProperty('disabled', true);
  });

  it('shows the floor warning when value === minValue', () => {
    const t = 12 * HOUR;
    const { container } = render(
      <TimeStepper value={t} onChange={() => {}} minValue={t} nowSec={t} />
    );
    expect(container.textContent).toContain('Délai mini');
  });

  it('calls onChange with value+60 on a single + click', () => {
    const onChange = vi.fn();
    const t = 12 * HOUR;
    const { getByLabelText } = render(
      <TimeStepper value={t} onChange={onChange} minValue={0} nowSec={t} />
    );
    const plus = getByLabelText('Avancer');
    fireEvent.pointerDown(plus, { pointerId: 1 });
    fireEvent.pointerUp(plus, { pointerId: 1 });
    expect(onChange).toHaveBeenCalledWith(t + 60);
  });

  it('calls onChange with value-60 on a single - click when above minValue', () => {
    const onChange = vi.fn();
    const t = 12 * HOUR;
    const { getByLabelText } = render(
      <TimeStepper value={t} onChange={onChange} minValue={0} nowSec={t} />
    );
    const minus = getByLabelText('Reculer');
    fireEvent.pointerDown(minus, { pointerId: 1 });
    fireEvent.pointerUp(minus, { pointerId: 1 });
    expect(onChange).toHaveBeenCalledWith(t - 60);
  });

  it('does not call onChange on a - click when value === minValue', () => {
    const onChange = vi.fn();
    const t = 12 * HOUR;
    const { getByLabelText } = render(
      <TimeStepper value={t} onChange={onChange} minValue={t} nowSec={t} />
    );
    const minus = getByLabelText('Reculer');
    fireEvent.pointerDown(minus, { pointerId: 1 });
    fireEvent.pointerUp(minus, { pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });
});
