import React, { useEffect, useMemo, useState } from 'react';
import { adminApi } from '../../lib/adminApi';
import { useNotification } from '../ui/NotificationProvider';
import {
  Calendar,
  Gift,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Trophy,
} from 'lucide-react';

type Campaign = {
  tswc_id: string;
  tswc_name: string;
  tswc_is_enabled: boolean;
  tswc_start_at: string | null;
  tswc_end_at: string | null;
};

type UserOption = {
  tu_id: string;
  tu_email: string;
  tu_user_type: 'customer' | 'company' | 'admin';
  tup_first_name?: string;
  tup_last_name?: string;
  company_name?: string;
};

type Assignment = {
  tswa_id: string;
  tswa_user_id: string;
  tswa_prize_amount: number;
  tswa_created_at: string;
  tbl_users?: {
    tu_email?: string;
    tbl_user_profiles?: Array<{ tup_first_name?: string; tup_last_name?: string }>;
  };
};

type Spin = {
  tsws_id: string;
  tsws_user_id: string;
  tsws_prize_amount: number;
  tsws_outcome: 'prize' | 'better_luck';
  tsws_created_at: string;
  tbl_users?: {
    tu_email?: string;
    tbl_user_profiles?: Array<{ tup_first_name?: string; tup_last_name?: string }>;
  };
};

const toInputDateTime = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

const toServerTimestamp = (value: string) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const getUserName = (row?: { tbl_users?: Assignment['tbl_users'] }) => {
  const profile = row?.tbl_users?.tbl_user_profiles?.[0];
  const name = `${profile?.tup_first_name || ''} ${profile?.tup_last_name || ''}`.trim();
  return name || row?.tbl_users?.tu_email || 'Customer';
};

