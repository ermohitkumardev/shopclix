import React, { useEffect, useMemo, useState } from 'react';
import { Gift, RefreshCw, Search } from 'lucide-react';
import { adminApi } from '../../lib/adminApi';
import { useNotification } from '../ui/NotificationProvider';
import { useScrollToTopOnChange } from '../../hooks/useScrollToTopOnChange';
import { useNavigate } from 'react-router-dom';

interface LevelCountRow {
  tmlc_user_id: string;
  tmlc_sponsorship_number: string;
  tmlc_level1_count: number;
  tmlc_level2_count: number;
  tmlc_level3_count: number;
  tmlc_updated_at: string;
  total_count?: number;
  extra_level?: number | null;
  extra_level_count?: number | null;
  meets_any_milestone?: boolean;
  has_any_mlm_reward?: boolean;
  eligible_milestone_count?: number;
  unpaid_eligible_milestone_count?: number;
  user_name?: string;
}

const MLMLevelCounts: React.FC = () => {
  const notification = useNotification();
  const navigate = useNavigate();
  const [rows, setRows] = useState<LevelCountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [awardingSponsor, setAwardingSponsor] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [accountScope, setAccountScope] = useState<'real' | 'dummy' | 'all'>('real');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [extraLevel, setExtraLevel] = useState(4);
  const topRef = useScrollToTopOnChange([page], { smooth: true });

  const totalCount = rows[0]?.total_count ?? 0;
  const totalPages = useMemo(() => Math.max(1, Math.ceil(totalCount / pageSize)), [totalCount, pageSize]);

  const loadCounts = async () => {
    setLoading(true);
    try {
      const offset = (page - 1) * pageSize;
      const data = await adminApi.post<LevelCountRow[]>('admin-get-earning-level-counts', {
        searchTerm: searchTerm.trim() || null,
        accountScope,
        offset,
        limit: pageSize,
        extraLevel,
      });
      setRows(data || []);
    } catch (error: any) {
      notification.showError('Load Failed', error.message || 'Failed to load level counts');
    } finally {
      setLoading(false);
    }
  };

  const awardMilestoneRewards = async (sponsorshipNumber: string) => {
    const sponsor = String(sponsorshipNumber || '').trim();
    if (!sponsor) return;
    if (!confirm(`Award missing MLM milestone rewards for sponsor ${sponsor}?`)) return;
    setAwardingSponsor(sponsor);
    try {
      const result = await adminApi.post<{
        inserted?: Array<{ milestoneId: string; title: string; amount: number }>;
        insertedAmount?: number;
      }>('admin-award-mlm-milestone-rewards', { sponsorshipNumber: sponsor });

      const insertedCount = Array.isArray(result?.inserted) ? result.inserted.length : 0;
      const insertedAmount = Number(result?.insertedAmount || 0);
      notification.showSuccess(
        'Rewards checked',
        insertedCount > 0 ? `Credited ${insertedAmount} USDT across ${insertedCount} milestone(s).` : 'No missing milestone rewards found.'
      );
      loadCounts();
    } catch (error: any) {
      notification.showError('Award Failed', error.message || 'Failed to award milestone rewards');
    } finally {
      setAwardingSponsor(null);
    }
  };

  useEffect(() => {
    loadCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, extraLevel, accountScope]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, pageSize, extraLevel, accountScope]);

  useEffect(() => {
    loadCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  const canPrev = page > 1;
  const canNext = page < totalPages;
  const extraLevelUnavailable = useMemo(() => {
    if (extraLevel <= 3) return false;
    if (!rows || rows.length === 0) return false;
    return rows.every((row) => row.extra_level_count === null || row.extra_level_count === undefined);
  }, [extraLevel, rows]);

  const viewCustomerDetails = (row: LevelCountRow) => {
    const userId = String(row?.tmlc_user_id || '').trim();
    const sponsor = String(row?.tmlc_sponsorship_number || '').trim();
    if (!userId) return;
    const params = new URLSearchParams();
    params.set('tab', 'customers');
    params.set('customerId', userId);
    if (sponsor) params.set('search', sponsor);
    navigate(`/backpanel/dashboard?${params.toString()}`);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
      <div ref={topRef} />
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Level Counts</h3>
          <p className="text-sm text-gray-600">Paginated MLM level counts for sponsors</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadCounts}
            className="flex items-center space-x-2 px-3 py-2 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100"
            disabled={loading}
          >
            <RefreshCw className="h-4 w-4" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row lg:flex-wrap lg:items-center gap-3">
        <div className="w-full lg:w-60">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-gray-400" />
            </div>
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by sponsor id..."
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
        <div className="w-full lg:w-40">
          <select
            value={accountScope}
            onChange={(e) => setAccountScope(e.target.value as 'real' | 'dummy' | 'all')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            title="Filter dummy/fake accounts"
          >
            <option value="real">Real Only</option>
            <option value="dummy">Dummy Only</option>
            <option value="all">All Accounts</option>
          </select>
        </div>
        <div className="w-full lg:w-28">
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
        <div className="w-full lg:w-36">
          <select
            value={extraLevel}
            onChange={(e) => setExtraLevel(Number(e.target.value))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            title="Select a level to display its count"
          >
            {Array.from({ length: 47 }).map((_, idx) => {
              const level = idx + 4;
              return (
                <option key={level} value={level}>
                  Level {level}
                </option>
              );
            })}
          </select>
        </div>
        <div className="flex items-center justify-end gap-2 lg:ml-auto">
          <button
            onClick={() => setPage(1)}
            className="px-3 py-2 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 disabled:opacity-50"
            disabled={loading || !canPrev}
          >
            First
          </button>
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-2 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 disabled:opacity-50"
            disabled={loading || !canPrev}
          >
            Prev
          </button>
          <div className="text-sm text-gray-600 px-2">
            Page {page} / {totalPages}
          </div>
          <button
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-2 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 disabled:opacity-50"
            disabled={loading || !canNext}
          >
            Next
          </button>
          <button
            onClick={() => setPage(totalPages)}
            className="px-3 py-2 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 disabled:opacity-50"
            disabled={loading || !canNext}
          >
            Last
          </button>
        </div>
      </div>

      {extraLevelUnavailable && (
        <div className="border border-yellow-200 bg-yellow-50 text-yellow-800 rounded-lg px-4 py-2 text-sm">
          Level {extraLevel} values are not available from the API yet. Deploy the latest DB migration and edge function updates, then refresh.
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User ID</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User Name</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Level 1</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Level 2</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Level 3</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Level {extraLevel}</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-gray-500">Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-gray-500">No counts found.</td></tr>
            ) : (
              rows.map((row) => (
                <tr key={row.tmlc_user_id}>
                  <td className="px-4 py-3 text-sm text-gray-700 font-mono">{row.tmlc_sponsorship_number}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{row.user_name || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{row.tmlc_level1_count}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{row.tmlc_level2_count}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{row.tmlc_level3_count}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{row.extra_level_count ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => viewCustomerDetails(row)}
                        className="inline-flex items-center px-3 py-1.5 bg-gray-50 text-gray-700 rounded hover:bg-gray-100 disabled:opacity-50"
                        disabled={!row.tmlc_user_id}
                        title="View customer details"
                      >
                        View
                      </button>
                      {row.meets_any_milestone && Number(row.unpaid_eligible_milestone_count || 0) > 0 ? (
                        <button
                          onClick={() => awardMilestoneRewards(row.tmlc_sponsorship_number)}
                          className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-50 text-green-700 rounded hover:bg-green-100 disabled:opacity-50"
                          disabled={loading || awardingSponsor === row.tmlc_sponsorship_number}
                          title={`Award ${row.unpaid_eligible_milestone_count} missing milestone reward${row.unpaid_eligible_milestone_count === 1 ? '' : 's'}`}
                        >
                          <Gift className="h-4 w-4" />
                          <span>{awardingSponsor === row.tmlc_sponsorship_number ? 'Checking…' : 'Award'}</span>
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">N/A</span>
                      )}

                      
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-gray-500">
        Total: {totalCount} sponsor{totalCount === 1 ? '' : 's'}
      </div>
    </div>
  );
};

export default MLMLevelCounts;
