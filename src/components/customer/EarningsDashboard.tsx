import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../ui/NotificationProvider';
import { ArrowDownLeft, ArrowUpRight, Clock, RefreshCw } from 'lucide-react';

interface Transaction {
  twt_id: string;
  twt_transaction_type: 'credit' | 'debit' | 'transfer';
  twt_amount: number | string;
  twt_currency: string;
  twt_status: 'pending' | 'completed' | 'failed' | 'cancelled';
  twt_created_at: string;
}

const EarningsDashboard: React.FC = () => {
  const { user } = useAuth();
  const notification = useNotification();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletReservedBalance, setWalletReservedBalance] = useState(0);
  const [reservedWithdrawals, setReservedWithdrawals] = useState(0);
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  const toAmount = (value: unknown) => {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
  };

  useEffect(() => {
    if (user?.id) {
      setTransactions([]);
      setWalletBalance(0);
      setWalletReservedBalance(0);
      setReservedWithdrawals(0);
      setLoading(true);
      loadTransactions();
      loadWalletBalance();
      loadReservedWithdrawals();
    } else {
      setTransactions([]);
      setWalletBalance(0);
      setWalletReservedBalance(0);
      setReservedWithdrawals(0);
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (dateFrom && dateTo && dateFrom > dateTo) {
      setDateTo(dateFrom);
    }
  }, [dateFrom, dateTo]);

  const loadTransactions = async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase
        .from('tbl_wallet_transactions')
        .select('twt_id, twt_transaction_type, twt_amount, twt_currency, twt_status, twt_created_at')
        .eq('twt_user_id', user.id)
        .eq('twt_status', 'completed')
        .order('twt_created_at', { ascending: false })
        .limit(1000);

      if (error) throw error;
      setTransactions(data || []);
    } catch (error) {
      console.error('Failed to load earnings transactions:', error);
      notification.showError('Error', 'Failed to load earnings data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadWalletBalance = async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase
        .from('tbl_wallets')
        .select('tw_balance, tw_reserved_balance')
        .eq('tw_user_id', user.id)
        .eq('tw_currency', 'USDT')
        .eq('tw_wallet_type', 'working')
        .maybeSingle();

      if (error) throw error;
      setWalletBalance(toAmount((data as any)?.tw_balance));
      setWalletReservedBalance(toAmount((data as any)?.tw_reserved_balance));
    } catch (error) {
      console.error('Failed to load wallet balance:', error);
    }
  };

  const loadReservedWithdrawals = async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase
        .from('tbl_withdrawal_requests')
        .select('twr_amount, twr_status')
        .eq('twr_user_id', user.id)
        .eq('twr_wallet_type', 'working')
        .in('twr_status', ['pending', 'processing', 'approved']);

      if (error) throw error;
      const total = (data || []).reduce((sum: number, row: any) => sum + toAmount(row.twr_amount), 0);
      setReservedWithdrawals(total);
    } catch (error) {
      console.error('Failed to load reserved withdrawals:', error);
    }
  };

  const withdrawableBalance = useMemo(() => {
    return Math.max(0, walletBalance - walletReservedBalance - reservedWithdrawals);
  }, [walletBalance, walletReservedBalance, reservedWithdrawals]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadTransactions(), loadWalletBalance(), loadReservedWithdrawals()]);
  };

  const filteredTransactions = useMemo(() => {
    const start = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
    const end = dateTo ? new Date(`${dateTo}T23:59:59.999`) : null;
    return transactions.filter(tx => {
      const txDate = new Date(tx.twt_created_at);
      if (start && txDate < start) return false;
      if (end && txDate > end) return false;
      return true;
    });
  }, [transactions, dateFrom, dateTo]);

  const allTimeCredits = useMemo(() => {
    return transactions
      .filter(t => t.twt_transaction_type === 'credit')
      .reduce((sum, t) => sum + toAmount(t.twt_amount), 0);
  }, [transactions]);

  const allTimeDebits = useMemo(() => {
    return transactions
      .filter(t => t.twt_transaction_type === 'debit')
      .reduce((sum, t) => sum + toAmount(t.twt_amount), 0);
  }, [transactions]);

  const todayCredits = useMemo(() => {
    const today = new Date().toDateString();
    return transactions
      .filter(t => t.twt_transaction_type === 'credit' && new Date(t.twt_created_at).toDateString() === today)
      .reduce((sum, t) => sum + toAmount(t.twt_amount), 0);
  }, [transactions]);

  const monthCredits = useMemo(() => {
    const now = new Date();
    return transactions
      .filter(t => t.twt_transaction_type === 'credit')
      .filter(t => {
        const d = new Date(t.twt_created_at);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      })
      .reduce((sum, t) => sum + toAmount(t.twt_amount), 0);
  }, [transactions]);

  const rangeCredits = useMemo(() => {
    return filteredTransactions
      .filter(t => t.twt_transaction_type === 'credit')
      .reduce((sum, t) => sum + toAmount(t.twt_amount), 0);
  }, [filteredTransactions]);

  const rangeDebits = useMemo(() => {
    return filteredTransactions
      .filter(t => t.twt_transaction_type === 'debit')
      .reduce((sum, t) => sum + toAmount(t.twt_amount), 0);
  }, [filteredTransactions]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="h-8 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Earnings</h3>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="bg-indigo-100 text-indigo-700 p-2 rounded-lg hover:bg-indigo-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-green-50 p-4 rounded-lg">
          <div className="flex items-center space-x-2">
            <ArrowUpRight className="h-5 w-5 text-green-600" />
            <span className="text-sm font-medium text-green-800">Total Earnings</span>
          </div>
          <p className="text-2xl font-bold text-green-600 mt-2">{allTimeCredits.toFixed(2)} USDT</p>
        </div>
        <div className="bg-indigo-50 p-4 rounded-lg">
          <div className="flex items-center space-x-2">
            <Clock className="h-5 w-5 text-indigo-600" />
            <span className="text-sm font-medium text-indigo-800">Today&apos;s Earnings</span>
          </div>
          <p className="text-2xl font-bold text-indigo-600 mt-2">{todayCredits.toFixed(2)} USDT</p>
        </div>
        <div className="bg-red-50 p-4 rounded-lg">
          <div className="flex items-center space-x-2">
            <ArrowDownLeft className="h-5 w-5 text-red-600" />
            <span className="text-sm font-medium text-red-800">Total Debited</span>
          </div>
          <p className="text-2xl font-bold text-red-600 mt-2">{allTimeDebits.toFixed(2)} USDT</p>
        </div>
        <div className="bg-yellow-50 p-4 rounded-lg">
          <div className="flex items-center space-x-2">
            <Clock className="h-5 w-5 text-yellow-600" />
            <span className="text-sm font-medium text-yellow-800">Reserved (For Upgrade)</span>
          </div>
          <p className="text-2xl font-bold text-yellow-700 mt-2">{walletReservedBalance.toFixed(2)} USDT</p>
        </div>
        <div className="bg-blue-50 p-4 rounded-lg">
          <div className="flex items-center space-x-2">
            <Clock className="h-5 w-5 text-blue-600" />
            <span className="text-sm font-medium text-blue-800">Pending Withdrawals</span>
          </div>
          <p className="text-2xl font-bold text-blue-600 mt-2">{reservedWithdrawals.toFixed(2)} USDT</p>
        </div>
        <div className="bg-indigo-50 p-4 rounded-lg">
          <div className="flex items-center space-x-2">
            <Clock className="h-5 w-5 text-indigo-600" />
            <span className="text-sm font-medium text-indigo-800">Withdrawable</span>
          </div>
          <p className="text-2xl font-bold text-indigo-600 mt-2">{withdrawableBalance.toFixed(2)} USDT</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6">
        <h4 className="text-lg font-semibold text-gray-900 mb-4">Date Range</h4>
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          <div className="flex flex-col">
            <label className="text-sm text-gray-600 mb-1">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-sm text-gray-600 mb-1">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() - 6);
                setDateFrom(d.toISOString().slice(0, 10));
                setDateTo(new Date().toISOString().slice(0, 10));
              }}
              className="px-3 py-2 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200"
            >
              Last 7 Days
            </button>
            <button
              onClick={() => {
                const now = new Date();
                const first = new Date(now.getFullYear(), now.getMonth(), 1);
                setDateFrom(first.toISOString().slice(0, 10));
                setDateTo(new Date().toISOString().slice(0, 10));
              }}
              className="px-3 py-2 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200"
            >
              This Month
            </button>
            <button
              onClick={() => {
                setDateFrom('');
                setDateTo('');
              }}
              className="px-3 py-2 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200"
            >
              All Time
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6">
        <h4 className="text-lg font-semibold text-gray-900 mb-4">Date Range Summary</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-green-50 p-4 rounded-lg">
            <div className="flex items-center space-x-2">
              <ArrowUpRight className="h-5 w-5 text-green-600" />
              <span className="text-sm font-medium text-green-800">Range Credits</span>
            </div>
            <p className="text-2xl font-bold text-green-600 mt-2">{rangeCredits.toFixed(2)} USDT</p>
          </div>
          <div className="bg-red-50 p-4 rounded-lg">
            <div className="flex items-center space-x-2">
              <ArrowDownLeft className="h-5 w-5 text-red-600" />
              <span className="text-sm font-medium text-red-800">Range Debits</span>
            </div>
            <p className="text-2xl font-bold text-red-600 mt-2">{rangeDebits.toFixed(2)} USDT</p>
          </div>
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="flex items-center space-x-2">
              <Clock className="h-5 w-5 text-blue-600" />
              <span className="text-sm font-medium text-blue-800">Range Count</span>
            </div>
            <p className="text-2xl font-bold text-blue-600 mt-2">{filteredTransactions.length}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EarningsDashboard;
