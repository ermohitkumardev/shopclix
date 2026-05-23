import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useAdmin } from '../../contexts/AdminContext';
import { useNotification } from '../../components/ui/NotificationProvider';
import { WalletService } from '../../services/walletService';
import { getSponsorStatusBySponsorshipNumber } from '../../lib/supabase';
import { WalletInfo as WalletInfoType, WalletState, TransactionState } from '../../types/wallet';
import { WalletInfo as WalletInfoCard } from '../../components/payment/WalletInfo';
import { CheckCircle, Wallet, Shield, CreditCard, Loader, XCircle, ExternalLink, Copy, PlusCircle } from 'lucide-react';
import { extractEdgeFunctionErrorMessage, isRetryableEdgeFunctionError } from '../../utils/edgeFunctionError';

interface RegistrationPlan {
  tsp_id: string;
  tsp_name: string;
  tsp_description: string;
  tsp_price: number;
  tsp_duration_days?: number;
  tsp_features: any;
  tsp_parent_income?: number;
}

const PAYMENT_POLL_INTERVAL = 5000;
const MANUAL_RECOVERY_ENABLE_DELAY_MS = 30000;
const AUTO_RECOVERY_INTERVAL_MS = 15000;
const AUTO_RECOVERY_MAX_ATTEMPTS = 12;
// 24 attempts × 5s = 120s total — gives more time on slow Android networks
const PAYMENT_POLL_ATTEMPTS = 24;
// Android MetaMask can take much longer to return from the wallet app; use 90s
const PAYMENT_REQUEST_TIMEOUT_MS = 90000;
const PAYMENT_RECOVERY_STORAGE_KEY = 'registration_payment_recovery_attempt';
const LAST_CUSTOMER_ROUTE_STORAGE_KEY = 'last_customer_route';
// Persists the tx hash the instant the wallet confirms it, so we can resume verification
// if Android MetaMask causes a page reload before verification completes.
const PENDING_TX_HASH_KEY = 'registration_payment_pending_tx';

const savePendingTxHash = (txHash: string) => {
  try {
    sessionStorage.setItem(PENDING_TX_HASH_KEY, txHash);
    localStorage.setItem(PENDING_TX_HASH_KEY, txHash);
  } catch { /* storage may be unavailable */ }
};

const loadPendingTxHash = (): string | null => {
  try {
    return sessionStorage.getItem(PENDING_TX_HASH_KEY) || localStorage.getItem(PENDING_TX_HASH_KEY) || null;
  } catch {
    return null;
  }
};

const clearPendingTxHash = () => {
  try {
    sessionStorage.removeItem(PENDING_TX_HASH_KEY);
    localStorage.removeItem(PENDING_TX_HASH_KEY);
  } catch { /* ignore */ }
};

const isAlreadyProcessedRegistrationPayment = (value: any) => {
  const message = String(
    value?.error ||
    value?.message ||
    value?.gatewayResponse?.error ||
    value?.gatewayResponse?.message ||
    ''
  ).toLowerCase();

  return (
    message.includes('transaction already processed for registration payment') ||
    message.includes('registration payment already completed')
  );
};

interface PaymentRecoveryAttempt {
  userId: string;
  walletAddress: string;
  toAddress: string;
  amount: number;
  chainId: number | null;
  usdtAddress: string | null;
  startedAt: string;
  startBlock: number | null;
}

let cachedRegistrationPlan: RegistrationPlan | null = null;
let inFlightRegistrationPlanRequest: Promise<RegistrationPlan | null> | null = null;

