import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CountdownTimer } from './countdown-timer';

describe('CountdownTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('starts at totalSeconds, decrements each second', () => {
    render(<CountdownTimer durationSeconds={10} />);
    
    expect(screen.getByText('10')).not.toBeNull();
    
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('9')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText('7')).not.toBeNull();
  });

  it('progress bar fills accurately', () => {
    const { container } = render(<CountdownTimer durationSeconds={10} />);
    
    const innerBar = container.querySelector('[role="progressbar"] > div') as HTMLElement;
    
    expect(innerBar).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(innerBar.style.transform).toBe('translateX(-50%)');
  });

  it('red pulse visible when < 5 s remaining (class check)', () => {
    render(<CountdownTimer durationSeconds={10} />);
    
    const spanEl = screen.getByText('10');
    expect(spanEl.className).not.toContain('text-red-500');

    act(() => {
      vi.advanceTimersByTime(5100);
    });
    
    const spanElUpdated = screen.getByText('5');
    expect(spanElUpdated.className).toContain('text-red-500');
    expect(spanElUpdated.className).toContain('animate-pulse');
  });

  it('onComplete fires exactly once at 0', () => {
    const onExpireMock = vi.fn();
    render(<CountdownTimer durationSeconds={10} onExpire={onExpireMock} />);

    act(() => {
      vi.advanceTimersByTime(9900);
    });
    expect(onExpireMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(onExpireMock).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onExpireMock).toHaveBeenCalledTimes(1);
  });

  it('survives totalSeconds change (resets cleanly)', () => {
    const { rerender } = render(<CountdownTimer durationSeconds={10} />);
    
    expect(screen.getByText('10')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText('7')).not.toBeNull();

    rerender(<CountdownTimer durationSeconds={8} />);
    expect(screen.getByText('8')).not.toBeNull();
    
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('7')).not.toBeNull();
  });

  it('does not leak intervals on unmount', () => {
    const { unmount } = render(<CountdownTimer durationSeconds={10} />);

    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('parent re-renders with new onExpire identity do not restart the timer', () => {
    const onExpire = vi.fn();

    function Parent({ tick }: { tick: number }) {
      // New arrow function every render — old bug would restart timer each time
      return <CountdownTimer durationSeconds={5} onExpire={() => { onExpire(); void tick; }} />;
    }

    const { rerender } = render(<Parent tick={0} />);

    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('4')).not.toBeNull();

    for (let i = 1; i <= 10; i++) {
      rerender(<Parent tick={i} />);
    }

    // Timer should have continued from 4s left, not restarted
    act(() => { vi.advanceTimersByTime(4000); });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
