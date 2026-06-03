import React, { useEffect, useMemo, useState } from 'react';
import { Gift, Loader2, PartyPopper, RefreshCw, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useNotification } from '../ui/NotificationProvider';

type SpinStatus = {
  active?: boolean;
  hasSpun?: boolean;
  campaignId?: string;
  campaignName?: string;
  prizeAmount?: number;
  outcome?: 'prize' | 'better_luck';
  message?: string;
};

type SpinResult = SpinStatus & {
  success?: boolean;
  spinId?: string;
  newBalance?: number;
};

type Segment = {
  label: string;
  amount: number;
  outcome: 'prize' | 'better_luck';
  color: string;
};

const baseSegments: Segment[] = [
  { label: 'Better luck', amount: 0, outcome: 'better_luck', color: '#0f766e' },
  { label: '5 USDT', amount: 5, outcome: 'prize', color: '#2563eb' },
  { label: 'Better luck', amount: 0, outcome: 'better_luck', color: '#dc2626' },
  { label: '10 USDT', amount: 10, outcome: 'prize', color: '#16a34a' },
  { label: 'Better luck', amount: 0, outcome: 'better_luck', color: '#7c3aed' },
  { label: '25 USDT', amount: 25, outcome: 'prize', color: '#ea580c' },
  { label: 'Better luck', amount: 0, outcome: 'better_luck', color: '#0891b2' },
  { label: '50 USDT', amount: 50, outcome: 'prize', color: '#be123c' },
];

const findTargetIndex = (segments: Segment[], result: SpinResult) => {
  const amount = Number(result.prizeAmount || 0);
  if (amount > 0) {
    const prizeIndex = segments.findIndex((segment) => segment.outcome === 'prize' && Number(segment.amount) === amount);
    return prizeIndex >= 0 ? prizeIndex : 1;
  }
  const betterLuckIndex = segments.findIndex((segment) => segment.outcome === 'better_luck');
  return betterLuckIndex >= 0 ? betterLuckIndex : 0;
};

const getPointerAlignedRotation = (segments: Segment[], result: SpinResult) => {
  const targetIndex = findTargetIndex(segments, result);
  const sliceDeg = 360 / segments.length;
  const targetCenter = targetIndex * sliceDeg + sliceDeg / 2;
  return 360 - targetCenter;
};