const RegistrationPayment: React.FC = () => {
  const navigate = useNavigate();
  const { user, fetchUserData } = useAuth();
  const { settings, loading: settingsLoading } = useAdmin();
  const notification = useNotification();
  const [plan, setPlan] = useState<RegistrationPlan | null>(cachedRegistrationPlan);
  const [loading, setLoading] = useState(!cachedRegistrationPlan);

  const [walletService] = useState(() => WalletService.getInstance());
  const [availableWallets, setAvailableWallets] = useState<WalletInfoType[]>(() =>
    typeof window === 'undefined' ? [] : WalletService.getInstance().detectWallets()
  );
  const [walletState, setWalletState] = useState<WalletState>(() =>
    WalletService.getInstance().getCurrentWalletState()
  );
  const [refreshingBalances, setRefreshingBalances] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  const [transaction, setTransaction] = useState<TransactionState>({
    isProcessing: false,
    hash: null,
    status: 'idle',
    error: null,
    distributionSteps: [],
  });
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [parentAccountError, setParentAccountError] = useState<string | null>(null);
  const [reverifyHash, setReverifyHash] = useState('');
  const [reverifyProcessing, setReverifyProcessing] = useState(false);
  const [manualRecoveryProcessing, setManualRecoveryProcessing] = useState(false);
  const [manualRecoveryReady, setManualRecoveryReady] = useState(false);
  const [manualRecoveryAvailable, setManualRecoveryAvailable] = useState(false);
  const recoveryCheckInFlightRef = useRef(false);
  // Captures the tx hash from transferPromise even if it resolves after the timeout race
  const lateHashRef = useRef<string | null>(null);
  // Prevents the page-reload auto-resume from firing more than once per mount
  const autoResumeAttemptedRef = useRef(false);
  // Prevents durable recovery from running repeatedly after Android reloads the component.
  const durableRecoveryAttemptedRef = useRef(false);
  const softWalletRefreshInFlightRef = useRef(false);
  const autoRecoveryAttemptsRef = useRef(0);
  // Set to true the moment we navigate to the success page so the dashboard-redirect
  // useEffect does not override the navigation while the component is still mounted.
  const navigatingToSuccessRef = useRef(false);

  useEffect(() => {
    if (!user) {
      navigate('/customer/login');
      return;
    }

    if (!settingsLoading && (settings.launchPhase || 'prelaunch') === 'launched') {
      navigate('/subscription-plans', { replace: true });
      return;
    }

    if (user.hasActiveSubscription || user.registrationPaid) {
      // If we're already navigating to the success page, or there's a pending tx hash
      // in storage (auto-resume will handle it), don't redirect to dashboard.
      if (!navigatingToSuccessRef.current && !loadPendingTxHash()) {
        navigate('/customer/dashboard', { replace: true });
      }
      return;
    }

    if (typeof window !== 'undefined') {
      const routeState = JSON.stringify({ path: '/registration-payment', savedAt: Date.now() });
      sessionStorage.setItem(LAST_CUSTOMER_ROUTE_STORAGE_KEY, routeState);
      localStorage.setItem(LAST_CUSTOMER_ROUTE_STORAGE_KEY, routeState);
    }

    const loadRegistrationData = async () => {
      try {
        const planRequest =
          inFlightRegistrationPlanRequest ??
          supabase
            .from('tbl_subscription_plans')
            .select('*')
            .eq('tsp_type', 'registration')
            .eq('tsp_is_active', true)
            .maybeSingle()
            .then(({ data, error }) => {
              if (error) throw error;
              return data as RegistrationPlan | null;
            });

        inFlightRegistrationPlanRequest = planRequest;
        const data = await planRequest;

        if (!data) {
          notification.showError('Error', 'No active registration plan found');
          navigate('/customer/dashboard');
          return;
        }

        cachedRegistrationPlan = data;
        setPlan(data);
      } catch (error: any) {
        notification.showError('Load Failed', error.message);
      } finally {
        inFlightRegistrationPlanRequest = null;
        setLoading(false);
      }
    };

    if (cachedRegistrationPlan) {
      setPlan(cachedRegistrationPlan);
      setLoading(false);
      return;
    }

    loadRegistrationData();
  }, [user, settings.launchPhase, settingsLoading, navigate, notification]);

  useEffect(() => {
    const validateParentAccount = async () => {
      if (!user?.id) return;

      try {
        console.log('🔎 Validating Parent A/C for user:', user.id);
        const { data: profile } = await supabase
          .from('tbl_user_profiles')
          .select('tup_parent_account')
          .eq('tup_user_id', user.id)
          .maybeSingle();

        const parentAccount = profile?.tup_parent_account?.trim();
        console.log('🔎 Parent A/C (tup_parent_account):', parentAccount || '(empty)');
        if (!parentAccount) {
          setParentAccountError(null);
          return;
        }

        const sponsorStatus = await getSponsorStatusBySponsorshipNumber(parentAccount);
        console.log('🔎 Sponsor status lookup result:', sponsorStatus || null);
        if (!sponsorStatus?.user_id) {
          setParentAccountError('Parent A/C not found. Please contact support.');
          return;
        }

        if (!sponsorStatus.is_active) {
          setParentAccountError('Parent A/C must be active and registration-paid to continue. Please contact support or choose a verified parent.');
          return;
        }

        if (!sponsorStatus.is_registration_paid) {
          setParentAccountError('Parent A/C must be active and registration-paid to continue. Please contact support or choose a verified parent.');
          return;
        }

        if (!sponsorStatus.email_verified && !sponsorStatus.mobile_verified) {
          setParentAccountError('Parent A/C must be verified to continue. Please contact support or choose a verified parent.');
          return;
        }

        console.log('✅ Parent A/C validation passed');
        setParentAccountError(null);
      } catch (error) {
        console.error('Error validating parent account:', error);
        setParentAccountError('Unable to verify Parent A/C. Please try again later.');
      }
    };

    validateParentAccount();
  }, [user?.id]);

  // On Android MetaMask the DApp browser may fully reload the page when switching back from
  // the wallet app. If that happens, the tx hash that sendUSDTTransfer returned is gone from
  // memory. We persist it to sessionStorage/localStorage the instant we receive it, and here
  // we pick it back up and resume verification automatically so the payment completes.
  useEffect(() => {
    if (!user || !plan || loading || settingsLoading) return;
    if (user.hasActiveSubscription || user.registrationPaid) return;
    if (autoResumeAttemptedRef.current) return;
    autoResumeAttemptedRef.current = true;

    const pendingHash = loadPendingTxHash();
    if (!pendingHash || !/^0x[a-fA-F0-9]{64}$/.test(pendingHash)) return;

    const resume = async () => {
      setTransaction({
        isProcessing: true,
        hash: pendingHash,
        status: 'pending',
        error: null,
        distributionSteps: ['Resumed verification after page reload (Android MetaMask)'],
      });
      setStatusMessage('Resuming payment verification...');
      scrollToPaymentStatus();

      try {
        const result = await pollVerification(pendingHash);
        clearPendingTxHash();
        clearRecoveryAttempt();
        setTransaction({
          isProcessing: false,
          hash: pendingHash,
          status: 'success',
          error: null,
          distributionSteps: ['Payment verified after page reload (Android MetaMask)'],
        });
        setStatusMessage('Payment confirmed!');
        notification.showSuccess('Payment Successful', 'Your registration payment was confirmed.');
        navigatingToSuccessRef.current = true;
        navigate('/registration-payment-success', {
          state: {
            txHash: pendingHash,
            amount: result.amount || plan.tsp_price,
            network: result.network
          }
        });
        void fetchUserData(user!.id);
      } catch (verifyError: any) {
        clearPendingTxHash();
        await saveRegistrationPaymentIssue(pendingHash, verifyError, ['Resumed after page reload']);
        const userMessage = getStuckPaymentMessage(verifyError, pendingHash);
        setTransaction({
          isProcessing: false,
          hash: pendingHash,
          status: 'error',
          error: userMessage,
          distributionSteps: ['Resumed after page reload'],
        });
        setStatusMessage(null);
        notification.showError('Payment Stuck', userMessage);
      }
    };

    resume();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, plan, loading, settingsLoading]);

  // On Android MetaMask, the page may NOT fully reload — it just becomes visible again via
  // document.visibilitychange when the user switches back from the wallet app. In that case
  // the lateHashRef approach should still work, but if the timeout has already passed and
  // we have a pending hash in storage, kick off verification immediately.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;

      const pendingHash = loadPendingTxHash();
      if (!pendingHash || !/^0x[a-fA-F0-9]{64}$/.test(pendingHash)) return;

      // Only start if we're not already processing
      setTransaction(prev => {
        if (prev.isProcessing) return prev;
        // Kick off verification for the persisted hash
        (async () => {
          setTransaction({
            isProcessing: true,
            hash: pendingHash,
            status: 'pending',
            error: null,
            distributionSteps: ['Resuming verification after returning from wallet...'],
          });
          setStatusMessage('Checking transaction on blockchain...');
          try {
            const result = await pollVerification(pendingHash);
            clearPendingTxHash();
            clearRecoveryAttempt();
            setTransaction({
              isProcessing: false,
              hash: pendingHash,
              status: 'success',
              error: null,
              distributionSteps: ['Payment confirmed after returning from wallet'],
            });
            setStatusMessage('Payment confirmed!');
            notification.showSuccess('Payment Successful', 'Your registration payment was confirmed.');
            navigatingToSuccessRef.current = true;
            const planRef = plan;
            navigate('/registration-payment-success', {
              state: {
                txHash: pendingHash,
                amount: result.amount || planRef?.tsp_price,
                network: result.network
              }
            });
            const currentUser = user;
            if (currentUser) void fetchUserData(currentUser.id);
          } catch (verifyError: any) {
            clearPendingTxHash();
            await saveRegistrationPaymentIssue(pendingHash, verifyError, ['Resumed from visibility change']);
            const userMessage = getStuckPaymentMessage(verifyError, pendingHash);
            setTransaction({
              isProcessing: false,
              hash: pendingHash,
              status: 'error',
              error: userMessage,
              distributionSteps: ['Resumed from visibility change'],
            });
            setStatusMessage(null);
            notification.showError('Payment Stuck', userMessage);
          }
        })();
        return { ...prev, isProcessing: true };
      });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, plan, navigate, notification, fetchUserData]);

  useEffect(() => {
    if (!settings) return;

    walletService.setAdminSettings({
      paymentMode: settings.paymentMode?.toString() || '0',
      usdtAddress: settings.usdtAddress || '',
      subscriptionContractAddress: settings.subscriptionContractAddress || '',
      subscriptionWalletAddress: settings.subscriptionWalletAddress || ''
    });

    // If already connected, refresh balances using the currently configured USDT contract.
    if (walletState.isConnected) {
      let cancelled = false;
      void (async () => {
        setRefreshingBalances(true);
        try {
          const updated = await walletService.syncCurrentWalletState();
          if (!cancelled) setWalletState(updated);
        } catch (error) {
          // ignore: UI will still show previous state; user can reconnect
          console.warn('Failed to sync wallet balances after settings change:', error);
        } finally {
          if (!cancelled) setRefreshingBalances(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
  }, [settings, walletService]);

  useEffect(() => {
    const refreshDetectedWallets = () => {
      setAvailableWallets(walletService.detectWallets());
    };

    refreshDetectedWallets();

    const timeoutIds = [250, 1000, 2500].map((delay) =>
      window.setTimeout(refreshDetectedWallets, delay)
    );

    window.addEventListener('load', refreshDetectedWallets);
    window.addEventListener('focus', refreshDetectedWallets);
    window.addEventListener('ethereum#initialized', refreshDetectedWallets as EventListener);

    return () => {
      timeoutIds.forEach((id) => window.clearTimeout(id));
      window.removeEventListener('load', refreshDetectedWallets);
      window.removeEventListener('focus', refreshDetectedWallets);
      window.removeEventListener('ethereum#initialized', refreshDetectedWallets as EventListener);
    };
  }, [walletService]);

  // Restore wallet state from service if the component re-mounts
  useEffect(() => {
    if (isConnecting) return;
    const currentWalletState = walletService.getCurrentWalletState();
    if (currentWalletState.isConnected && !walletState.isConnected) {
      setWalletState(currentWalletState);
      console.log('Restored wallet state from WalletService:', currentWalletState.address);
    }
  }, [walletService, walletState.isConnected, isConnecting]);

  const enabledWallets = useMemo(() => {
    return settings?.paymentWalletsEnabled || {
      trust_wallet: true,
      metamask: true,
      safepal: true
    };
  }, [settings]);

  const filteredWallets = useMemo(() => {
    return availableWallets.filter((wallet) => {
      if (wallet.name === 'Trust Wallet') return enabledWallets.trust_wallet;
      if (wallet.name === 'MetaMask') return enabledWallets.metamask;
      if (wallet.name === 'SafePal') return enabledWallets.safepal;
      return false;
    });
  }, [availableWallets, enabledWallets]);

  const adminReceivingWallet = useMemo(() => {
    return String(settings?.adminPaymentWallet || '').trim();
  }, [settings?.adminPaymentWallet]);

  const formatAddress = useCallback((address: string) => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }, []);

  const copyToClipboard = useCallback(async (value: string) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return;
    try {
      await navigator.clipboard.writeText(trimmed);
      notification.showSuccess('Copied', 'Copied to clipboard');
    } catch {
      // ignore (clipboard may be blocked); user can still select text
    }
  }, [notification]);

  const handleAddUsdtToken = useCallback(async () => {
    try {
      const added = await walletService.watchUSDTToken();
      if (added) {
        notification.showSuccess('Token Added', 'USDT token was added to your wallet.');
      } else {
        notification.showError('Not Added', 'Token was not added. Please add it manually using the contract address.');
      }
    } catch (error: any) {
      notification.showError('Unable to Add Token', error?.message || 'Please add the token manually using the contract address.');
    }
  }, [walletService, notification]);

  const prepareAndroidMetaMaskToken = useCallback(async () => {
    if (typeof navigator === 'undefined') return;
    const isAndroid = /Android/i.test(navigator.userAgent || '');
    const isMetaMask = String(walletState.walletName || '').toLowerCase().includes('metamask');
    if (!isAndroid || !isMetaMask) return;

    try {
      setStatusMessage('Preparing USDT token in MetaMask...');
      await walletService.watchUSDTToken();
    } catch (error: any) {
      // Non-fatal: MetaMask can still send the transfer, but may show the token as Unknown.
      console.warn('Unable to prepare USDT token metadata before payment:', error);
    }
  }, [walletService, walletState.walletName]);

  const payNowDisabledReason = useMemo(() => {
    if (settingsLoading) return 'Loading payment settings...';
    if (parentAccountError) return parentAccountError;
    if (!walletState.isConnected || !walletState.address) return 'Please connect your wallet to continue.';
    if (walletState.warning) return walletState.warning;
    if (transaction.isProcessing) return 'A payment is already being processed.';
    if (!adminReceivingWallet) return 'Admin receiving wallet is not configured yet.';
    return null;
  }, [
    settingsLoading,
    parentAccountError,
    walletState.isConnected,
    walletState.address,
    walletState.warning,
    transaction.isProcessing,
    adminReceivingWallet
  ]);

	  const saveWalletConnection = useCallback(async (address: string, walletName: string, walletType: string, chainId: number | null) => {
	    if (!user || !address) return;

	    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

	    const maxAttempts = 3;
	    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
	      try {
	        // If session isn't hydrated yet, Supabase may not send Authorization. Wait briefly and retry.
	        const { data: sessionData } = await supabase.auth.getSession();
	        if (!sessionData.session?.access_token) {
	          if (attempt < maxAttempts) {
	            await sleep(300 * attempt);
	            continue;
	          }
	          console.warn('Skipping wallet connection upsert: no active session yet.');
	          return;
	        }

	        const { data, error } = await supabase.functions.invoke('upsert-wallet-connection', {
	          body: {
	            wallet_address: address,
	            wallet_name: walletName,
	            wallet_type: walletType,
	            chain_id: chainId
	          }
	        });

	        if (error) {
	          if (isRetryableEdgeFunctionError(error) && attempt < maxAttempts) {
	            await sleep(500 * attempt);
	            continue;
	          }
	          const message = await extractEdgeFunctionErrorMessage(error);
	          console.warn('Failed to save wallet connection (non-fatal):', message);
	          return;
	        }

	        if (!data?.success) {
	          console.warn('Failed to save wallet connection (non-fatal):', data?.error || 'Unknown error');
	          return;
	        }

	        return;
	      } catch (error) {
	        if (attempt < maxAttempts) {
	          await sleep(500 * attempt);
	          continue;
	        }
	        console.warn('Error saving wallet connection (non-fatal):', error);
	        return;
	      }
	    }
	  }, [user]);

  const handleWalletConnect = useCallback(async (provider: any) => {
    if (isConnecting) return;

		    setIsConnecting(true);
		    try {
		      const wallet = await walletService.connectWallet(provider);
		      setWalletState(wallet);

	      if (wallet.address) {
	        const walletType = provider.isSafePal
            ? 'safepal'
            : (provider.isTrust || provider.isTrustWallet)
              ? 'trust'
              : provider.isMetaMask
                ? 'metamask'
                : 'web3';

	        // Best-effort: don't fail wallet connection if this transiently fails (502 etc).
	        void saveWalletConnection(
	          wallet.address,
	          wallet.walletName || 'Unknown Wallet',
	          walletType,
	          wallet.chainId
	        );
	      }

	      notification.showSuccess('Wallet Connected', `Connected to ${wallet.walletName}`);
	    } catch (error: any) {
	      notification.showError('Connection Failed', error.message || 'Unable to connect wallet');
	      walletService.disconnect();
	      setWalletState({
	        isConnected: false,
	        address: null,
	        chainId: null,
        balance: '0',
        usdtBalance: '0',
        walletName: null,
        warning: null,
      });
    } finally {
      setIsConnecting(false);
    }
  }, [isConnecting, settings, walletService, notification, saveWalletConnection]);

  const handleWalletDisconnect = () => {
    walletService.disconnect();
    setWalletState({
      isConnected: false,
      address: null,
      chainId: null,
      balance: '0',
      usdtBalance: '0',
      walletName: null,
      warning: null,
    });
    setTransaction({
      isProcessing: false,
      hash: null,
      status: 'idle',
      error: null,
      distributionSteps: [],
    });
    setStatusMessage(null);
  };

  const verifyPayment = async (txHash: string) => {
    // Refresh the session token before each call — Android MetaMask flows can take
    // 2+ minutes (90s timeout + 30s late hash wait), and Supabase tokens expire in 1 hour
    // but the client may silently have an expired short-lived token.
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;

    if (!token) {
      throw new Error('Missing user session');
    }

    let response: Response;
    try {
      response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-registration-payment`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ txHash })
      });
    } catch (networkError: any) {
      // Network-level failure (no connectivity, DNS, etc.) — treat as retriable
      return {
        success: false,
        status: 'pending',
        retriable: true,
        error: networkError?.message || 'Network error — retrying...'
      };
    }

    let result: any;
    try {
      result = await response.json();
    } catch {
      // Unparseable response — treat as retriable server error
      return {
        success: false,
        status: 'pending',
        retriable: true,
        error: `Server returned HTTP ${response.status} with no JSON body`
      };
    }

    // 5xx server errors are transient — retry
    if (response.status >= 500) {
      return { ...result, retriable: true, status: result.status || 'pending' };
    }

    // 404 "Transaction not found on network" is transient — the node may not have
    // propagated the tx yet (common on Android where the hash arrives quickly but
    // the BSC node hasn't indexed it). Retry instead of failing.
    if (response.status === 404) {
      return { ...result, retriable: true, status: 'pending' };
    }

    // 401/403 — session problem, non-retriable
    if (response.status === 401 || response.status === 403) {
      return { ...result, retriable: false };
    }

    // All other cases: return the result with the http status so the caller can decide
    return { ...result, httpStatus: response.status };
  };

  const pollVerification = async (txHash: string) => {
    for (let attempt = 0; attempt < PAYMENT_POLL_ATTEMPTS; attempt += 1) {
      let result: any;
      try {
        result = await verifyPayment(txHash);
      } catch (fetchError: any) {
        // verifyPayment only throws for session errors — those are non-retriable
        const error = new Error(fetchError?.message || 'Session error during payment verification');
        (error as any).gatewayResponse = { status: 'session_error' };
        throw error;
      }

      if (result.status === 'success') {
        return result;
      }

      // Retriable result — just wait and continue polling
      if (result.retriable === true || result.status === 'pending') {
        setStatusMessage(
          result.message ||
          `Payment submitted. Confirming blockchain transaction... (${attempt + 1}/${PAYMENT_POLL_ATTEMPTS})`
        );
        await new Promise(resolve => setTimeout(resolve, PAYMENT_POLL_INTERVAL));
        continue;
      }

      // Definitive failure: the edge function returned a clear error (wrong amount,
      // wallet mismatch, already completed, on-chain failure, etc.).
      // Only throw immediately for these — do NOT retry.
      if (result.status === 'failed' || result.success === false) {
        if (isAlreadyProcessedRegistrationPayment(result) && user?.id) {
          const { data: completedPayment } = await supabase
            .from('tbl_payments')
            .select('tp_amount, tp_network, tp_payment_status')
            .eq('tp_transaction_id', txHash)
            .eq('tp_user_id', user.id)
            .eq('tp_payment_status', 'completed')
            .maybeSingle();

          if (completedPayment) {
            return {
              success: true,
              status: 'success',
              txHash,
              amount: Number(completedPayment.tp_amount || plan?.tsp_price || 0),
              network: completedPayment.tp_network || undefined,
              alreadyProcessed: true
            };
          }
        }

        const error = new Error(result.error || 'Payment failed');
        (error as any).gatewayResponse = result;
        throw error;
      }

      // Unknown status — treat as retriable to be safe
      setStatusMessage(
        `Confirming payment... (${attempt + 1}/${PAYMENT_POLL_ATTEMPTS})`
      );
      await new Promise(resolve => setTimeout(resolve, PAYMENT_POLL_INTERVAL));
    }

    const error = new Error('Payment confirmation timed out. Please check again later.');
    (error as any).gatewayResponse = {
      status: 'timeout',
      message: 'Payment confirmation timed out',
      attempts: PAYMENT_POLL_ATTEMPTS,
      interval_ms: PAYMENT_POLL_INTERVAL
    };
    throw error;
  };

  const safeSerializeGatewayResponse = (error: any, txHash: string | null, steps: string[]) => {
    const isLivePaymentMode =
      settings?.paymentMode === true ||
      settings?.paymentMode === 1 ||
      settings?.paymentMode === '1' ||
      settings?.paymentMode === 'true';
    const gatewayResponse = error?.gatewayResponse || error?.response?.data || error?.data || error?.info || null;
    const rawError: Record<string, any> = {};

    if (error && typeof error === 'object') {
      [
        'name',
        'message',
        'code',
        'reason',
        'action',
        'shortMessage',
        'details',
        'method',
        'transaction',
        'receipt',
        'error'
      ].forEach((key) => {
        if (error[key] !== undefined) rawError[key] = error[key];
      });
    }

    const payload = {
      blockchain: isLivePaymentMode ? 'BSC Mainnet' : 'BSC Testnet',
      usdt_contract: settings?.usdtAddress || null,
      admin_wallet: adminReceivingWallet || null,
      transaction_hash: txHash,
      wallet_address: walletState.address,
      wallet_name: walletState.walletName,
      chain_id: walletState.chainId,
      processed_at: new Date().toISOString(),
      status: txHash ? 'stuck' : 'failed',
      error: error?.message || 'Payment failed',
      gateway_response: gatewayResponse,
      raw_error: rawError,
      steps
    };

    return JSON.parse(JSON.stringify(payload, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ));
  };

  const saveRegistrationPaymentIssue = async (
    txHash: string | null,
    error: any,
    steps: string[] = []
  ) => {
    if (!user?.id || !plan) return null;

    // User-cancelled payments (code 4001) are not stuck — they are intentional rejections
    const isUserCancelled = error?.code === 4001;
    const isStuck = txHash !== null && !isUserCancelled;

    const errorMessage = buildUserFacingErrorMessage(error, txHash);
    const walletErrorCode = String(error?.code ?? error?.error?.code ?? '');
    const walletErrorRaw = buildRawWalletError(error);
    const paymentStatus = txHash ? 'pending' : 'failed';
    const gatewayResponse = safeSerializeGatewayResponse(error, txHash, steps);
    const isLivePaymentMode =
      settings?.paymentMode === true ||
      settings?.paymentMode === 1 ||
      settings?.paymentMode === '1' ||
      settings?.paymentMode === 'true';

    const deviceInfo = typeof navigator !== 'undefined'
      ? navigator.userAgent.substring(0, 200)
      : null;

    const baseRecord = {
      tp_user_id: user.id,
      tp_subscription_id: null,
      tp_amount: plan.tsp_price,
      tp_currency: 'USDT',
      tp_payment_method: 'blockchain',
      tp_payment_status: paymentStatus,
      tp_transaction_id: txHash,
      tp_wallet_address: walletState.address ? walletState.address.toLowerCase() : null,
      tp_to_address: adminReceivingWallet ? adminReceivingWallet.toLowerCase() : null,
      tp_expected_amount: plan.tsp_price,
      tp_network: isLivePaymentMode ? 'BSC Mainnet' : 'BSC Testnet',
      tp_chain_id: isLivePaymentMode ? 56 : 97,
      tp_error_message: errorMessage,
      tp_gateway_response: gatewayResponse,
      tp_is_stuck: isStuck,
      tp_stuck_at: isStuck ? new Date().toISOString() : null,
      tp_wallet_error_code: walletErrorCode || null,
      tp_wallet_error_raw: walletErrorRaw || null,
      tp_device_info: deviceInfo,
    };

    try {
      if (txHash) {
        const { data: existingPayment } = await supabase
          .from('tbl_payments')
          .select('tp_id, tp_user_id, tp_payment_status')
          .eq('tp_transaction_id', txHash)
          .maybeSingle();

        if (existingPayment?.tp_id && existingPayment.tp_user_id === user.id) {
          const alreadyCompleted = existingPayment.tp_payment_status === 'completed';
          const { error: updateError } = await supabase
            .from('tbl_payments')
            .update({
              tp_payment_status: alreadyCompleted ? 'completed' : 'pending',
              tp_error_message: errorMessage,
              tp_gateway_response: gatewayResponse,
              tp_is_stuck: alreadyCompleted ? false : isStuck,
              tp_stuck_at: alreadyCompleted ? null : (isStuck ? new Date().toISOString() : null),
              tp_wallet_error_code: walletErrorCode || null,
              tp_wallet_error_raw: walletErrorRaw || null,
              tp_device_info: deviceInfo,
            })
            .eq('tp_id', existingPayment.tp_id);

          if (updateError) throw updateError;
          return existingPayment.tp_id;
        }
      }

      const { data: insertedPayment, error: insertError } = await supabase
        .from('tbl_payments')
        .insert(baseRecord)
        .select('tp_id')
        .single();

      if (insertError) throw insertError;
      return insertedPayment?.tp_id || null;
    } catch (dbError) {
      console.error('Failed to save registration payment issue:', dbError);
      return null;
    }
  };

  const buildRawWalletError = (error: any): string => {
    if (!error) return '';
    const parts: string[] = [];
    if (error.code !== undefined) parts.push(`Code: ${error.code}`);
    if (error.message) parts.push(`Message: ${error.message}`);
    if (error.reason) parts.push(`Reason: ${error.reason}`);
    if (error.shortMessage && error.shortMessage !== error.message) parts.push(`Short: ${error.shortMessage}`);
    if (error.data) parts.push(`Data: ${JSON.stringify(error.data)}`);
    return parts.join(' | ').substring(0, 500);
  };

  const buildUserFacingErrorMessage = (error: any, txHash: string | null): string => {
    const code = error?.code;
    if (code === 4001) return 'Payment cancelled by user.';
    if (code === -32603) return 'Internal wallet error. Please try again.';
    if (code === 'WALLET_RESPONSE_TIMEOUT') return 'Wallet did not return a response in time. This is common on Android MetaMask.';
    const msg = error?.shortMessage || error?.reason || error?.message || 'Payment gateway did not confirm the payment.';
    return msg.substring(0, 300);
  };

  const getStuckPaymentMessage = (error: any, txHash: string | null) => {
    const reason = buildUserFacingErrorMessage(error, txHash);
    if (!txHash) return reason;
    return reason;
  };

  const extractTransactionHash = (value: any): string | null => {
    const candidates = [
      value?.hash,
      value?.transactionHash,
      value?.txHash,
      value?.transaction?.hash,
      value?.receipt?.hash,
      value?.receipt?.transactionHash,
      value?.gatewayResponse?.txHash,
      value?.gatewayResponse?.transaction_hash,
      value?.gatewayResponse?.transactionHash
    ];

    return candidates.find((candidate) =>
      typeof candidate === 'string' && /^0x[a-fA-F0-9]{64}$/.test(candidate)
    ) || null;
  };

  const loadRecoveryAttempt = useCallback((): PaymentRecoveryAttempt | null => {
    if (typeof window === 'undefined') return null;

    try {
      const raw =
        sessionStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY) ||
        localStorage.getItem(PAYMENT_RECOVERY_STORAGE_KEY);
      if (!raw) return null;
      const attempt = JSON.parse(raw) as PaymentRecoveryAttempt;
      const savedAt = new Date(attempt.startedAt || 0).getTime();
      const isRecent = Number.isFinite(savedAt) && savedAt > Date.now() - 45 * 60 * 1000;
      if (isRecent) return attempt;

      sessionStorage.removeItem(PAYMENT_RECOVERY_STORAGE_KEY);
      localStorage.removeItem(PAYMENT_RECOVERY_STORAGE_KEY);
      return null;
    } catch {
      return null;
    }
  }, []);

  const saveRecoveryAttempt = useCallback((attempt: PaymentRecoveryAttempt) => {
    if (typeof window === 'undefined') return;
    const payload = JSON.stringify(attempt);
    sessionStorage.setItem(PAYMENT_RECOVERY_STORAGE_KEY, payload);
    localStorage.setItem(PAYMENT_RECOVERY_STORAGE_KEY, payload);
    setManualRecoveryAvailable(true);
  }, []);

  const clearRecoveryAttempt = useCallback(() => {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem(PAYMENT_RECOVERY_STORAGE_KEY);
    localStorage.removeItem(PAYMENT_RECOVERY_STORAGE_KEY);
    setManualRecoveryAvailable(false);
  }, []);

  const buildRecoveryAttempt = useCallback(async (): Promise<PaymentRecoveryAttempt | null> => {
    if (!user?.id || !walletState.address || !plan || !adminReceivingWallet) return null;

    let startBlock: number | null = null;
    try {
      startBlock = await walletService.getCurrentBlockNumber();
    } catch (error) {
      console.warn('Unable to capture payment start block:', error);
    }

    return {
      userId: user.id,
      walletAddress: walletState.address,
      toAddress: adminReceivingWallet,
      amount: plan.tsp_price,
      chainId: walletState.chainId,
      usdtAddress: settings?.usdtAddress || null,
      startedAt: new Date().toISOString(),
      startBlock
    };
  }, [adminReceivingWallet, plan, settings?.usdtAddress, user?.id, walletService, walletState.address, walletState.chainId]);

  const findRecoverablePaymentHash = useCallback(async (attempt: PaymentRecoveryAttempt) => {
    if (!user?.id || attempt.userId !== user.id) return null;
    if (!adminReceivingWallet || attempt.toAddress.toLowerCase() !== adminReceivingWallet.toLowerCase()) return null;
    if (!plan || Number(attempt.amount) !== Number(plan.tsp_price)) return null;

    setStatusMessage('Checking blockchain for the submitted payment...');
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      if (token) {
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/recover-registration-payment`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            walletAddress: attempt.walletAddress,
            toAddress: attempt.toAddress,
            amount: attempt.amount,
            startBlock: attempt.startBlock
          })
        });

        const result = await response.json();
        if (response.ok && result?.txHash && /^0x[a-fA-F0-9]{64}$/.test(result.txHash)) {
          return result.txHash as string;
        }

        if (!response.ok || result?.success === false) {
          console.warn('Server payment recovery failed:', result?.error || response.status);
        }
      }
    } catch (error) {
      console.warn('Server payment recovery unavailable, trying browser recovery:', error);
    }

    return walletService.findRecentUSDTTransfer(
      attempt.walletAddress,
      attempt.toAddress,
      attempt.amount,
      attempt.startBlock
    );
  }, [adminReceivingWallet, plan, user?.id, walletService]);

  const recoverAndVerifyPayment = useCallback(async (attempt: PaymentRecoveryAttempt, reason: string) => {
    const recoveredHash = await findRecoverablePaymentHash(attempt);
    if (!recoveredHash) return false;

    setReverifyHash(recoveredHash);
    setTransaction({
      isProcessing: true,
      hash: recoveredHash,
      status: 'pending',
      error: null,
      distributionSteps: [`Recovered after ${reason}`, `Transaction found on-chain: ${recoveredHash}`]
    });
    setStatusMessage('Payment found on-chain. Verifying now...');
    scrollToPaymentStatus();

    try {
      const result = await pollVerification(recoveredHash);
      clearRecoveryAttempt();
      clearPendingTxHash();
      setTransaction({
        isProcessing: false,
        hash: recoveredHash,
        status: 'success',
        error: null,
        distributionSteps: [`Recovered after ${reason}`, `Transaction found on-chain: ${recoveredHash}`]
      });
      setStatusMessage('Payment confirmed!');
      notification.showSuccess('Payment Confirmed', 'Your registration payment was recovered and verified.');
      navigatingToSuccessRef.current = true;
      navigate('/registration-payment-success', {
        state: {
          txHash: recoveredHash,
          amount: result.amount || plan!.tsp_price,
          network: result.network
        }
      });
      void fetchUserData(user!.id);
      return true;
    } catch (error: any) {
      await saveRegistrationPaymentIssue(
        recoveredHash,
        error,
        [`Recovered after ${reason}`, `Transaction found on-chain: ${recoveredHash}`]
      );
      const userMessage = getStuckPaymentMessage(error, recoveredHash);
      setTransaction({
        isProcessing: false,
        hash: recoveredHash,
        status: 'error',
        error: userMessage,
        distributionSteps: [`Recovered after ${reason}`, `Transaction found on-chain: ${recoveredHash}`]
      });
      setStatusMessage(null);
      notification.showError('Payment Stuck', userMessage);
      return true;
    }
  }, [
    clearRecoveryAttempt,
    fetchUserData,
    findRecoverablePaymentHash,
    navigate,
    notification,
    plan,
    pollVerification,
    saveRegistrationPaymentIssue,
    user
  ]);

  const refreshWalletAndRecover = useCallback(async (attempt: PaymentRecoveryAttempt, reason: string) => {
    if (softWalletRefreshInFlightRef.current || navigatingToSuccessRef.current) return false;
    softWalletRefreshInFlightRef.current = true;

    try {
      setStatusMessage('Refreshing wallet session and checking payment...');
      const updatedWallet = await walletService.refreshInjectedWalletSession();
      setWalletState(updatedWallet);
      return await recoverAndVerifyPayment(attempt, reason);
    } catch (error) {
      console.warn('Automatic wallet session refresh failed:', error);
      return false;
    } finally {
      softWalletRefreshInFlightRef.current = false;
    }
  }, [recoverAndVerifyPayment, walletService]);

  const handleManualPaymentRecovery = useCallback(async () => {
    const attempt = loadRecoveryAttempt();
    if (!attempt) {
      notification.showError('Recovery Not Ready', 'Payment recovery details were not found. Please share your MetaMask transaction ID with admin if USDT was deducted.');
      return;
    }

    setManualRecoveryProcessing(true);
    setStatusMessage('Refreshing wallet connection and checking payment...');

    try {
      let recovered = await refreshWalletAndRecover(attempt, 'manual wallet refresh');

      if (!recovered) {
        const preferredWallet = availableWallets.find((wallet) =>
          wallet.name === walletState.walletName ||
          wallet.name === 'MetaMask' ||
          wallet.provider?.isMetaMask
        );

        if (preferredWallet?.provider) {
          setStatusMessage('Re-connect to Verify Payment...');
          const wallet = await walletService.connectWallet(preferredWallet.provider);
          setWalletState(wallet);
          recovered = await recoverAndVerifyPayment(attempt, 'manual wallet reconnect');
        }
      }

      if (!recovered) {
        setStatusMessage('Still checking for your payment. If USDT was deducted, wait a few seconds and tap the button again.');
      }
    } catch (error: any) {
      console.warn('Manual payment recovery failed:', error);
      notification.showError('Recovery Failed', error?.message || 'Unable to refresh wallet and check payment.');
    } finally {
      setManualRecoveryProcessing(false);
    }
  }, [
    availableWallets,
    loadRecoveryAttempt,
    notification,
    recoverAndVerifyPayment,
    refreshWalletAndRecover,
    walletService,
    walletState.walletName
  ]);

  useEffect(() => {
    if (transaction.status !== 'pending') {
      autoRecoveryAttemptsRef.current = 0;
      return;
    }

    if (!manualRecoveryReady || manualRecoveryProcessing || navigatingToSuccessRef.current) return;
    if (!loadRecoveryAttempt()) return;

    let cancelled = false;

    const runAutomaticRecovery = async () => {
      if (cancelled || navigatingToSuccessRef.current) return;
      if (manualRecoveryProcessing || autoRecoveryAttemptsRef.current >= AUTO_RECOVERY_MAX_ATTEMPTS) return;

      autoRecoveryAttemptsRef.current += 1;
      setStatusMessage('Still checking automatically. This can take longer on Android MetaMask mainnet...');
      await handleManualPaymentRecovery();
    };

    void runAutomaticRecovery();
    const intervalId = window.setInterval(() => {
      void runAutomaticRecovery();
    }, AUTO_RECOVERY_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    handleManualPaymentRecovery,
    loadRecoveryAttempt,
    manualRecoveryProcessing,
    manualRecoveryReady,
    transaction.status
  ]);

  useEffect(() => {
    if (!user?.id || !plan || loading || settingsLoading) return;
    if (user.hasActiveSubscription || user.registrationPaid) return;
    if (durableRecoveryAttemptedRef.current) return;

    const attempt = loadRecoveryAttempt();
    if (!attempt || attempt.userId !== user.id) return;

    durableRecoveryAttemptedRef.current = true;
    let cancelled = false;
    let intervalId: number | null = null;
    let attempts = 0;
    const maxAttempts = 18; // 18 x 5s = 90s after an Android reload/remount

    const tryDurableRecovery = async () => {
      if (cancelled || recoveryCheckInFlightRef.current || navigatingToSuccessRef.current) return;
      attempts += 1;
      recoveryCheckInFlightRef.current = true;
      const hasSubmittedTxHash = Boolean(loadPendingTxHash());

      try {
        if (hasSubmittedTxHash) {
          setTransaction(prev => ({
            ...prev,
            isProcessing: true,
            status: 'pending',
            error: null
          }));
          setStatusMessage('Checking blockchain for your submitted payment...');
        }
        let recovered = await recoverAndVerifyPayment(attempt, 'Android page reload');
        if (!recovered && attempts >= 2) {
          recovered = await refreshWalletAndRecover(attempt, 'automatic wallet refresh');
        }
        if (recovered && intervalId) {
          window.clearInterval(intervalId);
          intervalId = null;
          return;
        }
      } catch (error) {
        console.warn('Durable payment recovery failed:', error);
      } finally {
        recoveryCheckInFlightRef.current = false;
      }

      if (!hasSubmittedTxHash && attempts >= 2) {
        clearRecoveryAttempt();
        if (intervalId) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
      }

      if (!hasSubmittedTxHash) {
        setTransaction(prev => (
          prev.status === 'pending' && !prev.hash
            ? { ...prev, isProcessing: false, status: 'idle' }
            : { ...prev, isProcessing: false }
        ));
        setStatusMessage(null);
      }

      if (attempts >= maxAttempts && intervalId) {
        window.clearInterval(intervalId);
        intervalId = null;
        setTransaction(prev => ({
          ...prev,
          isProcessing: false
        }));
        setStatusMessage('We could not confirm the payment automatically yet. If USDT was deducted, share the transaction ID from MetaMask with admin for verification.');
      }
    };

    void tryDurableRecovery();
    intervalId = window.setInterval(() => {
      void tryDurableRecovery();
    }, 5000);

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [
    clearRecoveryAttempt,
    loadRecoveryAttempt,
    loading,
    plan,
    recoverAndVerifyPayment,
    refreshWalletAndRecover,
    settingsLoading,
    user?.id,
    user?.hasActiveSubscription,
    user?.registrationPaid
  ]);

  useEffect(() => {
    if (!user?.id || !plan || !walletState.isConnected || !walletState.address) {
      return;
    }

    const waitingForWalletResponse = transaction.isProcessing && !transaction.hash;
    const alreadyVerifyingHash = transaction.isProcessing && !!transaction.hash;
    if (alreadyVerifyingHash) {
      return;
    }

    let cancelled = false;

    const tryRecovery = async (reason: string) => {
      const attempt = loadRecoveryAttempt();
      if (!attempt || cancelled || recoveryCheckInFlightRef.current) return;

      recoveryCheckInFlightRef.current = true;
      try {
        let recovered = await recoverAndVerifyPayment(attempt, reason);
        if (!recovered && waitingForWalletResponse) {
          recovered = await refreshWalletAndRecover(attempt, 'automatic wallet refresh');
        }
        if (!recovered && !cancelled) {
          setStatusMessage(
            waitingForWalletResponse
              ? 'Returned from wallet, but the transaction response was not received yet. If USDT was deducted, keep this page open while we continue checking the blockchain.'
              : 'Previous payment not found yet. If USDT was deducted, wait a minute and tap Re-verify or contact admin with the transaction ID from MetaMask.'
          );
        }
      } catch (error) {
        console.warn('Payment recovery check failed:', error);
      } finally {
        recoveryCheckInFlightRef.current = false;
      }
    };

    if (!waitingForWalletResponse) {
      void tryRecovery('page restore');
    }

    const handleFocus = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      void tryRecovery('wallet return');
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);
    // Poll every 5s while waiting for wallet (Android may switch app context)
    const retryIntervalId = waitingForWalletResponse
      ? window.setInterval(() => {
          if (document.visibilityState && document.visibilityState !== 'visible') return;
          void tryRecovery('wallet response retry');
        }, 5000)
      : null;

    return () => {
      cancelled = true;
      if (retryIntervalId) window.clearInterval(retryIntervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
  }, [
    loadRecoveryAttempt,
    plan,
    refreshWalletAndRecover,
    transaction.hash,
    transaction.isProcessing,
    user?.id,
    walletState.address,
    walletState.isConnected
  ]);

  const handleReverify = async (hashOverride?: string) => {
    if (!plan) {
      notification.showError('Error', 'Payment configuration not loaded');
      return;
    }

    const targetHash = (hashOverride || reverifyHash || transaction.hash || '').trim();
    if (!targetHash) {
      notification.showError('Missing Transaction', 'Please enter the transaction hash');
      return;
    }

    if (!/^0x[a-fA-F0-9]{64}$/.test(targetHash)) {
      notification.showError('Invalid Hash', 'Please enter a valid transaction hash');
      return;
    }

    setReverifyProcessing(true);
    setTransaction({
      isProcessing: true,
      hash: targetHash,
      status: 'pending',
      error: null,
      distributionSteps: transaction.distributionSteps || []
    });
    setStatusMessage('Re-verifying on-chain payment...');

    try {
      const result = await pollVerification(targetHash);

      setTransaction({
        isProcessing: false,
        hash: targetHash,
        status: 'success',
        error: null,
        distributionSteps: transaction.distributionSteps || []
      });
      setStatusMessage('Payment confirmed!');
      clearRecoveryAttempt();
      clearPendingTxHash();

      notification.showSuccess('Payment Confirmed', 'Your registration payment was verified.');
      navigatingToSuccessRef.current = true;
      navigate('/registration-payment-success', {
        state: {
          txHash: targetHash,
          amount: result.amount || plan.tsp_price,
          network: result.network
        }
      });
      void fetchUserData(user!.id);
    } catch (error: any) {
      await saveRegistrationPaymentIssue(targetHash, error, transaction.distributionSteps || []);
      const userMessage = getStuckPaymentMessage(error, targetHash);
      setTransaction({
        isProcessing: false,
        hash: targetHash,
        status: 'error',
        error: userMessage,
        distributionSteps: transaction.distributionSteps || []
      });
      setStatusMessage(null);
      notification.showError('Verification Stuck', userMessage);
    } finally {
      setReverifyProcessing(false);
    }
  };

  const handlePayment = async () => {
    if (!plan || !settings) {
      notification.showError('Error', 'Payment configuration not loaded');
      return;
    }

    if (!adminReceivingWallet) {
      notification.showError('Error', 'Admin wallet not configured');
      return;
    }

    if (parentAccountError) {
      notification.showError('Parent A/C Issue', parentAccountError);
      return;
    }

    if (!walletState.isConnected || !walletState.address) {
      notification.showError('Wallet Required', 'Please connect your wallet');
      return;
    }

    const usdtBalance = parseFloat(walletState.usdtBalance || '0');
    if (usdtBalance < plan.tsp_price) {
      notification.showError('Insufficient Balance', `You need ${plan.tsp_price} USDT to continue`);
      return;
    }

    setTransaction({
      isProcessing: true,
      hash: null,
      status: 'pending',
      error: null,
      distributionSteps: []
    });
    setStatusMessage('Awaiting wallet confirmation...');

    let submittedHash: string | null = null;
    let submittedSteps: string[] = [];
    const recoveryAttempt = await buildRecoveryAttempt();
    if (recoveryAttempt) {
      saveRecoveryAttempt(recoveryAttempt);
    }

    try {
      await prepareAndroidMetaMaskToken();
      setStatusMessage('Awaiting wallet confirmation...');

      lateHashRef.current = null;

      const walletResponseTimeout = new Promise<never>((_resolve, reject) => {
        window.setTimeout(() => {
          const error = new Error('MetaMask did not return the transaction response after payment approval. This often happens on Android after returning from the wallet.');
          (error as any).code = 'WALLET_RESPONSE_TIMEOUT';
          reject(error);
        }, PAYMENT_REQUEST_TIMEOUT_MS);
      });

      const transferPromise = walletService.sendUSDTTransfer(adminReceivingWallet, plan.tsp_price);

      // Capture hash from transferPromise even if it resolves after the timeout race (Android MetaMask).
      // Also persist it immediately to sessionStorage/localStorage so that a full page reload
      // (which Android MetaMask sometimes causes when switching back to the DApp browser) does
      // not lose the hash — the auto-resume effect on mount will pick it up.
      transferPromise.then(({ hash }) => {
        lateHashRef.current = hash;
        savePendingTxHash(hash);
      }).catch(() => {
        // The raced promise handles the visible error path. This prevents an unhandled rejection
        // if the wallet request resolves after the timeout branch has already started recovery.
      });

      const { hash, steps } = await Promise.race([
        transferPromise,
        walletResponseTimeout
      ]);
      submittedHash = hash;
      submittedSteps = steps;
      // Persist immediately in the normal (non-timeout) path too
      savePendingTxHash(hash);

      setTransaction({
        isProcessing: true,
        hash,
        status: 'pending',
        error: null,
        distributionSteps: steps
      });
      setStatusMessage('Payment sent from wallet. Confirming blockchain payment and activating your account...');
      scrollToPaymentStatus();

      const result = await pollVerification(hash);

      clearPendingTxHash();
      clearRecoveryAttempt();
      setTransaction({
        isProcessing: false,
        hash,
        status: 'success',
        error: null,
        distributionSteps: steps
      });
      setStatusMessage('Payment confirmed!');

      notification.showSuccess('Payment Successful', 'Your registration payment was confirmed.');
      navigatingToSuccessRef.current = true;
      navigate('/registration-payment-success', {
        state: {
          txHash: hash,
          amount: result.amount || plan.tsp_price,
          network: result.network
        }
      });
      void fetchUserData(user!.id);
    } catch (error: any) {
      // On Android MetaMask, the transferPromise may resolve with the hash AFTER the
      // timeout race. Give it up to 30 seconds to arrive before falling back to
      // blockchain log search.
      if (error?.code === 'WALLET_RESPONSE_TIMEOUT' && !submittedHash) {
        setStatusMessage('Wallet response delayed. Waiting for transaction confirmation from MetaMask...');

        const lateHashWait = await new Promise<string | null>((resolve) => {
          const maxWait = 30000;
          const checkInterval = 1000;
          let elapsed = 0;
          const interval = window.setInterval(() => {
            elapsed += checkInterval;
            if (lateHashRef.current) {
              window.clearInterval(interval);
              resolve(lateHashRef.current);
            } else if (elapsed >= maxWait) {
              window.clearInterval(interval);
              resolve(null);
            }
          }, checkInterval);
        });

        if (lateHashWait) {
          submittedHash = lateHashWait;
          submittedSteps = ['Transaction hash recovered from delayed MetaMask response (Android)'];
          savePendingTxHash(lateHashWait);
          setTransaction({
            isProcessing: true,
            hash: lateHashWait,
            status: 'pending',
            error: null,
            distributionSteps: submittedSteps
          });
          setStatusMessage('Payment confirmed by wallet. Verifying on blockchain...');
          scrollToPaymentStatus();

          try {
            const result = await pollVerification(lateHashWait);
            clearPendingTxHash();
            clearRecoveryAttempt();
            setTransaction({
              isProcessing: false,
              hash: lateHashWait,
              status: 'success',
              error: null,
              distributionSteps: submittedSteps
            });
            setStatusMessage('Payment confirmed!');
            notification.showSuccess('Payment Successful', 'Your registration payment was confirmed.');
            navigatingToSuccessRef.current = true;
            navigate('/registration-payment-success', {
              state: {
                txHash: lateHashWait,
                amount: result.amount || plan.tsp_price,
                network: result.network
              }
            });
            void fetchUserData(user!.id);
            return;
          } catch (verifyError: any) {
            clearPendingTxHash();
            await saveRegistrationPaymentIssue(lateHashWait, verifyError, submittedSteps);
            const userMessage = getStuckPaymentMessage(verifyError, lateHashWait);
            setTransaction({
              isProcessing: false,
              hash: lateHashWait,
              status: 'error',
              error: userMessage,
              distributionSteps: submittedSteps
            });
            setStatusMessage(null);
            notification.showError('Payment Stuck', userMessage);
            return;
          }
        }
      }

      const txHash = submittedHash || extractTransactionHash(error) || transaction.hash || null;
      const steps = submittedSteps.length > 0 ? submittedSteps : transaction.distributionSteps;

      if (!txHash && error?.code !== 4001 && recoveryAttempt) {
        setStatusMessage('Checking blockchain for your payment...');
        const recovered = await recoverAndVerifyPayment(recoveryAttempt, 'wallet response issue');
        if (recovered) return;
      }

      if (error?.code === 4001) {
        clearPendingTxHash();
        clearRecoveryAttempt();
      }

      await saveRegistrationPaymentIssue(txHash, error, steps || []);
      const userMessage = getStuckPaymentMessage(error, txHash);

      setTransaction({
        isProcessing: false,
        hash: txHash,
        status: 'error',
        error: userMessage,
        distributionSteps: steps || []
      });
      setStatusMessage(null);
      notification.showError(txHash ? 'Payment Stuck' : 'Payment Failed', userMessage);
    }
  };

  const openTransaction = () => {
    if (!transaction.hash) return;
    const isMainnet =
      settings?.paymentMode === true ||
      settings?.paymentMode === 1 ||
      settings?.paymentMode === '1' ||
      settings?.paymentMode === 'true';
    const explorerUrl = isMainnet
      ? `https://bscscan.com/tx/${transaction.hash}`
      : `https://testnet.bscscan.com/tx/${transaction.hash}`;
    window.open(explorerUrl, '_blank', 'noopener,noreferrer');
  };

  const scrollToPaymentStatus = () => {
    if (typeof window === 'undefined') return;
    window.setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 100);
  };

  useEffect(() => {
    if (transaction.status !== 'pending') {
      setManualRecoveryReady(false);
      setManualRecoveryAvailable(false);
      return;
    }

    setManualRecoveryReady(false);
    setManualRecoveryAvailable(Boolean(loadRecoveryAttempt()));
    const timeoutId = window.setTimeout(() => {
      setManualRecoveryReady(true);
      setManualRecoveryAvailable(Boolean(loadRecoveryAttempt()));
    }, MANUAL_RECOVERY_ENABLE_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [loadRecoveryAttempt, transaction.hash, transaction.status]);

  const paymentStatusTitle = useMemo(() => {
    if (transaction.status === 'pending' && transaction.hash) return 'Payment sent. Activating your account...';
    if (transaction.status === 'pending') return 'Waiting for wallet confirmation...';
    if (transaction.status === 'success') return 'Payment confirmed';
    if (transaction.status === 'error') return transaction.hash ? 'Payment needs verification' : 'Payment failed';
    return null;
  }, [transaction.hash, transaction.status]);

  const paymentStatusDescription = useMemo(() => {
    if (transaction.status === 'pending' && transaction.hash) {
      return 'Your USDT transaction was submitted successfully. Please stay on this page while we confirm it on-chain and activate your account.';
    }
    if (transaction.status === 'pending') {
      return 'Please approve the payment in your wallet. If the wallet already deducted USDT, we will try to recover and verify the transaction automatically.';
    }
    if (transaction.status === 'success') {
      return 'Your registration payment has been confirmed.';
    }
    if (transaction.status === 'error' && transaction.hash) {
      return 'The payment was found but activation could not finish automatically. Share this transaction ID with admin for manual verification.';
    }
    if (transaction.status === 'error') {
      return 'The payment could not be completed. If USDT was deducted, provide the transaction ID from your wallet to admin.';
    }
    return null;
  }, [transaction.hash, transaction.status]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">No registration plan available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-blue-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Registration Payment</h1>
          <p className="text-gray-600">Connect your wallet and pay the registration fee to activate your account.</p>
        </div>

        {transaction.status !== 'idle' && paymentStatusTitle && (
          <div className={`rounded-2xl border p-4 sm:p-5 shadow-sm ${
            transaction.status === 'success'
              ? 'bg-green-50 border-green-200'
              : transaction.status === 'error'
                ? 'bg-red-50 border-red-200'
                : 'bg-blue-50 border-blue-200'
          }`}>
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${
                transaction.status === 'success'
                  ? 'bg-green-100 text-green-700'
                  : transaction.status === 'error'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-blue-100 text-blue-700'
              }`}>
                {transaction.status === 'pending' && <Loader className="h-5 w-5 animate-spin" />}
                {transaction.status === 'success' && <CheckCircle className="h-5 w-5" />}
                {transaction.status === 'error' && <XCircle className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base sm:text-lg font-semibold text-gray-900">{paymentStatusTitle}</h2>
                {paymentStatusDescription && (
                  <p className="mt-1 text-sm text-gray-700">{paymentStatusDescription}</p>
                )}
                {statusMessage && (
                  <p className="mt-2 text-sm font-medium text-gray-900">{statusMessage}</p>
                )}
                {transaction.hash && (
                  <div className="transaction-hash-container mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <code className="transaction-hash-code min-w-0 flex-1 overflow-x-auto scrollbar-hide whitespace-nowrap rounded-lg border border-gray-200 bg-white/80 px-3 py-2 font-mono text-xs text-gray-900">
                      {transaction.hash}
                    </code>
                    <button
                      onClick={openTransaction}
                      className="transaction-hash-button inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
                    >
                      <ExternalLink className="h-4 w-4" />
                      <span>View Tx</span>
                    </button>
                  </div>
                )}
                {transaction.status === 'pending' && (
                  <div className="mt-4">
                    <button
                      onClick={() => void handleManualPaymentRecovery()}
                      disabled={manualRecoveryProcessing || !manualRecoveryReady || !manualRecoveryAvailable}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                    >
                      {manualRecoveryProcessing && <Loader className="h-4 w-4 animate-spin" />}
                      <span>
                        {manualRecoveryProcessing
                          ? 'Checking Payment...'
                          : manualRecoveryReady && manualRecoveryAvailable
                            ? 'Verify Payment Now'
                            : 'Waiting for Wallet...'}
                      </span>
                    </button>
                    <p className="mt-2 text-xs text-gray-600">
                      {manualRecoveryReady && manualRecoveryAvailable
                        ? 'We are still checking automatically. You can tap this to check immediately.'
                        : 'Please approve the payment in your wallet. Recovery becomes available only after payment details are captured.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl shadow-md p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Registration Plan</h2>
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-medium text-gray-900">{plan.tsp_name}</h3>
                  <p className="text-gray-600 text-sm mt-1">{plan.tsp_description}</p>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-blue-600">${plan.tsp_price}</div>
                  <div className="text-sm text-gray-500">USDT (BEP-20)</div>
                </div>
              </div>

              {typeof plan.tsp_features === 'object' && Object.keys(plan.tsp_features).length > 0 && (
                <div className="mt-6">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Features Included:</h4>
                  <ul className="space-y-2">
                    {Object.keys(plan.tsp_features).map((key, idx) => (
                      <li key={idx} className="flex items-center text-gray-600">
                        <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
                        <span>{key.replace(/_/g, ' ')}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-md p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Connect Wallet</h2>

              {parentAccountError && (
                <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
                  {parentAccountError}
                </div>
              )}

              {!walletState.isConnected ? (
                <div className="space-y-4">
                  {filteredWallets.length === 0 ? (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
                      No compatible wallet detected. Please install MetaMask, Trust Wallet, or SafePal.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {filteredWallets.map((wallet) => (
                        <button
                          key={wallet.name}
                          onClick={() => handleWalletConnect(wallet.provider)}
                          disabled={isConnecting || !!parentAccountError}
                          className="p-4 border-2 rounded-lg transition-all border-gray-200 hover:border-blue-400 bg-white"
                        >
                          <div className="text-2xl mb-2">{wallet.icon}</div>
                          <p className="text-sm font-medium text-gray-900">{wallet.name}</p>
                          <p className="text-xs text-gray-500 mt-1">{isConnecting ? 'Connecting...' : 'Connect'}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <WalletInfoCard
                  wallet={walletState}
                  onDisconnect={handleWalletDisconnect}
                  onRefresh={async () => {
                    setRefreshingBalances(true);
                    try {
                      const updated = await walletService.syncCurrentWalletState();
                      setWalletState(updated);
                    } finally {
                      setRefreshingBalances(false);
                    }
                  }}
                  refreshing={refreshingBalances}
                />
              )}
            </div>

            {transaction.status !== 'idle' && (
              <div className={`rounded-xl shadow-md p-6 border-2 ${
                transaction.status === 'success'
                  ? 'bg-green-50 border-green-200'
                  : transaction.status === 'error'
                    ? transaction.hash ? 'bg-amber-50 border-amber-300' : 'bg-red-50 border-red-200'
                    : 'bg-blue-50 border-blue-200'
              }`}>
                {/* Status header */}
                <div className="flex items-center gap-3 mb-4">
                  {transaction.status === 'pending' && <Loader className="h-6 w-6 text-blue-600 animate-spin flex-shrink-0" />}
                  {transaction.status === 'success' && <CheckCircle className="h-6 w-6 text-green-600 flex-shrink-0" />}
                  {transaction.status === 'error' && transaction.hash && <XCircle className="h-6 w-6 text-amber-600 flex-shrink-0" />}
                  {transaction.status === 'error' && !transaction.hash && <XCircle className="h-6 w-6 text-red-500 flex-shrink-0" />}
                  <h2 className={`text-lg font-bold ${
                    transaction.status === 'success' ? 'text-green-800'
                    : transaction.status === 'error' && transaction.hash ? 'text-amber-800'
                    : transaction.status === 'error' ? 'text-red-800'
                    : 'text-blue-800'
                  }`}>
                    {transaction.status === 'pending' && 'Processing Payment...'}
                    {transaction.status === 'success' && 'Payment Confirmed'}
                    {transaction.status === 'error' && transaction.hash && 'Payment Stuck — Action Required'}
                    {transaction.status === 'error' && !transaction.hash && 'Payment Failed'}
                  </h2>
                </div>

                {statusMessage && (
                  <p className="text-sm text-gray-700 mb-4 leading-relaxed">{statusMessage}</p>
                )}

                {/* Stuck payment: full information panel */}
                {transaction.status === 'error' && transaction.hash && (
                  <div className="space-y-4">
                    {/* Error reason */}
                    {transaction.error && (
                      <div className="rounded-lg border border-amber-200 bg-white p-4">
                        <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Wallet Error</p>
                        <p className="text-sm text-gray-800 leading-relaxed">{transaction.error}</p>
                      </div>
                    )}

                    {/* Transaction ID — the most important thing to save */}
                    <div className="rounded-lg border border-gray-200 bg-white p-4">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Transaction ID (Save This)</p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => void copyToClipboard(transaction.hash!)}
                            className="inline-flex items-center gap-1.5 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                            title="Copy transaction hash"
                          >
                            <Copy className="h-3 w-3" />
                            Copy
                          </button>
                          <button
                            onClick={openTransaction}
                            className="inline-flex items-center gap-1.5 rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                          >
                            <ExternalLink className="h-3 w-3" />
                            View on Chain
                          </button>
                        </div>
                      </div>
                      <code className="transaction-hash-code block w-full overflow-x-auto scrollbar-hide whitespace-nowrap rounded bg-gray-50 px-3 py-2 font-mono text-xs text-gray-900 border border-gray-100">
                        {transaction.hash}
                      </code>
                    </div>

                    {/* What to do next */}
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                      <p className="text-sm font-semibold text-amber-900 mb-2">What to do:</p>
                      <ol className="text-sm text-amber-800 space-y-1.5 list-decimal list-inside">
                        <li>First, try <strong>Re-verify</strong> below — our system will check the blockchain again.</li>
                        <li>If that fails, <strong>copy the Transaction ID above</strong> and contact admin.</li>
                        <li>Admin will verify the transaction manually and activate your account.</li>
                      </ol>
                    </div>

                    {/* Re-verify controls */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-gray-600">Re-verify this payment on the blockchain:</p>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={reverifyHash}
                          onChange={(event) => setReverifyHash(event.target.value)}
                          placeholder={transaction.hash}
                          className="flex-1 rounded border border-gray-200 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-200"
                        />
                        <button
                          onClick={() => handleReverify()}
                          disabled={reverifyProcessing || transaction.isProcessing || (!reverifyHash && !transaction.hash)}
                          className="flex-shrink-0 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {reverifyProcessing ? 'Checking...' : 'Re-verify'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Failed payment (no hash) */}
                {transaction.status === 'error' && !transaction.hash && (
                  <div className="space-y-3">
                    {transaction.error && (
                      <div className="rounded-lg border border-red-200 bg-white p-4">
                        <p className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">Reason</p>
                        <p className="text-sm text-gray-800">{transaction.error}</p>
                      </div>
                    )}
                    <p className="text-sm text-gray-600">
                      If USDT was deducted from your wallet, enter your transaction hash below and click Re-verify, or contact admin.
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={reverifyHash}
                        onChange={(event) => setReverifyHash(event.target.value)}
                        placeholder="Paste transaction hash: 0x..."
                        className="flex-1 rounded border border-gray-200 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                      <button
                        onClick={() => handleReverify()}
                        disabled={reverifyProcessing || transaction.isProcessing || !reverifyHash}
                        className="flex-shrink-0 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {reverifyProcessing ? 'Checking...' : 'Re-verify'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Pending: show hash if available */}
                {transaction.status === 'pending' && transaction.hash && (
                  <div className="transaction-hash-container flex items-center gap-2">
                    <code className="transaction-hash-code min-w-0 flex-1 overflow-x-auto scrollbar-hide whitespace-nowrap rounded border border-blue-200 bg-white px-3 py-2 font-mono text-xs text-gray-900">
                      {transaction.hash}
                    </code>
                    <button
                      onClick={openTransaction}
                      className="transaction-hash-button flex-shrink-0 rounded border border-blue-200 bg-white p-2 text-blue-700 hover:bg-blue-50"
                      title="View on explorer"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-md p-6 sticky top-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Payment Summary</h3>

              <div className="space-y-3 mb-6 text-sm text-gray-600">
                <div className="flex justify-between">
                  <span>Registration Fee</span>
                  <span className="font-medium">${plan.tsp_price}</span>
                </div>
                <div className="flex justify-between">
                  <span>Network</span>
                  <span className="font-medium">
                    {settings?.paymentMode === true ||
                    settings?.paymentMode === 1 ||
                    settings?.paymentMode === '1' ||
                    settings?.paymentMode === 'true'
                      ? 'BSC Mainnet'
                      : 'BSC Testnet'}
                  </span>
                </div>
                {!!adminReceivingWallet && (
                  <div className="flex justify-between items-center gap-3">
                    <span>Receiving Wallet</span>
                    <div className="flex items-center gap-2">
                      <code className="px-2 py-1 bg-gray-50 text-gray-900 rounded border border-gray-200 font-mono text-xs">
                        {formatAddress(adminReceivingWallet)}
                      </code>
                      <button
                        onClick={() => void copyToClipboard(adminReceivingWallet)}
                        className="p-1 bg-gray-100 hover:bg-gray-200 rounded border border-gray-200"
                        title="Copy receiving wallet"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}
                {!!String(settings?.usdtAddress || '').trim() && (
                  <div className="flex justify-between items-center gap-3">
                    <span>USDT Contract</span>
                    <div className="flex items-center gap-2">
                      <code className="px-2 py-1 bg-gray-50 text-gray-900 rounded border border-gray-200 font-mono text-xs">
                        {formatAddress(String(settings?.usdtAddress || '').trim())}
                      </code>
                      <button
                        onClick={() => void copyToClipboard(String(settings?.usdtAddress || '').trim())}
                        className="p-1 bg-gray-100 hover:bg-gray-200 rounded border border-gray-200"
                        title="Copy USDT contract"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => void handleAddUsdtToken()}
                        disabled={!walletState.isConnected}
                        className="p-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded border border-blue-200 disabled:opacity-50"
                        title={walletState.isConnected ? 'Add USDT token to wallet' : 'Connect wallet to add token'}
                      >
                        <PlusCircle className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}
                <div className="flex justify-between font-bold text-gray-900 border-t pt-3">
                  <span>Total</span>
                  <span className="text-blue-600">{plan.tsp_price} USDT</span>
                </div>
              </div>

              <div className="space-y-3 text-sm text-gray-600 mb-6">
                <div className="flex items-start">
                  <Shield className="h-5 w-5 text-green-500 mr-2 mt-0.5" />
                  <span>Payment sent directly to the admin wallet</span>
                </div>
                <div className="flex items-start">
                  <CreditCard className="h-5 w-5 text-green-500 mr-2 mt-0.5" />
                  <span>USDT (BEP-20) only</span>
                </div>
              </div>

              <button
                onClick={handlePayment}
                disabled={!!payNowDisabledReason}
                className={`w-full py-3 rounded-lg font-medium flex items-center justify-center space-x-2 ${
                  !payNowDisabledReason
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                {transaction.isProcessing ? (
                  <>
                    <Loader className="h-5 w-5 animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <Wallet className="h-5 w-5" />
                    <span>Pay Now</span>
                  </>
                )}
              </button>

              {payNowDisabledReason && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
                  {payNowDisabledReason}
                </p>
              )}

              <p className="text-xs text-gray-500 text-center mt-4">
                By proceeding, you agree to our terms and conditions
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RegistrationPayment;
