import React, { useState, useEffect } from 'react';
import { useAdmin } from '../../contexts/AdminContext';
import { adminApi } from '../../lib/adminApi';
import { Settings, Save, AlertCircle, CheckCircle } from 'lucide-react';

const defaultPaymentWalletsEnabled = {
    trust_wallet: true,
    metamask: true,
    safepal: true,
    tokenpocket: true,
    bitget: true
};

const isLivePaymentModeValue = (paymentMode: unknown): boolean => {
    const normalized = String(paymentMode ?? '').trim().toLowerCase();
    return paymentMode === true || paymentMode === 1 || normalized === '1' || normalized === 'true' || normalized === 'live' || normalized === 'mainnet';
};

const PaymentSettings: React.FC = () => {
    const { settings, updateSettings, loading, refreshSettings } = useAdmin();
    const [formData, setFormData] = useState({
        paymentMode: settings.paymentMode,
        usdtAddressTestnet: settings.usdtAddressTestnet || settings.usdtAddress || '',
        usdtAddressMainnet: settings.usdtAddressMainnet || settings.usdtAddress || '',
        subscriptionContractAddress: settings.subscriptionContractAddress,
        investmentContractAddress: settings.investmentContractAddress,
        subscriptionWalletAddress: settings.subscriptionWalletAddress,
        investmentWalletAddress: settings.investmentWalletAddress,
        adminPaymentWalletTestnet: settings.adminPaymentWalletTestnet || settings.adminPaymentWallet || '',
        adminPaymentWalletMainnet: settings.adminPaymentWalletMainnet || settings.adminPaymentWallet || '',
        withdrawalMinAmount: settings.withdrawalMinAmount,
        withdrawalStepAmount: settings.withdrawalStepAmount,
        withdrawalCommissionPercent: settings.withdrawalCommissionPercent,
        withdrawalAutoTransfer: settings.withdrawalAutoTransfer,
        withdrawalProcessingDays: settings.withdrawalProcessingDays,
        withdrawalEnabled: settings.withdrawalEnabled,
        withdrawalDisabledMessage: settings.withdrawalDisabledMessage,
        paymentWalletsEnabled: {
            ...defaultPaymentWalletsEnabled,
            ...settings.paymentWalletsEnabled
        }
    });
    const [saving, setSaving] = useState(false);
    const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);

    useEffect(() => {
        setFormData({
            paymentMode: settings.paymentMode,
            usdtAddressTestnet: settings.usdtAddressTestnet || settings.usdtAddress || '',
            usdtAddressMainnet: settings.usdtAddressMainnet || settings.usdtAddress || '',
            subscriptionContractAddress: settings.subscriptionContractAddress,
            investmentContractAddress: settings.investmentContractAddress,
            subscriptionWalletAddress: settings.subscriptionWalletAddress,
            investmentWalletAddress: settings.investmentWalletAddress,
            adminPaymentWalletTestnet: settings.adminPaymentWalletTestnet || settings.adminPaymentWallet || '',
            adminPaymentWalletMainnet: settings.adminPaymentWalletMainnet || settings.adminPaymentWallet || '',
            withdrawalMinAmount: settings.withdrawalMinAmount,
            withdrawalStepAmount: settings.withdrawalStepAmount,
            withdrawalCommissionPercent: settings.withdrawalCommissionPercent,
            withdrawalAutoTransfer: settings.withdrawalAutoTransfer,
            withdrawalProcessingDays: settings.withdrawalProcessingDays,
            withdrawalEnabled: settings.withdrawalEnabled,
            withdrawalDisabledMessage: settings.withdrawalDisabledMessage,
            paymentWalletsEnabled: {
                ...defaultPaymentWalletsEnabled,
                ...settings.paymentWalletsEnabled
            }
        });
    }, [settings]);

    // Ensure we fetch latest settings when the tab is opened
    useEffect(() => {
        refreshSettings();
    }, [refreshSettings]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setSaveResult(null);

        try {
            const isLivePaymentMode = isLivePaymentModeValue(formData.paymentMode);

            // Update settings in database
            const updates = [
                { key: 'payment_mode', value: JSON.stringify(formData.paymentMode) },
                // Keep legacy key in sync with selected mode (backward compatibility)
                { key: 'usdt_address', value: JSON.stringify(isLivePaymentMode ? formData.usdtAddressMainnet : formData.usdtAddressTestnet) },
                { key: 'usdt_address_testnet', value: JSON.stringify(formData.usdtAddressTestnet) },
                { key: 'usdt_address_mainnet', value: JSON.stringify(formData.usdtAddressMainnet) },
                { key: 'subscription_contract_address', value: JSON.stringify(formData.subscriptionContractAddress) },
                { key: 'investment_contract_address', value: JSON.stringify(formData.investmentContractAddress) },
                { key: 'subscription_wallet_address', value: JSON.stringify(formData.subscriptionWalletAddress) },
                { key: 'investment_wallet_address', value: JSON.stringify(formData.investmentWalletAddress) },
                // Keep legacy key in sync with selected mode (backward compatibility)
                { key: 'admin_payment_wallet', value: JSON.stringify(isLivePaymentMode ? formData.adminPaymentWalletMainnet : formData.adminPaymentWalletTestnet) },
                { key: 'admin_payment_wallet_testnet', value: JSON.stringify(formData.adminPaymentWalletTestnet || '') },
                { key: 'admin_payment_wallet_mainnet', value: JSON.stringify(formData.adminPaymentWalletMainnet || '') },
                { key: 'payment_wallets_enabled', value: JSON.stringify(formData.paymentWalletsEnabled) },
                { key: 'withdrawal_min_amount', value: JSON.stringify(formData.withdrawalMinAmount) },
                { key: 'withdrawal_step_amount', value: JSON.stringify(formData.withdrawalStepAmount) },
                { key: 'withdrawal_commission_percent', value: JSON.stringify(formData.withdrawalCommissionPercent) },
                { key: 'withdrawal_auto_transfer', value: JSON.stringify(formData.withdrawalAutoTransfer) },
                { key: 'withdrawal_processing_days', value: JSON.stringify(formData.withdrawalProcessingDays) },
                { key: 'withdrawal_enabled', value: JSON.stringify(formData.withdrawalEnabled) },
                { key: 'withdrawal_disabled_message', value: JSON.stringify(formData.withdrawalDisabledMessage || '') }
            ];

            await adminApi.post('admin-upsert-settings', {
                updates: updates.map((update) => ({
                    key: update.key,
                    value: update.value,
                    description: `${update.key.replace('_', ' ')} setting`
                }))
            });

            // Update context
            updateSettings({
                paymentMode: formData.paymentMode,
                usdtAddressTestnet: formData.usdtAddressTestnet,
                usdtAddressMainnet: formData.usdtAddressMainnet,
                adminPaymentWalletTestnet: formData.adminPaymentWalletTestnet,
                adminPaymentWalletMainnet: formData.adminPaymentWalletMainnet,
                // effective values (AdminContext will also recompute after refresh)
                usdtAddress: isLivePaymentMode ? formData.usdtAddressMainnet : formData.usdtAddressTestnet,
                adminPaymentWallet: isLivePaymentMode ? formData.adminPaymentWalletMainnet : formData.adminPaymentWalletTestnet,
                subscriptionContractAddress: formData.subscriptionContractAddress,
                investmentContractAddress: formData.investmentContractAddress,
                subscriptionWalletAddress: formData.subscriptionWalletAddress,
                investmentWalletAddress: formData.investmentWalletAddress,
                withdrawalMinAmount: formData.withdrawalMinAmount,
                withdrawalStepAmount: formData.withdrawalStepAmount,
                withdrawalCommissionPercent: formData.withdrawalCommissionPercent,
                withdrawalAutoTransfer: formData.withdrawalAutoTransfer,
                withdrawalProcessingDays: formData.withdrawalProcessingDays,
                withdrawalEnabled: formData.withdrawalEnabled,
                withdrawalDisabledMessage: formData.withdrawalDisabledMessage,
                paymentWalletsEnabled: formData.paymentWalletsEnabled
            });

            // Refresh settings from database to ensure sync
            await refreshSettings();

            setSaveResult({
                success: true,
                message: 'Payment settings updated successfully!'
            });
        } catch (error) {
            console.error('Failed to save settings:', error);
            setSaveResult({
                success: false,
                message: 'Failed to save settings. Please try again.'
            });
        } finally {
            setSaving(false);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFormData(prev => ({
            ...prev,
            [e.target.name]: e.target.value
        }));
    };

    const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const parsed = Number(e.target.value);
        setFormData(prev => ({
            ...prev,
            [e.target.name]: Number.isFinite(parsed) ? parsed : 0
        }));
    };

    const handleToggleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData(prev => ({
            ...prev,
            [e.target.name]: e.target.checked
        }));
    };

    const handleWalletToggle = (walletKey: keyof typeof defaultPaymentWalletsEnabled) => {
        setFormData(prev => ({
            ...prev,
            paymentWalletsEnabled: {
                ...prev.paymentWalletsEnabled,
                [walletKey]: !prev.paymentWalletsEnabled[walletKey]
            }
        }));
    };

    if (loading) {
        return (
            <div className="bg-white rounded-xl shadow-sm p-6">
                <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    <span className="ml-3 text-gray-600">Loading settings...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center space-x-3 mb-6">
                <div className="bg-blue-100 p-3 rounded-lg">
                    <Settings className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                    <h3 className="text-lg font-semibold text-gray-900">Payment Settings</h3>
                    <p className="text-gray-600">Configure basic payment settings</p>
                </div>
            </div>

            {saveResult && (
                <div className={`border rounded-lg p-4 mb-6 ${
                    saveResult.success
                        ? 'bg-green-50 border-green-200'
                        : 'bg-red-50 border-red-200'
                }`}>
                    <div className="flex items-center space-x-2">
                        {saveResult.success ? (
                            <CheckCircle className="h-5 w-5 text-green-600" />
                        ) : (
                            <AlertCircle className="h-5 w-5 text-red-600" />
                        )}
                        <span className={`text-sm font-medium ${
                            saveResult.success ? 'text-green-800' : 'text-red-800'
                        }`}>
                            {saveResult.message}
                        </span>
                    </div>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">

                <div className="border border-gray-200 rounded-lg p-6">
                    <div>
                        <label htmlFor="paymentMode" className="block text-sm font-medium text-gray-700 mb-2">
                            Payment Mode Name *
                        </label>
                        <select
                            id="paymentMode"
                            name="paymentMode"
                            onChange={handleChange}
                            value={formData.paymentMode}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                            <option value="0">Test</option>
                            <option value="1">Live</option>
                        </select>
                    </div>

                    <div>
                        <label htmlFor="usdtAddressTestnet" className="block text-sm font-medium text-gray-700 mb-2">
                            USDT Token Contract Address (Testnet) *
                        </label>
                        <input
                            type="text"
                            id="usdtAddressTestnet"
                            name="usdtAddressTestnet"
                            required
                            pattern="^0x[a-fA-F0-9]{40}$"
                            title="Enter a valid contract address (0x + 40 hex characters)"
                            value={formData.usdtAddressTestnet}
                            onChange={handleChange}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="Enter USDT token contract address for BSC Testnet"
                        />
                        <p className="text-xs text-gray-500 mt-2">
                            This is the token contract address (same for all customers). MetaMask may show multiple tokens named “USDT” — the system uses the contract configured here.
                        </p>
                    </div>

                    <div className="mt-6">
                        <label htmlFor="usdtAddressMainnet" className="block text-sm font-medium text-gray-700 mb-2">
                            USDT Token Contract Address (Mainnet) *
                        </label>
                        <input
                            type="text"
                            id="usdtAddressMainnet"
                            name="usdtAddressMainnet"
                            required
                            pattern="^0x[a-fA-F0-9]{40}$"
                            title="Enter a valid contract address (0x + 40 hex characters)"
                            value={formData.usdtAddressMainnet}
                            onChange={handleChange}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="Enter USDT token contract address for BSC Mainnet"
                        />
                    </div>
                </div>

                <div className="border border-gray-200 rounded-lg p-6">
                    <div>
                        <label htmlFor="adminPaymentWallet" className="block text-sm font-medium text-gray-700 mb-2">
                            Admin Wallet Address (Receives Registration USDT) — Testnet *
                        </label>
                        <input
                            type="text"
                            id="adminPaymentWalletTestnet"
                            name="adminPaymentWalletTestnet"
                            required
                            pattern="^0x[a-fA-F0-9]{40}$"
                            title="Enter a valid wallet address (0x + 40 hex characters)"
                            value={formData.adminPaymentWalletTestnet}
                            onChange={handleChange}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="Enter receiving wallet for registration payments (testnet)"
                        />
                        <p className="text-xs text-gray-500 mt-2">
                            This must be your wallet address (not a token contract address). Customers will transfer USDT to this address during registration.
                        </p>
                    </div>

                    <div className="mt-6">
                        <label htmlFor="adminPaymentWalletMainnet" className="block text-sm font-medium text-gray-700 mb-2">
                            Admin Wallet Address (Receives Registration USDT) — Mainnet *
                        </label>
                        <input
                            type="text"
                            id="adminPaymentWalletMainnet"
                            name="adminPaymentWalletMainnet"
                            required
                            pattern="^0x[a-fA-F0-9]{40}$"
                            title="Enter a valid wallet address (0x + 40 hex characters)"
                            value={formData.adminPaymentWalletMainnet}
                            onChange={handleChange}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="Enter receiving wallet for registration payments (mainnet)"
                        />
                    </div>

                    <div className="mt-6">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Enabled Wallets for Registration Payments
                        </label>
                        <div className="flex flex-wrap gap-4">
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                    type="checkbox"
                                    checked={formData.paymentWalletsEnabled.trust_wallet}
                                    onChange={() => handleWalletToggle('trust_wallet')}
                                    className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                                />
                                Trust Wallet
                            </label>
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                    type="checkbox"
                                    checked={formData.paymentWalletsEnabled.metamask}
                                    onChange={() => handleWalletToggle('metamask')}
                                    className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                                />
                                MetaMask
                            </label>
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                    type="checkbox"
                                    checked={formData.paymentWalletsEnabled.safepal}
                                    onChange={() => handleWalletToggle('safepal')}
                                    className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                                />
                                SafePal
                            </label>
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                    type="checkbox"
                                    checked={formData.paymentWalletsEnabled.tokenpocket}
                                    onChange={() => handleWalletToggle('tokenpocket')}
                                    className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                                />
                                TokenPocket
                            </label>
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                    type="checkbox"
                                    checked={formData.paymentWalletsEnabled.bitget}
                                    onChange={() => handleWalletToggle('bitget')}
                                    className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                                />
                                Bitget Wallet
                            </label>
                        </div>
                    </div>
                </div>

                <div className="border border-gray-200 rounded-lg p-6">
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Withdrawal Settings
                        </label>
                        <p className="text-xs text-gray-500">
                            Configure minimums, step size, and commission for customer withdrawals.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="withdrawalMinAmount" className="block text-sm font-medium text-gray-700 mb-2">
                                Minimum Withdrawal Amount (USDT)
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                id="withdrawalMinAmount"
                                name="withdrawalMinAmount"
                                value={formData.withdrawalMinAmount}
                                onChange={handleNumberChange}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                placeholder="10"
                            />
                        </div>
                        <div>
                            <label htmlFor="withdrawalStepAmount" className="block text-sm font-medium text-gray-700 mb-2">
                                Withdrawal Step Amount (USDT)
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                min="0.01"
                                id="withdrawalStepAmount"
                                name="withdrawalStepAmount"
                                value={formData.withdrawalStepAmount}
                                onChange={handleNumberChange}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                placeholder="10"
                            />
                        </div>
                        <div>
                            <label htmlFor="withdrawalCommissionPercent" className="block text-sm font-medium text-gray-700 mb-2">
                                Withdrawal Commission (%)
                            </label>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                id="withdrawalCommissionPercent"
                                name="withdrawalCommissionPercent"
                                value={formData.withdrawalCommissionPercent}
                                onChange={handleNumberChange}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                placeholder="0.5"
                            />
                        </div>
                        <div className="flex items-center">
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                    type="checkbox"
                                    name="withdrawalAutoTransfer"
                                    checked={formData.withdrawalAutoTransfer}
                                    onChange={handleToggleChange}
                                    className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                                />
                                Auto-transfer withdrawals (no admin approval)
                            </label>
                        </div>
                        <div className="flex items-center">
                            <label className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                    type="checkbox"
                                    name="withdrawalEnabled"
                                    checked={formData.withdrawalEnabled}
                                    onChange={handleToggleChange}
                                    className="h-4 w-4 text-blue-600 border-gray-300 rounded"
                                />
                                Enable withdrawals
                            </label>
                        </div>
                        {!formData.withdrawalEnabled && (
                            <div className="md:col-span-2">
                                <label htmlFor="withdrawalDisabledMessage" className="block text-sm font-medium text-gray-700 mb-2">
                                    Disabled Message
                                </label>
                                <input
                                    type="text"
                                    id="withdrawalDisabledMessage"
                                    name="withdrawalDisabledMessage"
                                    value={formData.withdrawalDisabledMessage}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                    placeholder="Withdrawals are disabled temporarily"
                                />
                                <p className="text-xs text-gray-500 mt-2">
                                    This message is shown to customers if they attempt a withdrawal while disabled.
                                </p>
                            </div>
                        )}
                        <div>
                            <label htmlFor="withdrawalProcessingDays" className="block text-sm font-medium text-gray-700 mb-2">
                                Processing Days (Working Days)
                            </label>
                            <input
                                type="number"
                                step="1"
                                min="1"
                                id="withdrawalProcessingDays"
                                name="withdrawalProcessingDays"
                                value={formData.withdrawalProcessingDays}
                                onChange={handleNumberChange}
                                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                placeholder="5"
                            />
                        </div>
                    </div>
                </div>

                <div className="border border-gray-200 rounded-lg p-6">
                    <div>
                        <label htmlFor="subscriptionContractAddress" className="block text-sm font-medium text-gray-700 mb-2">
                            Subscription Contract Address *
                        </label>
                        <input
                            type="text"
                            id="subscriptionContractAddress"
                            name="subscriptionContractAddress"
                            required
                            value={formData.subscriptionContractAddress}
                            onChange={handleChange}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="Enter Subscription contract address"
                        />
                    </div>
                    <div>
                        <label htmlFor="subscriptionWalletAddress" className="block text-sm font-medium text-gray-700 mb-2">
                            Subscription Wallet Address *
                        </label>
                        <input
                            type="text"
                            id="subscriptionWalletAddress"
                            name="subscriptionWalletAddress"
                            required
                            value={formData.subscriptionWalletAddress}
                            onChange={handleChange}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="Enter Subscription wallet address"
                        />
                    </div>

                </div>

                <div className="border border-gray-200 rounded-lg p-6">
                    <div>
                        <label htmlFor="investmentContractAddress" className="block text-sm font-medium text-gray-700 mb-2">
                            Investment Contract Address *
                        </label>
                        <input
                            type="text"
                            id="investmentContractAddress"
                            name="investmentContractAddress"
                            required
                            value={formData.investmentContractAddress}
                            onChange={handleChange}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="Enter Investment contract address"
                        />
                    </div>

                    <div>
                        <label htmlFor="investmentWalletAddress" className="block text-sm font-medium text-gray-700 mb-2">
                            Investment Wallet Address *
                        </label>
                        <input
                            type="text"
                            id="investmentWalletAddress"
                            name="investmentWalletAddress"
                            required
                            value={formData.investmentWalletAddress}
                            onChange={handleChange}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="Enter Investment wallet address"
                        />
                    </div>
                </div>


                <div className="flex justify-end">
                    <button
                        type="submit"
                        disabled={saving}
                        className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
                    >
                        {saving ? (
                            <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                <span>Saving...</span>
                            </>
                        ) : (
                            <>
                                <Save className="h-4 w-4" />
                                <span>Save Settings</span>
                            </>
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default PaymentSettings;