const SpinWheel: React.FC = () => {
  const notification = useNotification();
  const [status, setStatus] = useState<SpinStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [showResult, setShowResult] = useState(false);

  const segments = useMemo(() => {
    const amount = Number(result?.prizeAmount || status?.prizeAmount || 0);
    if (amount <= 0 || baseSegments.some((segment) => segment.outcome === 'prize' && segment.amount === amount)) {
      return baseSegments;
    }

    const next = [...baseSegments];
    next[1] = { ...next[1], label: `${amount.toFixed(2)} USDT`, amount };
    return next;
  }, [result?.prizeAmount, status?.prizeAmount]);

  const wheelGradient = useMemo(() => {
    const slice = 100 / segments.length;
    return `conic-gradient(${segments
      .map((segment, index) => `${segment.color} ${index * slice}% ${(index + 1) * slice}%`)
      .join(', ')})`;
  }, [segments]);

  const revealedResult = result || (status?.hasSpun ? status : null);
  const revealedSegmentIndex = revealedResult ? findTargetIndex(segments, revealedResult) : -1;
  const shouldRevealSegmentLabel = Boolean(revealedResult && !spinning);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('customer_get_spin_wheel_status');
      if (error) throw error;
      setStatus((data || {}) as SpinStatus);
    } catch (error: any) {
      console.error('Failed to load spin wheel status:', error);
      notification.showError('Error', error?.message || 'Failed to load spin wheel status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!status?.hasSpun || result || spinning) return;
    setRotation(getPointerAlignedRotation(segments, status));
  }, [result, segments, spinning, status]);

  const handleSpin = async () => {
    if (spinning || status?.hasSpun || !status?.active) return;

    try {
      setSpinning(true);
      const { data, error } = await supabase.rpc('customer_spin_wheel');
      if (error) throw error;

      const spinResult = (data || {}) as SpinResult;
      setResult(spinResult);

      const nextSegments = (() => {
        const amount = Number(spinResult.prizeAmount || 0);
        if (amount <= 0 || baseSegments.some((segment) => segment.outcome === 'prize' && segment.amount === amount)) {
          return baseSegments;
        }
        const adjusted = [...baseSegments];
        adjusted[1] = { ...adjusted[1], label: `${amount.toFixed(2)} USDT`, amount };
        return adjusted;
      })();

      const targetIndex = findTargetIndex(nextSegments, spinResult);
      const sliceDeg = 360 / nextSegments.length;
      const targetCenter = targetIndex * sliceDeg + sliceDeg / 2;
      const finalRotation = 360 * 6 + (360 - targetCenter);
      setRotation((prev) => prev + finalRotation);

      window.setTimeout(() => {
        setSpinning(false);
        setShowResult(true);
        setStatus((prev) => ({
          ...(prev || {}),
          active: prev?.active,
          hasSpun: true,
          prizeAmount: Number(spinResult.prizeAmount || 0),
          outcome: spinResult.outcome,
          message: spinResult.message || 'You have already used your spin.',
        }));
      }, 4300);
    } catch (error: any) {
      console.error('Spin failed:', error);
      notification.showError('Spin Failed', error?.message || 'Unable to complete spin.');
      setSpinning(false);
      await loadStatus();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
      </div>
    );
  }

  if (!status?.active && !status?.hasSpun) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
        <Gift className="mx-auto mb-3 h-10 w-10 text-gray-400" />
        <h3 className="text-lg font-semibold text-gray-900">Spin Wheel</h3>
        <p className="mt-2 text-gray-600">Spin wheel is not available right now.</p>
      </div>
    );
  }

  const hasWon = Number((result || status)?.prizeAmount || 0) > 0;

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-xl border border-teal-100 bg-gradient-to-br from-white via-slate-50 to-teal-50 p-6 shadow-sm">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-xl font-bold text-gray-900">{status?.campaignName || 'Spin the Wheel'}</h3>
            <p className="text-sm text-gray-500">
              {status?.hasSpun ? 'You have already used your spin.' : 'One mystery spin is available for your account.'}
            </p>
          </div>
          <button
            type="button"
            onClick={loadStatus}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(280px,440px)_1fr]">
          <div className="relative mx-auto aspect-square w-full max-w-[440px]">
            <div className="absolute inset-6 rounded-full bg-teal-500/20 blur-3xl" />
            <div className="absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-2">
              <div className="rounded-b-full bg-white px-3 pb-2 pt-1 shadow-lg">
                <div className="h-0 w-0 border-l-[18px] border-r-[18px] border-t-[38px] border-l-transparent border-r-transparent border-t-slate-950 drop-shadow-md" />
              </div>
            </div>
            <div className="relative h-full w-full rounded-full bg-gradient-to-br from-slate-950 via-slate-800 to-slate-950 p-3 shadow-[0_28px_70px_rgba(15,23,42,0.28)]">
              <div className="absolute inset-0 rounded-full border border-white/25" />
              <div
                className="relative h-full w-full overflow-hidden rounded-full border-[6px] border-slate-950 shadow-inner transition-transform duration-[4200ms] ease-out"
                style={{ background: wheelGradient, transform: `rotate(${rotation}deg)` }}
              >
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background:
                      'radial-gradient(circle at 32% 26%, rgba(255,255,255,0.34), transparent 28%), radial-gradient(circle at center, transparent 0 54%, rgba(15,23,42,0.18) 74%, rgba(15,23,42,0.42) 100%)',
                  }}
                />
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background:
                      'repeating-conic-gradient(from -22.5deg, transparent 0deg 44deg, rgba(255,255,255,0.55) 44deg 45deg)',
                  }}
                />
                <div className="relative h-full w-full">
                  {segments.map((segment, index) => {
                    const angle = index * (360 / segments.length) + 360 / segments.length / 2;
                    const radians = (angle * Math.PI) / 180;
                    const left = 50 + Math.sin(radians) * 31;
                    const top = 50 - Math.cos(radians) * 31;
                    const revealThisSegment = shouldRevealSegmentLabel && index === revealedSegmentIndex;
                    return (
                      <div
                        key={`${segment.label}-${index}`}
                        className="absolute -translate-x-1/2 -translate-y-1/2"
                        style={{
                          left: `${left}%`,
                          top: `${top}%`,
                        }}
                      >
                        {revealThisSegment && (
                          <span
                            className="block w-20 rounded-full bg-slate-950/75 px-2 py-1.5 text-center text-[9px] font-extrabold uppercase leading-tight text-white shadow-lg ring-1 ring-white/25 sm:w-24 sm:text-xs"
                            style={{
                              transform: `rotate(${-rotation}deg)`,
                            }}
                          >
                            {segment.label}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="absolute inset-[13%] rounded-full border border-white/20" />
                <div className="absolute inset-[28%] rounded-full bg-white/10 blur-md" />
              </div>
            </div>
            <div className="absolute left-1/2 top-1/2 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white p-1.5 shadow-[0_14px_35px_rgba(15,23,42,0.35)] sm:h-28 sm:w-28">
              <button
                type="button"
                onClick={handleSpin}
                disabled={spinning || status?.hasSpun || !status?.active}
                className="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-slate-950 via-slate-900 to-teal-950 text-sm font-black uppercase tracking-wide text-white shadow-inner transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:hover:scale-100 sm:text-base"
                aria-label="Spin wheel"
              >
                {spinning ? 'Spin' : shouldRevealSegmentLabel ? 'Done' : 'Spin'}
              </button>
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-lg border border-teal-100 bg-white/80 p-5 shadow-sm">
              <p className="text-sm font-semibold text-teal-900">Mystery Spin</p>
              <p className="mt-1 text-sm text-teal-700">
                Each customer can spin only once. The reward or better-luck message is revealed only after the wheel stops.
              </p>
            </div>

            {status?.hasSpun ? (
              <div className="rounded-lg border border-gray-200 bg-white/80 p-5 shadow-sm">
                <p className="font-semibold text-gray-900">You have already used your spin.</p>
                <p className="mt-1 text-sm text-gray-600">
                  {Number(status.prizeAmount || 0) > 0
                    ? `Your prize was ${Number(status.prizeAmount || 0).toFixed(2)} USDT.`
                    : 'Better luck next time.'}
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleSpin}
                disabled={spinning || !status?.active}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-5 py-3 font-semibold text-white shadow-sm hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {spinning ? <Loader2 className="h-5 w-5 animate-spin" /> : <Gift className="h-5 w-5" />}
                {spinning ? 'Spinning...' : 'Spin Now'}
              </button>
            )}
          </div>
        </div>
      </div>

      {showResult && result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div className={`rounded-full p-3 ${hasWon ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                {hasWon ? <PartyPopper className="h-7 w-7" /> : <Gift className="h-7 w-7" />}
              </div>
              <button
                type="button"
                onClick={() => setShowResult(false)}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <h3 className="text-xl font-bold text-gray-900">
              {hasWon ? 'Congratulations!' : 'Better luck next time'}
            </h3>
            <p className="mt-2 text-gray-600">
              {hasWon
                ? `${Number(result.prizeAmount || 0).toFixed(2)} USDT has been added to your reserved wallet for upgrade.`
                : 'Your spin has been recorded.'}
            </p>
            <button
              type="button"
              onClick={() => setShowResult(false)}
              className="mt-6 w-full rounded-lg bg-teal-600 px-4 py-2 font-semibold text-white hover:bg-teal-700"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SpinWheel;
