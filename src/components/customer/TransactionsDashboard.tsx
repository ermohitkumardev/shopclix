import React, { useMemo, useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../ui/NotificationProvider';
import { useScrollToTopOnChange } from '../../hooks/useScrollToTopOnChange';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
    DollarSign,
    ArrowUpRight,
    ArrowDownLeft,
    ExternalLink,
    RefreshCw,
    Gift,
    Share2,
    Calendar
} from 'lucide-react';

interface Transaction {
    twt_id: string;
    twt_transaction_type: 'credit' | 'debit' | 'transfer';
    twt_amount: number;
    twt_currency: string;
    twt_description: string;
    twt_reference_type?: string;
    twt_reference_id?: string;
    twt_blockchain_hash?: string;
    twt_status: 'pending' | 'completed' | 'failed' | 'cancelled';
    twt_created_at: string;
}

const TransactionsDashboard: React.FC = () => {
    const { user } = useAuth();
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [walletBalance, setWalletBalance] = useState(0);
    const [walletReservedBalance, setWalletReservedBalance] = useState(0);
    const [pendingWithdrawalTotal, setPendingWithdrawalTotal] = useState(0);
    const [dateFrom, setDateFrom] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() - 6);
        return d.toISOString().slice(0, 10);
    });
    const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [totalCount, setTotalCount] = useState(0);
    const notification = useNotification();
    const topRef = useScrollToTopOnChange([currentPage], { smooth: true });

    useEffect(() => {
        if (user?.id) {
            setWalletBalance(0);
            setWalletReservedBalance(0);
            setPendingWithdrawalTotal(0);
            loadWalletBalance();
            loadPendingWithdrawals();
        } else {
            setWalletBalance(0);
            setWalletReservedBalance(0);
            setPendingWithdrawalTotal(0);
        }
    }, [user?.id]);

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
            setWalletBalance(Number(data?.tw_balance ?? 0));
            setWalletReservedBalance(Number((data as any)?.tw_reserved_balance ?? 0));
        } catch (error) {
            console.error('Failed to load wallet balance:', error);
        }
    };

    const loadPendingWithdrawals = async () => {
        if (!user?.id) return;
        try {
            const { data, error } = await supabase
                .from('tbl_withdrawal_requests')
                .select('twr_amount, twr_status')
                .eq('twr_user_id', user.id)
                .eq('twr_wallet_type', 'working')
                .in('twr_status', ['pending', 'processing', 'approved']);
            if (error) throw error;
            const total = (data || []).reduce((sum: number, row: any) => sum + Number(row.twr_amount || 0), 0);
            setPendingWithdrawalTotal(total);
        } catch (error) {
            console.error('Failed to load pending withdrawals:', error);
        }
    };

    const loadTransactions = async () => {
        if (!user?.id) return;

        try {
            const from = (currentPage - 1) * pageSize;
            const to = from + pageSize - 1;

            let query = supabase
                .from('tbl_wallet_transactions')
                .select('*', { count: 'exact' })
                .eq('twt_user_id', user.id)
                .order('twt_created_at', { ascending: false });

            if (dateFrom) {
                query = query.gte('twt_created_at', new Date(`${dateFrom}T00:00:00`).toISOString());
            }
            if (dateTo) {
                query = query.lte('twt_created_at', new Date(`${dateTo}T23:59:59.999`).toISOString());
            }

            const { data, error, count } = await query.range(from, to);

            if (error) throw error;
            setTransactions(data || []);
            setTotalCount(Number(count || 0));
        } catch (error) {
            console.error('Failed to load transactions:', error);
            notification.showError('Error', 'Failed to load transactions');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const handleRefresh = async () => {
        setRefreshing(true);
        await Promise.all([loadTransactions(), loadWalletBalance(), loadPendingWithdrawals()]);
    };

    useEffect(() => {
        if (dateFrom && dateTo && dateFrom > dateTo) {
            setDateTo(dateFrom);
        }
    }, [dateFrom, dateTo]);

    useEffect(() => {
        setCurrentPage(1);
    }, [dateFrom, dateTo, pageSize]);

    useEffect(() => {
        if (!user?.id) {
            setTransactions([]);
            setTotalCount(0);
            setLoading(false);
            setRefreshing(false);
            return;
        }
        setTransactions([]);
        setTotalCount(0);
        setLoading(true);
        loadTransactions();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id, currentPage, pageSize, dateFrom, dateTo]);

    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const clampedPage = Math.min(currentPage, totalPages);
    const pageStart = (clampedPage - 1) * pageSize;
    const pageEnd = Math.min(pageStart + pageSize, totalCount);
    const pagedTransactions = transactions;

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    const handleDownloadPdf = () => {
        try {
            const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
            const title = 'Transaction History';
            const rangeLabel = `${dateFrom || 'All'} to ${dateTo || 'All'}`;

            doc.setFontSize(16);
            doc.text(title, 40, 40);
            doc.setFontSize(11);
            doc.setTextColor(100);
            doc.text(`Date range: ${rangeLabel}`, 40, 60);

            const tableBody = pagedTransactions.map(tx => ([
                new Date(tx.twt_created_at).toLocaleDateString(),
                new Date(tx.twt_created_at).toLocaleTimeString(),
                tx.twt_description,
                tx.twt_reference_type ? tx.twt_reference_type.replace('_', ' ') : '-',
                tx.twt_transaction_type,
                `${tx.twt_transaction_type === 'credit' ? '+' : '-'}${tx.twt_amount} ${tx.twt_currency || 'USDT'}`,
                tx.twt_status
            ]));

            autoTable(doc, {
                startY: 80,
                head: [[
                    'Date',
                    'Time',
                    'Description',
                    'Reference',
                    'Type',
                    'Amount',
                    'Status'
                ]],
                body: tableBody,
                styles: { fontSize: 9 },
                headStyles: { fillColor: [79, 70, 229] }
            });

            const fileName = `transactions_${(dateFrom || 'all')}_to_${(dateTo || 'all')}.pdf`;
            doc.save(fileName);
        } catch (error) {
            console.error('Failed to generate PDF:', error);
            notification.showError('Error', 'Failed to generate PDF. Please try again.');
        }
    };

    const getTransactionIcon = (type: string, referenceType?: string) => {
        if (
            referenceType === 'task_reward' ||
            referenceType === 'coupon_share' ||
            referenceType === 'registration_parent_income' ||
            referenceType === 'mlm_level_reward' ||
            referenceType === 'mlm_level_reward_reserved'
        ) return Gift;
        if (referenceType === 'social_share') return Share2;
        return type === 'credit' ? ArrowUpRight : ArrowDownLeft;
    };

    const groupedTransactions = useMemo(() => {
        const map = new Map<string, Transaction[]>();
        for (const transaction of pagedTransactions) {
            const dateKey = new Date(transaction.twt_created_at).toLocaleDateString();
            const list = map.get(dateKey) || [];
            list.push(transaction);
            map.set(dateKey, list);
        }
        return Array.from(map.entries());
    }, [pagedTransactions]);
    const withdrawableBalance = useMemo(() => {
        return Math.max(0, Number(walletBalance || 0) - Number(walletReservedBalance || 0) - Number(pendingWithdrawalTotal || 0));
    }, [walletBalance, walletReservedBalance, pendingWithdrawalTotal]);

    const getDisplayDescription = (transaction: Transaction) => {
        const referenceType = transaction.twt_reference_type || '';
        if (referenceType === 'registration_parent_income') {
            const sponsor = transaction.twt_description.match(/Sponsorship\s+([A-Za-z0-9-]+)/i)?.[1];
            return sponsor ? `Direct income #${sponsor}` : 'Direct income';
        }
        if (referenceType === 'registration_parent_income_reserved') {
            const sponsor = transaction.twt_description.match(/Sponsorship\s+([A-Za-z0-9-]+)/i)?.[1];
            return sponsor ? `Reserved direct income #${sponsor}` : 'Reserved direct income';
        }
        if (referenceType === 'mlm_level_reward') {
            return 'Level reward';
        }
        if (referenceType === 'mlm_level_reward_reserved') {
            return 'Reserved level reward';
        }
        return transaction.twt_description;
    };

    const getReferenceLabel = (referenceType?: string) => {
        switch (referenceType) {
            case 'registration_parent_income':
                return 'Direct';
            case 'registration_parent_income_reserved':
                return 'Reserved';
            case 'mlm_level_reward':
                return 'Reward';
            case 'mlm_level_reward_reserved':
                return 'Reserved reward';
            case 'task_reward':
                return 'Task';
            case 'coupon_share':
                return 'Coupon';
            case 'social_share':
                return 'Social';
            case 'withdrawal':
                return 'Withdrawal';
            default:
                return referenceType ? referenceType.replace(/_/g, ' ') : '';
        }
    };

    if (loading) {
        return (
            <div className="space-y-6">
                <div className="bg-white rounded-xl shadow-sm p-6">
                    <div className="animate-pulse">
                        <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
                        <div className="h-8 bg-gray-200 rounded w-1/2"></div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div ref={topRef} />
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex flex-col">
                    <h3 className="text-lg font-semibold text-gray-900">Transaction History</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">
                            Available: {withdrawableBalance.toFixed(2)} USDT
                        </span>
                        <span className="text-xs text-gray-500">Total: {walletBalance.toFixed(2)} USDT</span>
                        {pendingWithdrawalTotal > 0 && (
                            <span className="text-xs text-gray-500">Reserved: {pendingWithdrawalTotal.toFixed(2)} USDT</span>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleRefresh}
                        disabled={refreshing}
                        className="bg-indigo-100 text-indigo-700 p-2 rounded-lg hover:bg-indigo-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Date Range Filters */}
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
                        <div className="flex items-center gap-2">
                            <label className="text-sm text-gray-600">Page size</label>
                            <select
                                value={pageSize}
                                onChange={(e) => setPageSize(Number(e.target.value))}
                                className="border border-gray-200 rounded-lg px-2 py-1 text-sm"
                            >
                                <option value={10}>10</option>
                                <option value={20}>20</option>
                                <option value={50}>50</option>
                            </select>
                        </div>
                        <div className="text-sm text-gray-500">
                            Total: {totalCount} transaction{totalCount === 1 ? '' : 's'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Full Transaction History */}
            <div className="bg-white rounded-xl shadow-sm p-6">
                <h4 className="text-lg font-semibold text-gray-900 mb-4">All Transactions</h4>

                {groupedTransactions.length > 0 ? (
                    <div className="space-y-6">
                        {groupedTransactions.map(([date, dateTransactions]) => (
                            <div key={date}>
                                <div className="flex items-center space-x-2 mb-4">
                                    <Calendar className="h-4 w-4 text-gray-400" />
                                    <h5 className="font-medium text-gray-700">{date}</h5>
                                </div>

                                <div className="space-y-3">
                                    {dateTransactions.map((transaction) => {
                                        const Icon = getTransactionIcon(transaction.twt_transaction_type, transaction.twt_reference_type);
                                        const displayDescription = getDisplayDescription(transaction);
                                        return (
                                            <div key={transaction.twt_id} className="border border-gray-200 rounded-lg p-3 sm:p-4 hover:shadow-md transition-shadow overflow-hidden">
                                                <div className="grid grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)_auto] gap-2.5 sm:gap-4 items-start">
                                                    <div className={`p-2.5 sm:p-3 rounded-full shrink-0 ${
                                                            transaction.twt_transaction_type === 'credit' ? 'bg-green-100' : 'bg-red-100'
                                                        }`}>
                                                        <Icon className={`h-4 w-4 sm:h-5 sm:w-5 ${
                                                            transaction.twt_transaction_type === 'credit' ? 'text-green-600' : 'text-red-600'
                                                        }`} />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <h5 className="font-medium text-sm sm:text-base text-gray-900 break-words leading-snug">{displayDescription}</h5>
                                                        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 mt-1 min-w-0">
                                                            <span className="text-xs sm:text-sm text-gray-500">
                                                                {new Date(transaction.twt_created_at).toLocaleString()}
                                                            </span>
                                                            {transaction.twt_reference_type && (
                                                                <span className="w-fit max-w-full text-[11px] sm:text-xs bg-gray-100 text-gray-600 px-2 py-0.5 sm:py-1 rounded-full break-words leading-tight">
                                                                    {getReferenceLabel(transaction.twt_reference_type)}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="col-span-2 sm:col-span-1 sm:w-24 flex items-center justify-between gap-3 border-t border-gray-100 pt-2.5 sm:block sm:border-t-0 sm:pt-0 sm:text-right shrink-0">
                                                        <div className={`text-sm sm:text-lg font-bold leading-tight break-words ${
                                                            transaction.twt_transaction_type === 'credit' ? 'text-green-600' : 'text-red-600'
                                                        }`}>
                                                            {transaction.twt_transaction_type === 'credit' ? '+' : '-'}{transaction.twt_amount} USDT
                                                        </div>
                                                        <span className={`inline-flex sm:mt-2 text-[11px] sm:text-xs px-2 py-0.5 sm:py-1 rounded-full font-medium ${
                                                            transaction.twt_status === 'completed' ? 'bg-green-100 text-green-800' :
                                                                transaction.twt_status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                                                                    'bg-red-100 text-red-800'
                                                        }`}>
                                                            {transaction.twt_status}
                                                        </span>
                                                    </div>
                                                </div>
                                                {transaction.twt_blockchain_hash && (
                                                    <div className="mt-3 pt-3 border-t border-gray-200">
                                                        <div className="flex items-center space-x-2">
                                                            <span className="text-xs text-gray-500">Blockchain Hash:</span>
                                                            <code className="text-xs bg-gray-100 px-2 py-1 rounded font-mono">
                                                                {transaction.twt_blockchain_hash.slice(0, 10)}...{transaction.twt_blockchain_hash.slice(-8)}
                                                            </code>
                                                            <button
                                                                onClick={() => window.open(`https://testnet.bscscan.com/tx/${transaction.twt_blockchain_hash}`, '_blank')}
                                                                className="text-blue-600 hover:text-blue-800"
                                                            >
                                                                <ExternalLink className="h-3 w-3" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 pt-4 border-t border-gray-200">
                            <div className="text-sm text-gray-500">
                                Page {clampedPage} of {totalPages} • Showing {totalCount === 0 ? 0 : pageStart + 1}–{pageEnd} of {totalCount}
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setCurrentPage(1)}
                                    disabled={clampedPage === 1}
                                    className="px-3 py-2 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                                >
                                    First
                                </button>
                                <button
                                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                    disabled={clampedPage === 1}
                                    className="px-3 py-2 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                                >
                                    Prev
                                </button>
                                <button
                                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                                    disabled={clampedPage === totalPages}
                                    className="px-3 py-2 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                                >
                                    Next
                                </button>
                                <button
                                    onClick={() => setCurrentPage(totalPages)}
                                    disabled={clampedPage === totalPages}
                                    className="px-3 py-2 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                                >
                                    Last
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="text-center py-12">
                        <DollarSign className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 mb-2">No transactions yet</h3>
                        <p className="text-gray-600">Complete daily tasks to start earning USDT rewards!</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TransactionsDashboard;
