import React, { useState, useEffect } from 'react';
import { adminApi } from '../../lib/adminApi';
import { useNotification } from '../ui/NotificationProvider';
import { useAdminAuth } from '../../contexts/AdminAuthContext';
import { useScrollToTopOnChange } from '../../hooks/useScrollToTopOnChange';
import {
    Users, Search, Eye, CreditCard as Edit, UserCheck, UserX, Mail, Phone,
    Calendar, DollarSign, ArrowLeft, Save, X, CheckCircle, AlertCircle,
    CreditCard, User, Settings, ChevronLeft, ChevronRight, ChevronsLeft,
    ChevronsRight, MoreHorizontal, Key, Wallet, Activity, ArrowDownLeft, ArrowUpRight, LogIn
} from 'lucide-react';

let inFlightCustomersRequest: {
    key: string;
    promise: Promise<any[]>;
} | null = null;

interface Customer {
    tu_id: string;
    tu_email: string;
    tu_user_type: string;
    tu_is_verified: boolean;
    tu_email_verified: boolean;
    tu_mobile_verified: boolean;
    tu_registration_paid?: boolean;
    tu_is_active: boolean;
    is_active_member?: boolean;
    verification_complete?: boolean;
    tu_is_dummy?: boolean;
    tu_created_at: string;
    downline_level?: number;
    tbl_user_profiles: {
        tup_first_name: string;
        tup_last_name: string;
        tup_username: string;
        tup_mobile: string;
        tup_sponsorship_number: string;
        tup_gender: string;
        tup_parent_account?: string;
        tup_parent_name?: string | null;
        tup_parent_username?: string | null;
        tup_parent_sponsorship_number?: string | null;
    } | null;
}

interface Transaction {
    tp_id: string;
    tp_amount: number;
    tp_currency: string;
    tp_payment_method: string;
    tp_payment_status: string;
    tp_created_at: string;
    tp_gateway_response?: any;
    subscription?: {
        tus_id?: string;
        plan?: {
            tsp_name?: string;
            tsp_price?: number;
        };
    };
}

interface WalletConnection {
    tuwc_id: string;
    tuwc_wallet_address: string;
    tuwc_wallet_name?: string;
    tuwc_wallet_type?: string;
    tuwc_chain_id?: number | null;
    tuwc_is_default?: boolean;
    tuwc_is_active?: boolean;
    tuwc_last_connected_at?: string | null;
}

interface WalletTotals {
    walletBalance: number;
    withdrawableBalance: number;
    reservedWithdrawals: number;
    totalEarned: number;
    totalDebited: number;
}

interface WalletDetailsResponse {
    wallet: null | {
        tw_id: string;
        tw_balance: number;
        tw_currency: string;
        tw_created_at: string;
        tw_updated_at: string;
        tw_is_active: boolean;
    };
    walletConnections: WalletConnection[];
    totals: WalletTotals;
}

interface WalletTxn {
    twt_id: string;
    twt_wallet_id: string;
    twt_user_id: string;
    twt_transaction_type: 'credit' | 'debit' | 'transfer';
    twt_amount: number;
    twt_currency: string;
    twt_description: string;
    twt_reference_type?: string | null;
    twt_reference_id?: string | null;
    twt_status: string;
    twt_created_at: string;
    twt_blockchain_hash?: string | null;
}

// Skeleton Loader for Table Rows
const TableSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => {
    return (
        <>
            {Array.from({ length: rows }).map((_, index) => (
                <tr key={index} className="animate-pulse">
                    <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                            <div className="flex-shrink-0 h-10 w-10 bg-gray-200 rounded-full"></div>
                            <div className="ml-4">
                                <div className="h-4 bg-gray-200 rounded w-32 mb-2"></div>
                                <div className="h-3 bg-gray-200 rounded w-20 mb-1"></div>
                                <div className="h-3 bg-gray-200 rounded w-24"></div>
                            </div>
                        </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-32 mb-1"></div>
                        <div className="h-3 bg-gray-200 rounded w-28"></div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex space-x-2">
                            <div className="h-6 bg-gray-200 rounded-full w-16"></div>
                            <div className="h-6 bg-gray-200 rounded-full w-18"></div>
                        </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-6 bg-gray-200 rounded-full w-20"></div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-24"></div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex space-x-2">
                            <div className="h-8 w-8 bg-gray-200 rounded"></div>
                            <div className="h-8 w-8 bg-gray-200 rounded"></div>
                        </div>
                    </td>
                </tr>
            ))}
        </>
    );
};

// Loader Component
const Loader: React.FC = () => {
    return (
        <div className="flex flex-col items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <p className="text-gray-600">Loading customers...</p>
        </div>
    );
};

type CustomerManagementProps = {
    initialSearchTerm?: string;
    openCustomerId?: string;
};