const SpinWheelManagement: React.FC = () => {
  const notification = useNotification();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [spins, setSpins] = useState<Spin[]>([]);
  const [name, setName] = useState('Launch Spin Wheel');
  const [isEnabled, setIsEnabled] = useState(false);
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserOption | null>(null);
  const [prizeAmount, setPrizeAmount] = useState('');
  const [searching, setSearching] = useState(false);

  const prizeTotal = useMemo(
    () => assignments.reduce((sum, item) => sum + Number(item.tswa_prize_amount || 0), 0),
    [assignments]
  );

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await adminApi.post<{
        campaign: Campaign | null;
        assignments: Assignment[];
        spins: Spin[];
      }>('admin-spin-wheel', { action: 'get' });

      setCampaign(data.campaign);
      setAssignments(data.assignments || []);
      setSpins(data.spins || []);
      setName(data.campaign?.tswc_name || 'Launch Spin Wheel');
      setIsEnabled(Boolean(data.campaign?.tswc_is_enabled));
      setStartAt(toInputDateTime(data.campaign?.tswc_start_at));
      setEndAt(toInputDateTime(data.campaign?.tswc_end_at));
    } catch (error: any) {
      console.error('Failed to load spin wheel settings:', error);
      notification.showError('Error', error?.message || 'Failed to load spin wheel settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    const query = userSearch.trim();

    if (query.length < 3 || selectedUser) {
      setUsers([]);
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        setSearching(true);
        const results = await adminApi.post<UserOption[]>('admin-search-users', { query });
        if (!cancelled) {
          setUsers((results || []).filter((user) => user.tu_user_type === 'customer'));
        }
      } catch (error) {
        if (!cancelled) setUsers([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [userSearch, selectedUser]);

  const handleSaveCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      await adminApi.post('admin-spin-wheel', {
        action: 'save_campaign',
        name,
        isEnabled,
        startAt: toServerTimestamp(startAt),
        endAt: toServerTimestamp(endAt),
      });
      notification.showSuccess('Saved', 'Spin wheel campaign settings updated.');
      await loadData();
    } catch (error: any) {
      notification.showError('Error', error?.message || 'Failed to save campaign.');
    } finally {
      setSaving(false);
    }
  };

  const handleAssignPrize = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) {
      notification.showError('Customer required', 'Select a customer before assigning a prize.');
      return;
    }

    try {
      setSaving(true);
      await adminApi.post('admin-spin-wheel', {
        action: 'assign_prize',
        userId: selectedUser.tu_id,
        prizeAmount: Number(prizeAmount || 0),
      });
      notification.showSuccess('Prize assigned', 'The customer will land on this amount when spinning.');
      setSelectedUser(null);
      setUserSearch('');
      setPrizeAmount('');
      await loadData();
    } catch (error: any) {
      notification.showError('Error', error?.message || 'Failed to assign prize.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAssignment = async (assignmentId: string) => {
    if (!confirm('Remove this spin wheel prize assignment?')) return;

    try {
      setSaving(true);
      await adminApi.post('admin-spin-wheel', { action: 'delete_assignment', assignmentId });
      notification.showSuccess('Removed', 'Prize assignment removed.');
      await loadData();
    } catch (error: any) {
      notification.showError('Error', error?.message || 'Failed to remove assignment.');
    } finally {
      setSaving(false);
    }
  };

  const selectUser = (user: UserOption) => {
    const displayName = `${user.tup_first_name || ''} ${user.tup_last_name || ''}`.trim();
    setSelectedUser(user);
    setUserSearch(`${displayName || user.tu_email} (${user.tu_email})`);
    setUsers([]);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-100 p-2 text-blue-700">
              <Gift className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Status</p>
              <p className="text-lg font-semibold text-gray-900">{isEnabled ? 'Enabled' : 'Disabled'}</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-100 p-2 text-green-700">
              <Trophy className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Assigned Prizes</p>
              <p className="text-lg font-semibold text-gray-900">{prizeTotal.toFixed(2)} USDT</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-purple-100 p-2 text-purple-700">
              <RefreshCw className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Completed Spins</p>
              <p className="text-lg font-semibold text-gray-900">{spins.length}</p>
            </div>
          </div>
        </div>
      </div>

      <form onSubmit={handleSaveCampaign} className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Campaign Settings</h3>
            <p className="text-sm text-gray-500">Available only after launch phase is set to Launch.</p>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => setIsEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Enabled
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Campaign Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Start Date</label>
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
              <input
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">End Date</label>
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
              <input
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
                className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Save Settings
          </button>
        </div>
      </form>

      <form onSubmit={handleAssignPrize} className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="mb-5 text-lg font-semibold text-gray-900">Assign Customer Prize</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_180px_auto]">
          <div className="relative">
            <label className="mb-2 block text-sm font-medium text-gray-700">Customer</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
              <input
                type="text"
                value={userSearch}
                onChange={(e) => {
                  setSelectedUser(null);
                  setUserSearch(e.target.value);
                }}
                placeholder="Search customer by name or email"
                className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
              />
              {searching && <Loader2 className="absolute right-3 top-2.5 h-5 w-5 animate-spin text-gray-400" />}
            </div>
            {users.length > 0 && (
              <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                {users.map((user) => {
                  const displayName = `${user.tup_first_name || ''} ${user.tup_last_name || ''}`.trim() || user.tu_email;
                  return (
                    <button
                      type="button"
                      key={user.tu_id}
                      onClick={() => selectUser(user)}
                      className="block w-full px-4 py-3 text-left hover:bg-gray-50"
                    >
                      <div className="font-medium text-gray-900">{displayName}</div>
                      <div className="text-sm text-gray-500">{user.tu_email}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Prize Amount</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={prizeAmount}
              onChange={(e) => setPrizeAmount(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-green-600 px-4 font-medium text-white hover:bg-green-700 disabled:opacity-60"
            >
              <Plus className="h-4 w-4" />
              Assign
            </button>
          </div>
        </div>
      </form>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-6 py-4">
            <h3 className="font-semibold text-gray-900">Prize Assignments</h3>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {assignments.length === 0 ? (
              <p className="p-6 text-sm text-gray-500">No customer prizes assigned yet.</p>
            ) : (
              assignments.map((assignment) => (
                <div key={assignment.tswa_id} className="flex items-center justify-between gap-4 border-b border-gray-100 px-6 py-4 last:border-b-0">
                  <div>
                    <p className="font-medium text-gray-900">{getUserName(assignment)}</p>
                    <p className="text-sm text-gray-500">{assignment.tbl_users?.tu_email}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-green-50 px-3 py-1 text-sm font-semibold text-green-700">
                      {Number(assignment.tswa_prize_amount || 0).toFixed(2)} USDT
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteAssignment(assignment.tswa_id)}
                      className="rounded-lg p-2 text-gray-500 hover:bg-red-50 hover:text-red-600"
                      title="Remove assignment"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-200 px-6 py-4">
            <h3 className="font-semibold text-gray-900">Recent Spins</h3>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {spins.length === 0 ? (
              <p className="p-6 text-sm text-gray-500">No spins completed yet.</p>
            ) : (
              spins.map((spin) => (
                <div key={spin.tsws_id} className="flex items-center justify-between gap-4 border-b border-gray-100 px-6 py-4 last:border-b-0">
                  <div>
                    <p className="font-medium text-gray-900">{getUserName(spin)}</p>
                    <p className="text-sm text-gray-500">{new Date(spin.tsws_created_at).toLocaleString()}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-sm font-semibold ${
                    spin.tsws_outcome === 'prize'
                      ? 'bg-green-50 text-green-700'
                      : 'bg-gray-100 text-gray-700'
                  }`}>
                    {spin.tsws_outcome === 'prize'
                      ? `${Number(spin.tsws_prize_amount || 0).toFixed(2)} USDT`
                      : 'Better luck'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {!campaign && (
        <p className="text-sm text-gray-500">
          Saving settings for the first time will create the spin wheel campaign.
        </p>
      )}
    </div>
  );
};

export default SpinWheelManagement;
