// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import TimeStepper from './TimeStepper';

const HOUR = 3600;
const MIN = 60;

// Compute a Unix timestamp that — under LOCAL-time formatting — reads as
// "12:00". This anchor is TZ-independent: today's noon in local time is
// guaranteed to format as "12:00" regardless of whether the test runner is
// on UTC, CEST, EST, or anything else. (Previously these tests passed
// `12 * HOUR` and assumed UTC formatting; the real component now formats
// in local time, matching the player's wall clock.)
function noonTodaySec(): number {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

describe('<TimeStepper>', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the value as HH:MM in the center display', () => {
    const noon = noonTodaySec();
    const { container } = render(
      <TimeStepper value={noon} onChange={() => {}} minValue={0} nowSec={noon} />
    );
    expect(container.textContent).toContain('12:00');
  });

  it('formats relative offset under 1h as +Nmin', () => {
    const now = noonTodaySec();
    const target = now + 30 * MIN;
    const { container } = render(
      <TimeStepper value={target} onChange={() => {}} minValue={0} nowSec={now} />
    );
    expect(container.textContent).toContain('+30min');
  });

  it('formats relative offset over 1h as +Xh Ymin', () => {
    const now = noonTodaySec();
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
    const minus = getByLabelText("Reculer d'une minute");
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
    const plus = getByLabelText("Avancer d'une minute");
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
    const minus = getByLabelText("Reculer d'une minute");
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
    const minus = getByLabelText("Reculer d'une minute");
    fireEvent.pointerDown(minus, { pointerId: 1 });
    fireEvent.pointerUp(minus, { pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('accelerates + when held: pulses 1-3 at 350ms', async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const t = 12 * HOUR;
    const { getByLabelText, unmount } = render(
      <TimeStepper value={t} onChange={onChange} minValue={0} nowSec={t} />
    );
    const plus = getByLabelText("Avancer d'une minute");

    fireEvent.pointerDown(plus, { pointerId: 1 });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(t + 60);

    await vi.advanceTimersByTimeAsync(350);
    expect(onChange).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(350);
    expect(onChange).toHaveBeenCalledTimes(3);

    fireEvent.pointerUp(plus, { pointerId: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onChange).toHaveBeenCalledTimes(3);

    unmount();
    vi.useRealTimers();
  });

  it('advances cumulatively when consumer updates value between pulses', async () => {
    vi.useFakeTimers();
    let v = 12 * HOUR;
    const onChange = vi.fn((next: number) => { v = next; });
    const t0 = v;

    const { getByLabelText, rerender, unmount } = render(
      <TimeStepper value={v} onChange={onChange} minValue={0} nowSec={t0} />
    );
    const plus = getByLabelText("Avancer d'une minute");

    fireEvent.pointerDown(plus, { pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(t0 + 60);
    rerender(<TimeStepper value={v} onChange={onChange} minValue={0} nowSec={t0} />);

    await vi.advanceTimersByTimeAsync(350);
    expect(onChange).toHaveBeenLastCalledWith(t0 + 120);
    rerender(<TimeStepper value={v} onChange={onChange} minValue={0} nowSec={t0} />);

    await vi.advanceTimersByTimeAsync(350);
    expect(onChange).toHaveBeenLastCalledWith(t0 + 180);

    fireEvent.pointerUp(plus, { pointerId: 1 });
    unmount();
    vi.useRealTimers();
  });
});