const CustomerManagement: React.FC<CustomerManagementProps> = ({ initialSearchTerm, openCustomerId }) => {
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [loading, setLoading] = useState(true);
    const [listLoading, setListLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [parentAccountFilter, setParentAccountFilter] = useState('');
    const [levelFilter, setLevelFilter] = useState<'all' | string>('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [verificationFilter, setVerificationFilter] = useState('all');
    const [dummyFilter, setDummyFilter] = useState<'all' | 'real' | 'dummy'>('all');
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [showCustomerDetails, setShowCustomerDetails] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const [activeTab, setActiveTab] = useState('profile');
    const [impersonatingCustomerId, setImpersonatingCustomerId] = useState<string | null>(null);

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);
    const [totalCount, setTotalCount] = useState(0);

    const notification = useNotification();
    const { hasPermission } = useAdminAuth();
    const topRef = useScrollToTopOnChange([currentPage], { smooth: true });

    useEffect(() => {
        if (!initialSearchTerm) return;
        setSearchTerm(initialSearchTerm);
        setCurrentPage(1);
    }, [initialSearchTerm]);

    useEffect(() => {
        if (!openCustomerId) return;
        if (showCustomerDetails && selectedCustomer?.tu_id === openCustomerId) return;
        if (loading) return;
        const match = customers.find(c => c.tu_id === openCustomerId);
        if (match) {
            handleViewCustomer(match);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openCustomerId, customers, loading]);

    const loadCustomers = async () => {
        try {
            setLoading(true);
            setListLoading(true);
            setError(null);

            const offset = (currentPage - 1) * itemsPerPage;
            const requestPayload = {
                searchTerm: searchTerm || null,
                parentAccount: parentAccountFilter.trim() || null,
                levelFilter: levelFilter === 'all' ? null : Number(levelFilter),
                statusFilter,
                verificationFilter,
                dummyFilter,
                offset,
                limit: itemsPerPage
            };
            const requestKey = JSON.stringify(requestPayload);
            const requestPromise =
                inFlightCustomersRequest?.key === requestKey
                    ? inFlightCustomersRequest.promise
                    : adminApi.post<any[]>('admin-get-customers', requestPayload);

            if (inFlightCustomersRequest?.key !== requestKey) {
                inFlightCustomersRequest = {
                    key: requestKey,
                    promise: requestPromise
                };
            }

            const data = await requestPromise;

            if (data && data.length > 0) {
                const total = data[0]?.total_count || 0;
                const formattedCustomers = data.map((row: any) => ({
                    tu_id: row.tu_id,
                    tu_email: row.tu_email,
                    tu_user_type: row.tu_user_type,
                    tu_is_verified: row.tu_is_verified,
                    tu_email_verified: row.tu_email_verified,
                    tu_mobile_verified: row.tu_mobile_verified,
                    tu_registration_paid: row.tu_registration_paid ?? false,
                    tu_is_active: row.tu_is_active,
                    tu_is_dummy: row.tu_is_dummy ?? false,
                    tu_created_at: row.tu_created_at,
                    downline_level: row.downline_level ?? row.level ?? null,
                    tbl_user_profiles: row.profile_data
                }));
                setCustomers(formattedCustomers);
                setTotalCount(total);
            } else {
                setCustomers([]);
                setTotalCount(0);
            }
        } catch (error) {
            console.error('Failed to load customers:', error);
            setError('Failed to load customers. Please try again.');
            notification.showError('Load Failed', 'Failed to load customer data from database');
        } finally {
            const offset = (currentPage - 1) * itemsPerPage;
            const requestKey = JSON.stringify({
                searchTerm: searchTerm || null,
                parentAccount: parentAccountFilter.trim() || null,
                levelFilter: levelFilter === 'all' ? null : Number(levelFilter),
                statusFilter,
                verificationFilter,
                dummyFilter,
                offset,
                limit: itemsPerPage
            });
            if (inFlightCustomersRequest?.key === requestKey) {
                inFlightCustomersRequest = null;
            }
            setLoading(false);
            setListLoading(false);
        }
    };

    useEffect(() => {
        loadCustomers();
    }, [searchTerm, parentAccountFilter, levelFilter, statusFilter, verificationFilter, dummyFilter, currentPage, itemsPerPage]);

    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, parentAccountFilter, levelFilter, statusFilter, verificationFilter, dummyFilter]);

    const handleViewCustomer = (customer: Customer) => {
        setSelectedCustomer(customer);
        setShowCustomerDetails(true);
        setActiveTab('profile');
        setEditMode(false);
    };

    // ✅ When customer is updated from detail view, sync it back to the list
    const handleCustomerUpdated = (updatedCustomer: Customer) => {
        setCustomers(prev =>
            prev.map(c => c.tu_id === updatedCustomer.tu_id ? updatedCustomer : c)
        );
        setSelectedCustomer(updatedCustomer);
    };

    const handleToggleStatus = async (customer: Customer, currentStatus: boolean) => {
        try {
            await adminApi.post('admin-update-customer-user', {
                userId: customer.tu_id,
                email: customer.tu_email,
                isVerified: customer.tu_is_verified,
                emailVerified: customer.tu_email_verified,
                mobileVerified: customer.tu_mobile_verified,
                isActive: !currentStatus
            });

            const updatedCustomer = { ...customer, tu_is_active: !currentStatus };
            setCustomers(prev => prev.map(c => c.tu_id === customer.tu_id ? updatedCustomer : c));

            notification.showSuccess(
                'Status Updated',
                `Customer ${customer.tbl_user_profiles?.tup_first_name || 'account'} has been ${!currentStatus ? 'activated' : 'deactivated'}`
            );
        } catch (error: any) {
            console.error('Failed to update customer status:', error);
            notification.showError('Update Failed', error?.message || 'Failed to update customer status');
        }
    };

    const handleResetPassword = async (customer: Customer) => {
        const confirmed = window.confirm(
            `Are you sure you want to reset the password for ${customer.tbl_user_profiles?.tup_first_name || customer.tu_email}?\n\nA new temporary password will be generated.`
        );

        if (!confirmed) return;

        const newPassword = prompt('Enter new password for this user (minimum 8 characters):');
        if (!newPassword) return;

        if (newPassword.length < 8) {
            notification.showError('Invalid Password', 'Password must be at least 8 characters long');
            return;
        }

        try {
            await adminApi.post('admin-reset-user-password', {
                userId: customer.tu_id,
                newPassword
            });

            notification.showSuccess(
                'Password Reset',
                `Password reset successfully for ${customer.tbl_user_profiles?.tup_first_name || customer.tu_email}`
            );

            alert(`New password: ${newPassword}\n\nPlease share this with the user securely.`);
        } catch (error: any) {
            console.error('Failed to reset password:', error);
            notification.showError('Reset Failed', error?.message || 'Failed to reset password');
        }
    };

    const handleCustomerLogin = async (customer: Customer) => {
        if (!customer.tu_is_active) {
            notification.showError('Login Blocked', 'Customer account is disabled');
            return;
        }

        try {
            setImpersonatingCustomerId(customer.tu_id);
            const data = await adminApi.post<{
                tokenHash: string;
                verificationType: string;
            }>('admin-impersonate-customer', {
                userId: customer.tu_id
            });

            if (!data?.tokenHash) {
                throw new Error('Failed to create customer login token');
            }

            const callbackUrl = new URL('/auth/callback', window.location.origin);
            callbackUrl.searchParams.set('type', data.verificationType || 'magiclink');
            callbackUrl.searchParams.set('mode', 'admin_impersonation');
            callbackUrl.searchParams.set('token', data.tokenHash);

            const opened = window.open(callbackUrl.toString(), '_blank');
            if (opened) {
                opened.opener = null;
            }
            if (!opened) {
                window.location.href = callbackUrl.toString();
            }

            notification.showSuccess(
                'Customer Login Started',
                `Opening dashboard for ${customer.tbl_user_profiles?.tup_first_name || customer.tu_email}`
            );
        } catch (error: any) {
            console.error('Failed to login as customer:', error);
            notification.showError('Login Failed', error?.message || 'Failed to login as customer');
        } finally {
            setImpersonatingCustomerId(null);
        }
    };

    const totalPages = Math.ceil(totalCount / itemsPerPage);

    const getPageNumbers = () => {
        const pageNumbers: (number | string)[] = [];
        const maxVisiblePages = 5;

        if (totalPages <= maxVisiblePages) {
            for (let i = 1; i <= totalPages; i++) pageNumbers.push(i);
        } else {
            pageNumbers.push(1);
            let startPage = Math.max(2, currentPage - 1);
            let endPage = Math.min(totalPages - 1, currentPage + 1);
            if (currentPage <= 3) endPage = 4;
            if (currentPage >= totalPages - 2) startPage = totalPages - 3;
            if (startPage > 2) pageNumbers.push('...');
            for (let i = startPage; i <= endPage; i++) pageNumbers.push(i);
            if (endPage < totalPages - 1) pageNumbers.push('...');
            if (totalPages > 1) pageNumbers.push(totalPages);
        }
        return pageNumbers;
    };

    const paginate = (pageNumber: number | string) => {
        if (pageNumber !== '...' && typeof pageNumber === 'number') {
            setCurrentPage(pageNumber);
        }
    };

    if (loading && customers.length === 0) {
        return (
            <div className="bg-white rounded-xl shadow-sm p-6">
                <Loader />
            </div>
        );
    }

    if (error && customers.length === 0) {
        return (
            <div className="bg-white rounded-xl shadow-sm p-6">
                <div className="text-center py-12">
                    <Users className="h-12 w-12 text-red-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">Failed to Load Customers</h3>
                    <p className="text-gray-600 mb-4">{error}</p>
                    <button
                        onClick={loadCustomers}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2 mx-auto"
                    >
                        <Users className="h-4 w-4" />
                        <span>Retry</span>
                    </button>
                </div>
            </div>
        );
    }

    if (showCustomerDetails && selectedCustomer) {
        return (
            <CustomerDetails
                customer={selectedCustomer}
                onBack={() => {
                    setShowCustomerDetails(false);
                    setSelectedCustomer(null);
                    setEditMode(false);
                }}
                onUpdate={loadCustomers}
                onCustomerUpdated={handleCustomerUpdated}
                editMode={editMode}
                setEditMode={setEditMode}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                onCustomerLogin={handleCustomerLogin}
                impersonatingCustomerId={impersonatingCustomerId}
            />
        );
    }

	    return (
	        <div className="bg-white rounded-xl shadow-sm">
            <div ref={topRef} />
	            <div className="p-6 border-b border-gray-200">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center space-x-3">
                        <div className="bg-blue-100 p-3 rounded-lg">
                            <Users className="h-6 w-6 text-blue-600" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-gray-900">Customer Management</h3>
                            <p className="text-gray-600">Manage and monitor customer accounts</p>
                        </div>
                    </div>
                    <div className="flex items-center space-x-4">
                        <div className="text-sm text-gray-500">Total: {totalCount} customers</div>
                        <div className="flex items-center space-x-2">
                            <label className="text-sm text-gray-600">Show:</label>
                            <select
                                value={itemsPerPage}
                                onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                                className="border border-gray-300 rounded-lg px-3 py-1 focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="5">5</option>
                                <option value="10">10</option>
                                <option value="25">25</option>
                                <option value="50">50</option>
                            </select>
                            <span className="text-sm text-gray-600">per page</span>
                        </div>
                    </div>
                </div>

                {/* Search and Filters */}
                <div className="grid grid-cols-1 md:grid-cols-7 gap-4">
                    <div className="md:col-span-2">
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <Search className="h-5 w-5 text-gray-400" />
                            </div>
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                placeholder="Search by name, email, username, or user ID..."
                            />
                        </div>
                    </div>
                    <div className="md:col-span-2">
                        <input
                            type="text"
                            value={parentAccountFilter}
                            onChange={(e) => setParentAccountFilter(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="Filter by Parent Account (User ID)"
                        />
                    </div>
                    <div>
                        <select
                            value={levelFilter}
                            onChange={(e) => setLevelFilter(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            disabled={!parentAccountFilter.trim()}
                            title={!parentAccountFilter.trim() ? 'Enter a Parent Account to filter by level' : 'Filter by level'}
                        >
                            <option value="all">All Levels</option>
                            {Array.from({ length: 50 }).map((_, i) => (
                                <option key={i + 1} value={String(i + 1)}>Level {i + 1}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                            <option value="all">All Member Status</option>
                            <option value="active">Active</option>
                            <option value="pending">Pending</option>
                            <option value="disabled">Disabled</option>
                        </select>
                    </div>
                    <div>
                        <select
                            value={dummyFilter}
                            onChange={(e) => setDummyFilter(e.target.value as 'all' | 'real' | 'dummy')}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            title="Filter dummy/fake customer accounts"
                        >
                            <option value="all">All Accounts</option>
                            <option value="real">Real Only</option>
                            <option value="dummy">Dummy Only</option>
                        </select>
                    </div>
                    <div>
                        <select
                            value={verificationFilter}
                            onChange={(e) => setVerificationFilter(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                            <option value="all">All Verification</option>
                            <option value="verified">Verified</option>
                            <option value="unverified">Unverified</option>
                        </select>
                    </div>
                </div>

                {(parentAccountFilter.trim() || (levelFilter !== 'all' && parentAccountFilter.trim())) && (
                    <div className="mt-3 text-sm text-gray-600">
                        Showing downline for sponsor <span className="font-mono">{parentAccountFilter.trim() || '—'}</span>
                        {parentAccountFilter.trim() && levelFilter !== 'all' ? (
                            <> • Level <span className="font-medium">{levelFilter}</span></>
                        ) : null}
                    </div>
                )}
            </div>

            {/* Customer List */}
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                    <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                        {parentAccountFilter.trim() && (
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Level</th>
                        )}
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Parent</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contact</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Verification</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Joined</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                    {listLoading ? (
                        <TableSkeleton rows={itemsPerPage} />
                    ) : (
                        customers.map((customer) => (
                            <tr key={customer.tu_id} className="hover:bg-gray-50">
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex items-center">
                                        <div className="flex-shrink-0 h-10 w-10">
                                            <div className="h-10 w-10 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 flex items-center justify-center">
                                                    <span className="text-white font-medium text-sm">
                                                        {customer.tbl_user_profiles?.tup_first_name?.charAt(0) || 'U'}
                                                    </span>
                                            </div>
                                        </div>
                                        <div className="ml-4">
                                            <div className="text-sm font-medium text-gray-900">
                                                {customer.tbl_user_profiles?.tup_first_name} {customer.tbl_user_profiles?.tup_last_name}
                                            </div>
                                            {customer.tu_is_dummy ? (
                                              <div className="mt-1">
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-orange-50 text-orange-700 border border-orange-100">
                                                  Dummy Account
                                                </span>
                                              </div>
                                            ) : null}
                                            <div className="text-sm text-gray-500">@{customer.tbl_user_profiles?.tup_username}</div>
                                            <div className="text-xs text-gray-400">{customer.tbl_user_profiles?.tup_sponsorship_number}</div>
                                        </div>
                                    </div>
                                </td>
                                {parentAccountFilter.trim() && (
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-100">
                                            Level {customer.downline_level ?? '—'}
                                        </span>
                                    </td>
                                )}
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="text-sm text-gray-900">
                                        {customer.tbl_user_profiles?.tup_parent_name ||
                                          customer.tbl_user_profiles?.tup_parent_username ||
                                          '—'}
                                    </div>
                                    <div className="text-xs text-gray-500 font-mono">
                                        {customer.tbl_user_profiles?.tup_parent_sponsorship_number ||
                                          customer.tbl_user_profiles?.tup_parent_account ||
                                          ''}
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="text-sm text-gray-900">{customer.tu_email}</div>
                                    <div className="text-sm text-gray-500">{customer.tbl_user_profiles?.tup_mobile}</div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <div className="flex space-x-2">
                                            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${customer.tu_email_verified ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                                <Mail className="h-3 w-3 mr-1" />
                                                {customer.tu_email_verified ? 'Email ✓' : 'Email ✗'}
                                            </span>
                                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${customer.tu_mobile_verified ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                                <Phone className="h-3 w-3 mr-1" />
                                            {customer.tu_mobile_verified ? 'Mobile ✓' : 'Mobile ✗'}
                                            </span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                        {(() => {
                                          const isEnabled = customer.tu_is_active === true;
                                          const verificationComplete =
                                            customer.verification_complete ??
                                            (customer.tu_email_verified === true || customer.tu_mobile_verified === true);
                                          const isMemberActive =
                                            customer.is_active_member ??
                                            (isEnabled && customer.tu_registration_paid === true && verificationComplete);
                                          if (!isEnabled) {
                                            return (
                                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                                <UserX className="h-3 w-3 mr-1" />
                                                Disabled
                                              </span>
                                            );
                                          }
                                          if (isMemberActive) {
                                            return (
                                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                                <UserCheck className="h-3 w-3 mr-1" />
                                                Active
                                              </span>
                                            );
                                          }
                                          return (
                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                                              <Activity className="h-3 w-3 mr-1" />
                                              Pending
                                            </span>
                                          );
                                        })()}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    <div className="flex items-center">
                                        <Calendar className="h-4 w-4 mr-1" />
                                        {new Date(customer.tu_created_at).toLocaleDateString()}
                                    </div>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                    <div className="flex space-x-2">
                                        <button
                                            onClick={() => handleViewCustomer(customer)}
                                            className="text-blue-600 hover:text-blue-800 p-1 rounded hover:bg-blue-50"
                                            title="View Details"
                                        >
                                            <Eye className="h-4 w-4" />
                                        </button>
                                        <button
                                            onClick={() => handleResetPassword(customer)}
                                            className="text-orange-600 hover:text-orange-800 p-1 rounded hover:bg-orange-50"
                                            title="Reset Password"
                                        >
                                            <Key className="h-4 w-4" />
                                        </button>
                                        {hasPermission('customers' as any, 'write') && (
                                            <button
                                                onClick={() => handleCustomerLogin(customer)}
                                                disabled={impersonatingCustomerId === customer.tu_id || !customer.tu_is_active}
                                                className={`p-1 rounded ${
                                                    impersonatingCustomerId === customer.tu_id || !customer.tu_is_active
                                                        ? 'text-gray-300 cursor-not-allowed'
                                                        : 'text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50'
                                                }`}
                                                title={customer.tu_is_active ? 'Login as Customer' : 'Customer account is disabled'}
                                            >
                                                <LogIn className={`h-4 w-4 ${impersonatingCustomerId === customer.tu_id ? 'animate-pulse' : ''}`} />
                                            </button>
                                        )}
                                        <button
                                            onClick={() => handleToggleStatus(customer, customer.tu_is_active)}
                                            className={`p-1 rounded ${customer.tu_is_active ? 'text-red-600 hover:text-red-800 hover:bg-red-50' : 'text-green-600 hover:text-green-800 hover:bg-green-50'}`}
                                            title={customer.tu_is_active ? 'Deactivate' : 'Activate'}
                                        >
                                            {customer.tu_is_active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))
                    )}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            {totalCount > 0 && (
                <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
                    <div className="text-sm text-gray-700">
                        Showing <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> to{' '}
                        <span className="font-medium">{Math.min(currentPage * itemsPerPage, totalCount)}</span> of{' '}
                        <span className="font-medium">{totalCount}</span> customers
                    </div>
                    <div className="flex items-center space-x-1">
                        <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1}
                                className={`px-3 py-1 rounded-md ${currentPage === 1 ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
                            <ChevronsLeft className="h-4 w-4" />
                        </button>
                        <button onClick={() => paginate(currentPage - 1)} disabled={currentPage === 1}
                                className={`px-3 py-1 rounded-md ${currentPage === 1 ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        {getPageNumbers().map((page, index) => (
                            <button key={index} onClick={() => paginate(page)}
                                    className={`px-3 py-1 rounded-md ${page === currentPage ? 'bg-blue-600 text-white' : page === '...' ? 'bg-transparent text-gray-500 cursor-default' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                                    disabled={page === '...'}>
                                {page === '...' ? <MoreHorizontal className="h-4 w-4" /> : page}
                            </button>
                        ))}
                        <button onClick={() => paginate(currentPage + 1)} disabled={currentPage === totalPages}
                                className={`px-3 py-1 rounded-md ${currentPage === totalPages ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
                            <ChevronRight className="h-4 w-4" />
                        </button>
                        <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}
                                className={`px-3 py-1 rounded-md ${currentPage === totalPages ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
                            <ChevronsRight className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            )}

            {/* Empty State */}
            {!listLoading && customers.length === 0 && (
                <div className="text-center py-12">
                    <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No customers found</h3>
                    <p className="text-gray-600">
                        {searchTerm || statusFilter !== 'all' || verificationFilter !== 'all'
                            ? 'Try adjusting your search criteria'
                            : 'No customers have registered yet'}
                    </p>
                </div>
            )}
        </div>
    );
};

// ─────────────────────────────────────────────
// CustomerDetails Component
// ─────────────────────────────────────────────
const CustomerDetails: React.FC<{
    customer: Customer;
    onBack: () => void;
    onUpdate: () => void;
    onCustomerUpdated: (customer: Customer) => void; // ✅ new prop
    editMode: boolean;
    setEditMode: (mode: boolean) => void;
    activeTab: string;
    setActiveTab: (tab: string) => void;
    onCustomerLogin: (customer: Customer) => void;
    impersonatingCustomerId: string | null;
}> = ({
    customer: initialCustomer,
    onBack,
    onUpdate,
    onCustomerUpdated,
    editMode,
    setEditMode,
    activeTab,
    setActiveTab,
    onCustomerLogin,
    impersonatingCustomerId
}) => {
    const { hasPermission } = useAdminAuth();

    // ✅ Local customer state — decoupled from parent prop
    const [customer, setCustomer] = useState<Customer>(initialCustomer);

    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [walletDetails, setWalletDetails] = useState<WalletDetailsResponse | null>(null);
    const [walletTransactions, setWalletTransactions] = useState<WalletTxn[]>([]);
    const [walletTxPage, setWalletTxPage] = useState(1);
    const [walletTxPageSize, setWalletTxPageSize] = useState(10);
    const [walletTxTotalCount, setWalletTxTotalCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const walletTxTopRef = useScrollToTopOnChange([walletTxPage], { smooth: true });
    const [editData, setEditData] = useState({
        first_name: customer.tbl_user_profiles?.tup_first_name || '',
        last_name: customer.tbl_user_profiles?.tup_last_name || '',
        username: customer.tbl_user_profiles?.tup_username || '',
        mobile: customer.tbl_user_profiles?.tup_mobile || '',
        gender: customer.tbl_user_profiles?.tup_gender || '',
        email: customer.tu_email,
        is_active: customer.tu_is_active,
        is_dummy: customer.tu_is_dummy ?? false,
        email_verified: customer.tu_email_verified,
        mobile_verified: customer.tu_mobile_verified
    });
    const notification = useNotification();
    const hasProfile = Boolean(customer.tbl_user_profiles?.tup_sponsorship_number);
    const verificationComplete = customer.verification_complete ?? (customer.tu_email_verified || customer.tu_mobile_verified);
    const isActiveMember =
        customer.is_active_member ??
        (customer.tu_is_active && customer.tu_registration_paid === true && verificationComplete);
    const statusBadge = !customer.tu_is_active
        ? {
            label: 'Inactive',
            className: 'bg-red-100 text-red-800',
            icon: <AlertCircle className="h-4 w-4 mr-1" />
        }
        : !hasProfile
            ? {
                label: 'Incomplete',
                className: 'bg-amber-100 text-amber-800',
                icon: <AlertCircle className="h-4 w-4 mr-1" />
            }
            : isActiveMember
                ? {
                    label: 'Active',
                    className: 'bg-green-100 text-green-800',
                    icon: <CheckCircle className="h-4 w-4 mr-1" />
                }
                : {
                    label: 'Pending',
                    className: 'bg-yellow-100 text-yellow-800',
                    icon: <AlertCircle className="h-4 w-4 mr-1" />
                };

    useEffect(() => {
        if (activeTab === 'transactions') {
            loadTransactions();
        }
        if (activeTab === 'wallets' || activeTab === 'earnings') {
            loadWalletDetails();
        }
        if (activeTab === 'wallet_transactions') {
            setWalletTxPage(1);
        }
    }, [activeTab]);

    useEffect(() => {
        if (activeTab !== 'wallet_transactions') return;
        loadWalletTransactions();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, walletTxPage, walletTxPageSize]);

    const loadTransactions = async () => {
        setLoading(true);
        try {
            const payments = await adminApi.post<any[]>('admin-get-customer-payments', {
                userId: customer.tu_id
            });
            setTransactions(payments || []);
        } catch (error) {
            console.error('Failed to load payments:', error);
            setTransactions([]);
        } finally {
            setLoading(false);
        }
    };

    const loadWalletDetails = async () => {
        setLoading(true);
        try {
            const details = await adminApi.post<WalletDetailsResponse>('admin-get-customer-wallet-details', {
                userId: customer.tu_id
            });
            setWalletDetails(details || null);
        } catch (error) {
            console.error('Failed to load wallet details:', error);
            setWalletDetails(null);
        } finally {
            setLoading(false);
        }
    };

    const loadWalletTransactions = async () => {
        setLoading(true);
        try {
            const result = await adminApi.post<{ rows: WalletTxn[]; count: number }>('admin-get-user-wallet-transactions-paged', {
                userId: customer.tu_id,
                page: walletTxPage,
                pageSize: walletTxPageSize
            });
            setWalletTransactions(result?.rows || []);
            setWalletTxTotalCount(Number(result?.count || 0));
        } catch (error) {
            console.error('Failed to load wallet transactions:', error);
            setWalletTransactions([]);
            setWalletTxTotalCount(0);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveEdit = async () => {
        if (!customer) return;

        try {
            await adminApi.post('admin-update-customer-user', {
                userId: customer.tu_id,
                email: editData.email,
                isVerified: editData.email_verified || editData.mobile_verified,
                emailVerified: editData.email_verified,
                mobileVerified: editData.mobile_verified,
                isActive: editData.is_active,
                isDummy: editData.is_dummy
            });

            await adminApi.post('admin-update-customer-profile', {
                userId: customer.tu_id,
                firstName: editData.first_name,
                lastName: editData.last_name,
                username: editData.username,
                mobile: editData.mobile,
                gender: editData.gender
            });

            // ✅ Build updated customer object immediately
            const updatedCustomer: Customer = {
                ...customer,
                tu_email: editData.email,
                tu_is_active: editData.is_active,
                tu_email_verified: editData.email_verified,
                tu_mobile_verified: editData.mobile_verified,
                tu_is_verified: editData.email_verified || editData.mobile_verified,
                tu_is_dummy: editData.is_dummy,
                tbl_user_profiles: customer.tbl_user_profiles
                    ? {
                        ...customer.tbl_user_profiles,
                        tup_first_name: editData.first_name,
                        tup_last_name: editData.last_name,
                        tup_username: editData.username,
                        tup_mobile: editData.mobile,
                        tup_gender: editData.gender,
                    }
                    : null
            };

            // ✅ Update local state — detail view reflects changes instantly
            setCustomer(updatedCustomer);

            // ✅ Sync updated customer back to the parent list
            onCustomerUpdated(updatedCustomer);

            // ✅ Refresh list in background
            onUpdate();

            setEditMode(false);
            notification.showSuccess('Customer Updated', 'Customer information has been updated successfully');

        } catch (error) {
            console.error('Failed to update customer:', error);
            notification.showError('Update Failed', 'Failed to update customer information');
        }
    };

    const tabs = [
        { id: 'profile', label: 'Profile Details', icon: User },
        { id: 'transactions', label: 'Payment Transactions', icon: CreditCard },
        { id: 'wallets', label: 'Wallets', icon: Wallet },
        { id: 'wallet_transactions', label: 'Wallet Transactions', icon: Activity },
        { id: 'earnings', label: 'Earnings', icon: DollarSign }
    ];

    const visibleTabs = tabs.filter((tab) => {
        if (tab.id === 'profile') return true;
        if (tab.id === 'transactions') return hasPermission('payments' as any, 'read');
        if (tab.id === 'wallets' || tab.id === 'wallet_transactions' || tab.id === 'earnings') {
            return hasPermission('wallets' as any, 'read');
        }
        return true;
    });

    const visibleTabIds = visibleTabs.map((t) => t.id).join('|');

    useEffect(() => {
        if (visibleTabs.length === 0) return;
        if (!visibleTabs.some((t) => t.id === activeTab)) {
            setActiveTab(visibleTabs[0].id);
        }
    }, [activeTab, visibleTabIds, setActiveTab]);

    return (
        <div className="bg-white rounded-xl shadow-sm">
            <div className="p-6 border-b border-gray-200">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center space-x-4">
                        <button
                            onClick={onBack}
                            className="flex items-center space-x-2 text-gray-600 hover:text-gray-800 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            <span>Back to Customers</span>
                        </button>
                        <div>
                            {/* ✅ Header name updates immediately after save */}
                            <h3 className="text-lg font-semibold text-gray-900">
                                {customer.tbl_user_profiles?.tup_first_name} {customer.tbl_user_profiles?.tup_last_name}
                            </h3>
                            {customer.tu_is_dummy ? (
                              <div className="mt-1">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-50 text-orange-700 border border-orange-100">
                                  Dummy Account
                                </span>
                              </div>
                            ) : null}
                            <p className="text-gray-600">Customer Details & Management</p>
                        </div>
                    </div>
                    <div className="flex items-center space-x-3">
                        {hasPermission('customers' as any, 'write') && (
                            <button
                                onClick={() => onCustomerLogin(customer)}
                                disabled={impersonatingCustomerId === customer.tu_id || !customer.tu_is_active}
                                className={`px-4 py-2 rounded-lg transition-colors flex items-center space-x-2 ${
                                    impersonatingCustomerId === customer.tu_id || !customer.tu_is_active
                                        ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                                        : 'bg-emerald-600 text-white hover:bg-emerald-700'
                                }`}
                                title={customer.tu_is_active ? 'Login as Customer' : 'Customer account is disabled'}
                            >
                                <LogIn className={`h-4 w-4 ${impersonatingCustomerId === customer.tu_id ? 'animate-pulse' : ''}`} />
                                <span>Login as Customer</span>
                            </button>
                        )}
                        {activeTab === 'profile' && (
                            <>
                                {editMode ? (
                                    <div className="flex space-x-2">
                                        <button
                                            onClick={handleSaveEdit}
                                            className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2"
                                        >
                                            <Save className="h-4 w-4" />
                                            <span>Save Changes</span>
                                        </button>
                                        <button
                                            onClick={() => setEditMode(false)}
                                            className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors flex items-center space-x-2"
                                        >
                                            <X className="h-4 w-4" />
                                            <span>Cancel</span>
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => setEditMode(true)}
                                        className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2"
                                    >
                                        <Edit className="h-4 w-4" />
                                        <span>Edit Customer</span>
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* Tabs */}
                <div className="border-b border-gray-200">
                    <nav className="flex space-x-8">
                        {visibleTabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm ${
                                    activeTab === tab.id
                                        ? 'border-blue-500 text-blue-600'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }`}
                            >
                                <tab.icon className="h-4 w-4" />
                                <span>{tab.label}</span>
                            </button>
                        ))}
                    </nav>
                </div>
            </div>

            <div className="p-6">
                {activeTab === 'profile' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Personal Information */}
                        <div className="space-y-6">
                            <div className="bg-gray-50 p-6 rounded-lg">
                                <h4 className="font-medium text-gray-900 mb-4 flex items-center">
                                    <User className="h-5 w-5 mr-2" />
                                    Personal Information
                                </h4>
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-sm font-medium text-gray-500">First Name</label>
                                            {editMode ? (
                                                <input type="text" value={editData.first_name}
                                                       onChange={(e) => setEditData(prev => ({ ...prev, first_name: e.target.value }))}
                                                       className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                                            ) : (
                                                <p className="text-gray-900 mt-1">{customer.tbl_user_profiles?.tup_first_name || 'Not provided'}</p>
                                            )}
                                        </div>
                                        <div>
                                            <label className="text-sm font-medium text-gray-500">Last Name</label>
                                            {editMode ? (
                                                <input type="text" value={editData.last_name}
                                                       onChange={(e) => setEditData(prev => ({ ...prev, last_name: e.target.value }))}
                                                       className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                                            ) : (
                                                <p className="text-gray-900 mt-1">{customer.tbl_user_profiles?.tup_last_name || 'Not provided'}</p>
                                            )}
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium text-gray-500">Username</label>
                                        {editMode ? (
                                            <input type="text" value={editData.username}
                                                   onChange={(e) => setEditData(prev => ({ ...prev, username: e.target.value }))}
                                                   className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                                        ) : (
                                            <p className="text-gray-900 mt-1">@{customer.tbl_user_profiles?.tup_username || 'Not set'}</p>
                                        )}
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium text-gray-500">Email</label>
                                        {editMode ? (
                                            <input type="email" value={editData.email}
                                                   onChange={(e) => setEditData(prev => ({ ...prev, email: e.target.value }))}
                                                   className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                                        ) : (
                                            <p className="text-gray-900 mt-1">{customer.tu_email}</p>
                                        )}
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium text-gray-500">Mobile</label>
                                        {editMode ? (
                                            <input type="tel" value={editData.mobile}
                                                   onChange={(e) => setEditData(prev => ({ ...prev, mobile: e.target.value }))}
                                                   className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
                                        ) : (
                                            <p className="text-gray-900 mt-1">{customer.tbl_user_profiles?.tup_mobile || 'Not provided'}</p>
                                        )}
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium text-gray-500">Gender</label>
                                        {editMode ? (
                                            <select value={editData.gender}
                                                    onChange={(e) => setEditData(prev => ({ ...prev, gender: e.target.value }))}
                                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                                                <option value="">Select gender</option>
                                                <option value="male">Male</option>
                                                <option value="female">Female</option>
                                                <option value="other">Other</option>
                                            </select>
                                        ) : (
                                            <p className="text-gray-900 mt-1 capitalize">{customer.tbl_user_profiles?.tup_gender || 'Not specified'}</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Account Information */}
                        <div className="space-y-6">
                            <div className="bg-gray-50 p-6 rounded-lg">
                                <h4 className="font-medium text-gray-900 mb-4 flex items-center">
                                    <Settings className="h-5 w-5 mr-2" />
                                    Account Information
                                </h4>
                                <div className="space-y-4">
                                    <div>
                                        <label className="text-sm font-medium text-gray-500">User ID</label>
                                        <p className="text-gray-900 mt-1 font-mono text-lg">{customer.tbl_user_profiles?.tup_sponsorship_number}</p>
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium text-gray-500">Registration Date</label>
                                        <p className="text-gray-900 mt-1">{new Date(customer.tu_created_at).toLocaleDateString()}</p>
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium text-gray-500">Account Status</label>
                                        {editMode ? (
                                            <select value={editData.is_active ? 'active' : 'inactive'}
                                                    onChange={(e) => setEditData(prev => ({ ...prev, is_active: e.target.value === 'active' }))}
                                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                                                <option value="active">Active</option>
                                                <option value="inactive">Inactive</option>
                                            </select>
                                        ) : (
                                            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium mt-1 ${statusBadge.className}`}>
                                                {statusBadge.icon}
                                                {statusBadge.label}
                                            </span>
                                        )}
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium text-gray-500">Dummy/Fake Account</label>
                                        {editMode && hasPermission('customers' as any, 'write') ? (
                                            <label className="relative inline-flex items-center cursor-pointer mt-2">
                                                <input
                                                    type="checkbox"
                                                    className="sr-only peer"
                                                    checked={!!editData.is_dummy}
                                                    onChange={(e) => setEditData(prev => ({ ...prev, is_dummy: e.target.checked }))}
                                                />
                                                <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-focus:ring-2 peer-focus:ring-blue-500 peer-checked:bg-orange-500 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full"></div>
                                                <span className="ml-3 text-sm text-gray-700">{editData.is_dummy ? 'Dummy' : 'Real'}</span>
                                            </label>
                                        ) : (
                                            <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium mt-1 ${customer.tu_is_dummy ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-800'}`}>
                                                {customer.tu_is_dummy ? 'Dummy' : 'Real'}
                                            </span>
                                        )}
                                        {editMode && !hasPermission('customers' as any, 'write') ? (
                                            <p className="text-xs text-gray-500 mt-1">You don’t have permission to change this.</p>
                                        ) : null}
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium text-gray-500">Verification Status</label>
                                        <div className="space-y-2 mt-1">
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm">Email Verification</span>
                                                {editMode ? (
                                                    <label className="relative inline-flex items-center cursor-pointer">
                                                        <input type="checkbox" checked={editData.email_verified}
                                                               onChange={(e) => setEditData(prev => ({ ...prev, email_verified: e.target.checked }))}
                                                               className="sr-only peer" />
                                                        <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                                                    </label>
                                                ) : (
                                                    <span className={`w-2 h-2 rounded-full ${customer.tu_email_verified ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                                )}
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm">Mobile Verification</span>
                                                {editMode ? (
                                                    <label className="relative inline-flex items-center cursor-pointer">
                                                        <input type="checkbox" checked={editData.mobile_verified}
                                                               onChange={(e) => setEditData(prev => ({ ...prev, mobile_verified: e.target.checked }))}
                                                               className="sr-only peer" />
                                                        <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                                                    </label>
                                                ) : (
                                                    <span className={`w-2 h-2 rounded-full ${customer.tu_mobile_verified ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'transactions' && (
                    <div>
                        <div className="flex items-center justify-between mb-6">
                            <h4 className="font-medium text-gray-900 flex items-center">
                                <CreditCard className="h-5 w-5 mr-2" />
                                Payment Transaction History
                            </h4>
                            <div className="text-sm text-gray-500">Total: {transactions.length} transactions</div>
                        </div>

                        {loading ? (
                            <div className="text-center py-8">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                                <p className="text-gray-500 mt-2">Loading transactions...</p>
                            </div>
                        ) : transactions.length > 0 ? (
                            <div className="space-y-4">
                                {transactions.map((transaction) => (
                                    <div key={transaction.tp_id} className="border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
                                        <div className="flex justify-between items-start">
                                            <div className="flex-1">
                                                <div className="flex items-center space-x-3 mb-2">
                                                    <div className="bg-blue-100 p-2 rounded-lg">
                                                        <CreditCard className="h-4 w-4 text-blue-600" />
                                                    </div>
                                                    <div>
                                                        <h5 className="font-medium text-gray-900">
                                                            {transaction.subscription?.plan?.tsp_name || 'Payment'}
                                                        </h5>
                                                        <p className="text-sm text-gray-500">
                                                            {new Date(transaction.tp_created_at).toLocaleDateString()} at {new Date(transaction.tp_created_at).toLocaleTimeString()}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-4 mt-4">
                                                    <div>
                                                        <span className="text-xs font-medium text-gray-500">Payment Method</span>
                                                        <p className="text-sm text-gray-900 capitalize">{transaction.tp_payment_method}</p>
                                                    </div>
                                                    <div>
                                                        <span className="text-xs font-medium text-gray-500">Currency</span>
                                                        <p className="text-sm text-gray-900">{transaction.tp_currency}</p>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right ml-6">
                                                <p className="text-2xl font-bold text-gray-900">${transaction.tp_amount}</p>
                                                {transaction.tp_gateway_response?.parent_income !== undefined && (
                                                    <p className="text-xs text-gray-500 mt-1">
                                                        Parent: ${transaction.tp_gateway_response?.parent_income ?? 0} • Admin: ${transaction.tp_gateway_response?.admin_income ?? transaction.tp_amount}
                                                    </p>
                                                )}
                                                <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
                                                    transaction.tp_payment_status === 'completed' ? 'bg-green-100 text-green-800'
                                                        : transaction.tp_payment_status === 'pending' ? 'bg-yellow-100 text-yellow-800'
                                                            : transaction.tp_payment_status === 'failed' ? 'bg-red-100 text-red-800'
                                                                : 'bg-gray-100 text-gray-800'
                                                }`}>
                                                    {transaction.tp_payment_status === 'completed' && <CheckCircle className="h-3 w-3 mr-1" />}
                                                    {transaction.tp_payment_status === 'failed' && <AlertCircle className="h-3 w-3 mr-1" />}
                                                    {transaction.tp_payment_status.charAt(0).toUpperCase() + transaction.tp_payment_status.slice(1)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-12">
                                <DollarSign className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                                <h3 className="text-lg font-medium text-gray-900 mb-2">No transactions found</h3>
                                <p className="text-gray-600">This customer hasn't made any payments yet.</p>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'wallets' && (
                    <div>
                        <div className="flex items-center justify-between mb-6">
                            <h4 className="font-medium text-gray-900 flex items-center">
                                <Wallet className="h-5 w-5 mr-2" />
                                Wallets
                            </h4>
                        </div>

                        {loading ? (
                            <div className="text-center py-8">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                                <p className="text-gray-500 mt-2">Loading wallet details...</p>
                            </div>
                        ) : walletDetails ? (
                            <div className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                                        <div className="text-sm text-green-700">Wallet Balance</div>
                                        <div className="text-2xl font-bold text-green-800">
                                            {walletDetails.totals.walletBalance.toFixed(2)} USDT
                                        </div>
                                    </div>
                                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                        <div className="text-sm text-blue-700">Withdrawable</div>
                                        <div className="text-2xl font-bold text-blue-800">
                                            {walletDetails.totals.withdrawableBalance.toFixed(2)} USDT
                                        </div>
                                        {walletDetails.totals.reservedWithdrawals > 0 && (
                                            <div className="text-xs text-blue-700 mt-1">
                                                Reserved: {walletDetails.totals.reservedWithdrawals.toFixed(2)} USDT
                                            </div>
                                        )}
                                    </div>
                                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                                        <div className="text-sm text-gray-700">Total Earned</div>
                                        <div className="text-2xl font-bold text-gray-900">
                                            {walletDetails.totals.totalEarned.toFixed(2)} USDT
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-white border border-gray-200 rounded-lg p-4">
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="text-sm font-semibold text-gray-900">Connected Wallet Addresses</div>
                                        <div className="text-xs text-gray-500">
                                            Total: {walletDetails.walletConnections.length}
                                        </div>
                                    </div>

                                    {walletDetails.walletConnections.length > 0 ? (
                                        <div className="space-y-3">
                                            {walletDetails.walletConnections.map((w) => (
                                                <div key={w.tuwc_id} className="flex items-start justify-between border border-gray-100 rounded-lg p-3">
                                                    <div>
                                                        <div className="text-sm font-medium text-gray-900 flex items-center gap-2">
                                                            <span className="font-mono">{w.tuwc_wallet_address}</span>
                                                            {w.tuwc_is_default && (
                                                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                                                                    Default
                                                                </span>
                                                            )}
                                                            {w.tuwc_is_active ? (
                                                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                                                                    Active
                                                                </span>
                                                            ) : (
                                                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                                                                    Inactive
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-xs text-gray-600 mt-1">
                                                            {(w.tuwc_wallet_name || w.tuwc_wallet_type) ? (
                                                                <span>{[w.tuwc_wallet_name, w.tuwc_wallet_type].filter(Boolean).join(' • ')}</span>
                                                            ) : (
                                                                <span>No wallet metadata</span>
                                                            )}
                                                            {w.tuwc_chain_id != null && <span> • Chain: {w.tuwc_chain_id}</span>}
                                                        </div>
                                                    </div>
                                                    <div className="text-xs text-gray-500">
                                                        {w.tuwc_last_connected_at ? (
                                                            <span>Last: {new Date(w.tuwc_last_connected_at).toLocaleString()}</span>
                                                        ) : (
                                                            <span>Never connected</span>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-center py-8 text-gray-600">
                                            No wallet connections found for this customer.
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-12">
                                <Wallet className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                                <h3 className="text-lg font-medium text-gray-900 mb-2">No wallet data</h3>
                                <p className="text-gray-600">No wallet details found for this customer.</p>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'wallet_transactions' && (
                    <div>
                        <div ref={walletTxTopRef} />
                        <div className="flex items-center justify-between mb-6">
                            <h4 className="font-medium text-gray-900 flex items-center">
                                <Activity className="h-5 w-5 mr-2" />
                                Wallet Transactions
                            </h4>
                            <div className="flex items-center gap-3">
                                <div className="text-sm text-gray-500">Total: {walletTxTotalCount}</div>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-gray-600">Page size</span>
                                    <select
                                        value={walletTxPageSize}
                                        onChange={(e) => { setWalletTxPageSize(Number(e.target.value)); setWalletTxPage(1); }}
                                        className="border border-gray-200 rounded-lg px-2 py-1 text-sm"
                                    >
                                        <option value={10}>10</option>
                                        <option value={20}>20</option>
                                        <option value={50}>50</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {loading ? (
                            <div className="text-center py-8">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                                <p className="text-gray-500 mt-2">Loading wallet transactions...</p>
                            </div>
                        ) : walletTransactions.length > 0 ? (
                            <div className="space-y-3">
                                {walletTransactions.map((t) => (
                                    <div key={t.twt_id} className="border border-gray-200 rounded-lg p-4">
                                        <div className="flex items-start justify-between">
                                            <div className="flex items-start gap-3">
                                                <div className={`p-2 rounded-lg ${
                                                    t.twt_transaction_type === 'credit'
                                                        ? 'bg-green-100 text-green-700'
                                                        : t.twt_transaction_type === 'debit'
                                                            ? 'bg-red-100 text-red-700'
                                                            : 'bg-gray-100 text-gray-700'
                                                }`}>
                                                    {t.twt_transaction_type === 'credit' ? (
                                                        <ArrowUpRight className="h-4 w-4" />
                                                    ) : t.twt_transaction_type === 'debit' ? (
                                                        <ArrowDownLeft className="h-4 w-4" />
                                                    ) : (
                                                        <Activity className="h-4 w-4" />
                                                    )}
                                                </div>
                                                <div>
                                                    <div className="text-sm font-medium text-gray-900">{t.twt_description}</div>
                                                    <div className="text-xs text-gray-500 mt-1">
                                                        {new Date(t.twt_created_at).toLocaleDateString()} at {new Date(t.twt_created_at).toLocaleTimeString()}
                                                        {t.twt_reference_type ? <span> • {t.twt_reference_type}</span> : null}
                                                        {t.twt_blockchain_hash ? <span> • Hash: {String(t.twt_blockchain_hash).slice(0, 10)}…</span> : null}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className={`text-lg font-bold ${
                                                    t.twt_transaction_type === 'credit' ? 'text-green-700' :
                                                        t.twt_transaction_type === 'debit' ? 'text-red-700' : 'text-gray-900'
                                                }`}>
                                                    {t.twt_transaction_type === 'debit' ? '-' : '+'}{Number(t.twt_amount || 0).toFixed(2)} {t.twt_currency || 'USDT'}
                                                </div>
                                                <div className="text-xs text-gray-500 mt-1 capitalize">{t.twt_status}</div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-12">
                                <Activity className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                                <h3 className="text-lg font-medium text-gray-900 mb-2">No transactions</h3>
                                <p className="text-gray-600">No wallet transactions found for this customer.</p>
                            </div>
                        )}

                        {walletTxTotalCount > 0 && (
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 pt-4 border-t border-gray-200 mt-6">
                                <div className="text-sm text-gray-500">
                                    Page {walletTxPage} of {Math.max(1, Math.ceil(walletTxTotalCount / walletTxPageSize))}
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setWalletTxPage(1)}
                                        disabled={walletTxPage === 1}
                                        className="px-3 py-2 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                                    >
                                        First
                                    </button>
                                    <button
                                        onClick={() => setWalletTxPage((p) => Math.max(1, p - 1))}
                                        disabled={walletTxPage === 1}
                                        className="px-3 py-2 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                                    >
                                        Prev
                                    </button>
                                    <button
                                        onClick={() => setWalletTxPage((p) => Math.min(Math.max(1, Math.ceil(walletTxTotalCount / walletTxPageSize)), p + 1))}
                                        disabled={walletTxPage >= Math.max(1, Math.ceil(walletTxTotalCount / walletTxPageSize))}
                                        className="px-3 py-2 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                                    >
                                        Next
                                    </button>
                                    <button
                                        onClick={() => setWalletTxPage(Math.max(1, Math.ceil(walletTxTotalCount / walletTxPageSize)))}
                                        disabled={walletTxPage >= Math.max(1, Math.ceil(walletTxTotalCount / walletTxPageSize))}
                                        className="px-3 py-2 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                                    >
                                        Last
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'earnings' && (
                    <div>
                        <div className="flex items-center justify-between mb-6">
                            <h4 className="font-medium text-gray-900 flex items-center">
                                <DollarSign className="h-5 w-5 mr-2" />
                                Earnings
                            </h4>
                        </div>

                        {loading ? (
                            <div className="text-center py-8">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                                <p className="text-gray-500 mt-2">Loading earnings...</p>
                            </div>
                        ) : walletDetails ? (
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                                    <div className="text-sm text-green-700">Total Earned</div>
                                    <div className="text-2xl font-bold text-green-800">
                                        {walletDetails.totals.totalEarned.toFixed(2)} USDT
                                    </div>
                                </div>
                                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                                    <div className="text-sm text-red-700">Total Debited</div>
                                    <div className="text-2xl font-bold text-red-800">
                                        {walletDetails.totals.totalDebited.toFixed(2)} USDT
                                    </div>
                                </div>
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                                    <div className="text-sm text-blue-700">Reserved Withdrawals</div>
                                    <div className="text-2xl font-bold text-blue-800">
                                        {walletDetails.totals.reservedWithdrawals.toFixed(2)} USDT
                                    </div>
                                </div>
                                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                                    <div className="text-sm text-gray-700">Withdrawable</div>
                                    <div className="text-2xl font-bold text-gray-900">
                                        {walletDetails.totals.withdrawableBalance.toFixed(2)} USDT
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-12">
                                <DollarSign className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                                <h3 className="text-lg font-medium text-gray-900 mb-2">No earnings data</h3>
                                <p className="text-gray-600">No wallet/earnings details found for this customer.</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CustomerManagement;
