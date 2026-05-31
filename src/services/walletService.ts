import { ethers } from 'ethers';
import { WalletInfo, WalletState } from '../types/wallet';

const WALLET_STATE_STORAGE_KEY = 'registration_payment_wallet_state';

// BSC Network Configurations
const BSC_TESTNET_CONFIG = {
  chainId: '0x61', // 97 in decimal
  chainName: 'BSC Testnet',
  nativeCurrency: {
    name: 'BNB',
    symbol: 'BNB',
    decimals: 18,
  },
  rpcUrls: [
    'https://bsc-testnet-dataseed.bnbchain.org',
    'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
    'https://data-seed-prebsc-2-s1.bnbchain.org:8545',
    'https://bsc-testnet-rpc.publicnode.com'
  ],
  blockExplorerUrls: ['https://testnet.bscscan.com/'],
};

const BSC_MAINNET_CONFIG = {
  chainId: '0x38', // 56 in decimal
  chainName: 'BSC Mainnet',
  nativeCurrency: {
    name: 'BNB',
    symbol: 'BNB',
    decimals: 18,
  },
  rpcUrls: ['https://bsc-dataseed.bnbchain.org', 'https://bsc-dataseed-public.bnbchain.org'],
  blockExplorerUrls: ['https://bscscan.com/'],
};

// Contract ABIs
const USDT_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)'
];

const DISTRIBUTION_ABI = [
  'function distributePayment(address[] recipients, uint256[] amounts, uint256 totalAmount) external',
  'function validateDistribution(address[] recipients, uint256[] amounts, uint256 totalAmount) view returns (bool)',
  'event PaymentDistributed(address indexed sender, uint256 totalAmount, uint256 recipientCount)'
];

const ERC20_TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
const READONLY_RPC_TIMEOUT_MS = 8000;
type SupportedWalletName = 'SafePal' | 'Trust Wallet' | 'MetaMask' | 'TokenPocket' | 'Bitget Wallet';

// Admin Settings Interface
interface AdminSettings {
  paymentMode: string | number | boolean;
  usdtAddress: string;
  subscriptionContractAddress: string;
  subscriptionWalletAddress: string;
}

type Eip6963ProviderDetail = {
  info?: {
    name?: string;
    rdns?: string;
    icon?: string;
    uuid?: string;
  };
  provider?: any;
};

const getProviderFlag = (provider: any, flag: string): boolean => {
  try {
    return Boolean(provider?.[flag]);
  } catch {
    return false;
  }
};

const hasProviderRequest = (provider: any): boolean => {
  try {
    return typeof provider?.request === 'function';
  } catch {
    return false;
  }
};

const hasLegacyProviderRequest = (provider: any): boolean => {
  try {
    return typeof provider?.sendAsync === 'function' || typeof provider?.send === 'function';
  } catch {
    return false;
  }
};

const normalizeProviderRequest = (provider: any): any => {
  if (!provider || hasProviderRequest(provider)) return provider;
  if (!hasLegacyProviderRequest(provider)) return provider;

  return {
    ...provider,
    request: ({ method, params }: { method: string; params?: any[] }) =>
      new Promise((resolve, reject) => {
        const payload = {
          id: Date.now(),
          jsonrpc: '2.0',
          method,
          params: params || [],
        };
        const callback = (error: any, response: any) => {
          if (error) {
            reject(error);
            return;
          }
          if (response?.error) {
            reject(response.error);
            return;
          }
          resolve(response?.result ?? response);
        };

        if (typeof provider.sendAsync === 'function') {
          provider.sendAsync(payload, callback);
          return;
        }

        try {
          const result = provider.send(payload, callback);
          if (result && typeof result.then === 'function') {
            result.then(resolve).catch(reject);
          } else if (result !== undefined) {
            resolve(result?.result ?? result);
          }
        } catch (error) {
          reject(error);
        }
      }),
  };
};

const normalizeUsableProvider = (provider: any): any | null => {
  const normalizedProvider = normalizeProviderRequest(provider);
  return hasProviderRequest(normalizedProvider) ? normalizedProvider : null;
};

const getEthereumProviderList = (ethereum: any): any[] => {
  try {
    return Array.isArray(ethereum?.providers) ? ethereum.providers : [];
  } catch {
    return [];
  }
};

// Wallet Service Class
export class WalletService {
  private static instance: WalletService;
  private provider: ethers.BrowserProvider | null = null;
  private signer: ethers.JsonRpcSigner | null = null;
  private externalProvider: any | null = null;
  private isConnecting: boolean = false;
  private adminSettings: AdminSettings | null = null;
  private eip6963Providers: Eip6963ProviderDetail[] = [];
  // FIX: Store the current wallet state internally to restore on re-render
  private currentWalletState: WalletState = {
    isConnected: false,
    address: null,
    chainId: null,
    balance: '0',
    usdtBalance: '0',
    walletName: null,
    warning: null,
  };

  // Singleton pattern
  static getInstance(): WalletService {
    if (!WalletService.instance) {
      WalletService.instance = new WalletService();
    }
    return WalletService.instance;
  }

  // Private constructor to enforce singleton
  private constructor() {
    console.log('WalletService instance created');
    if (typeof window !== 'undefined') {
      try {
        const persistedState = sessionStorage.getItem(WALLET_STATE_STORAGE_KEY);
        if (persistedState) {
          this.currentWalletState = JSON.parse(persistedState) as WalletState;
        }
      } catch (error) {
        console.warn('Failed to restore persisted wallet state:', error);
      }

      window.addEventListener('eip6963:announceProvider', (event: Event) => {
        const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
        if (!detail?.provider) return;

        const providerId = String(detail.info?.uuid || detail.info?.rdns || detail.info?.name || '');
        const alreadyKnown = this.eip6963Providers.some((known) => (
          known.provider === detail.provider ||
          (!!providerId && providerId === String(known.info?.uuid || known.info?.rdns || known.info?.name || ''))
        ));

        if (!alreadyKnown) {
          this.eip6963Providers.push(detail);
        }
      });
    }
  }

  private persistCurrentWalletState(): void {
    if (typeof window === 'undefined') return;

    try {
      if (this.currentWalletState.isConnected) {
        sessionStorage.setItem(WALLET_STATE_STORAGE_KEY, JSON.stringify(this.currentWalletState));
      } else {
        sessionStorage.removeItem(WALLET_STATE_STORAGE_KEY);
      }
    } catch (error) {
      console.warn('Failed to persist wallet state:', error);
    }
  }

  // Method to set admin settings from context
  setAdminSettings(settings: AdminSettings): void {
    this.adminSettings = settings;
    const isLive = this.isLivePaymentMode(settings.paymentMode);
    console.log('Admin settings configured:', {
      paymentMode: settings.paymentMode,
      network: isLive ? 'BSC Mainnet' : 'BSC Testnet',
      usdtAddress: settings.usdtAddress?.substring(0, 10) + '...',
      subscriptionContract: settings.subscriptionContractAddress?.substring(0, 10) + '...',
      subscriptionWallet: settings.subscriptionWalletAddress?.substring(0, 10) + '...'
    });
  }

  // Get admin settings (for debugging)
  getAdminSettings(): AdminSettings | null {
    return this.adminSettings;
  }

  // FIX: New method to retrieve the current wallet state
  getCurrentWalletState(): WalletState {
    return this.currentWalletState;
  }

  // Get network config based on payment mode
  private getNetworkConfig() {
    const isLive = this.isLivePaymentMode(this.adminSettings?.paymentMode);
    return isLive ? BSC_MAINNET_CONFIG : BSC_TESTNET_CONFIG;
  }

  private isLivePaymentMode(paymentMode: AdminSettings['paymentMode'] | undefined | null): boolean {
    const normalized = String(paymentMode ?? '').trim().toLowerCase();
    return paymentMode === true || paymentMode === 1 || normalized === '1' || normalized === 'true' || normalized === 'live' || normalized === 'mainnet';
  }

  private getExpectedChainId(): number {
    const chainIdHex = this.getNetworkConfig().chainId;
    return Number.parseInt(chainIdHex, 16);
  }

  private async assertCorrectNetwork(): Promise<void> {
    if (!this.provider) {
      throw new Error('Provider not initialized');
    }

    const network = await this.provider.getNetwork();
    const currentChainId = Number(network.chainId);
    const expectedChainId = this.getExpectedChainId();

    if (currentChainId !== expectedChainId) {
      const expectedName = this.getNetworkConfig().chainName;
      throw new Error(`Wrong network selected in wallet. Expected ${expectedName} (chainId ${expectedChainId}), but wallet is on chainId ${currentChainId}. Please switch network and try again.`);
    }
  }

  private buildRpcUnavailableMessage(): string {
    const networkConfig = this.getNetworkConfig();
    return `${networkConfig.chainName} RPC is not responding in your wallet. Please update the network RPC URL in MetaMask and reconnect.`;
  }

  private getReadonlyProvider(): ethers.JsonRpcProvider {
    const networkConfig = this.getNetworkConfig();
    return this.createReadonlyProvider(networkConfig.rpcUrls[0]);
  }

  private getReadonlyProviders(): ethers.JsonRpcProvider[] {
    const networkConfig = this.getNetworkConfig();
    return networkConfig.rpcUrls.map((rpcUrl) => this.createReadonlyProvider(rpcUrl));
  }

  private createReadonlyProvider(rpcUrl: string): ethers.JsonRpcProvider {
    const request = new ethers.FetchRequest(rpcUrl);
    request.timeout = READONLY_RPC_TIMEOUT_MS;
    return new ethers.JsonRpcProvider(request);
  }

  private destroyReadonlyProvider(provider: ethers.JsonRpcProvider | ethers.BrowserProvider): void {
    if (provider instanceof ethers.JsonRpcProvider) {
      provider.destroy();
    }
  }

  private isRpcFetchError(error: any): boolean {
    const message = String(error?.message || error?.error?.message || '').toLowerCase();
    const nestedMessage = String(error?.data?.cause?.message || '').toLowerCase();
    return (
      message.includes('failed to fetch') ||
      nestedMessage.includes('failed to fetch') ||
      (error?.code === -32603 && (message.includes('fetch') || nestedMessage.includes('fetch')))
    );
  }

  private getEthereumProviders(): any[] {
    if (typeof window === 'undefined') return [];
    const providers: any[] = [];
    const ethereum = (window as any).ethereum;
    const ethereumProviders = getEthereumProviderList(ethereum);

    if (ethereumProviders.length > 0) {
      providers.push(...ethereumProviders);
    } else if (ethereum) {
      providers.push(ethereum);
    }

    for (const provider of [
      this.getTokenPocketProvider(),
      this.getBitgetProvider()
    ]) {
      if (provider && !providers.includes(provider)) {
        providers.push(provider);
      }
    }

    return providers;
  }

  private getTokenPocketProvider(): any | null {
    if (typeof window === 'undefined') return null;
    return (window as any).tokenpocket?.ethereum || null;
  }

  private getBitgetProvider(): any | null {
    if (typeof window === 'undefined') return null;
    const bitkeep = (window as any).bitkeep;
    const bitget = (window as any).bitget;
    const BitKeep = (window as any).BitKeep;

    return (
      normalizeUsableProvider(bitkeep?.ethereum) ||
      normalizeUsableProvider(bitkeep?.ethereumProvider) ||
      normalizeUsableProvider(bitkeep) ||
      normalizeUsableProvider(bitget?.ethereum) ||
      normalizeUsableProvider(bitget?.ethereumProvider) ||
      normalizeUsableProvider(bitget) ||
      normalizeUsableProvider(BitKeep?.ethereum) ||
      normalizeUsableProvider(BitKeep?.ethereumProvider) ||
      normalizeUsableProvider(BitKeep) ||
      normalizeUsableProvider((window as any).bitgetWallet) ||
      null
    );
  }

  private getDetectedBitgetProvider(): any | null {
    const directProvider = this.getBitgetProvider();
    if (directProvider) return directProvider;

    for (const detail of this.eip6963Providers) {
      const provider = detail.provider;
      const name = String(detail.info?.name || '').toLowerCase();
      const rdns = String(detail.info?.rdns || '').toLowerCase();

      if (
        provider &&
        (
          this.isBitgetProvider(provider) ||
          name.includes('bitget') ||
          name.includes('bitkeep') ||
          rdns.includes('bitget') ||
          rdns.includes('bitkeep')
        )
      ) {
        return normalizeUsableProvider(provider);
      }
    }

    return null;
  }

  private getSingleInjectedEthereumProvider(): any | null {
    if (typeof window === 'undefined') return null;
    const ethereum = (window as any).ethereum;
    if (!ethereum || (!hasProviderRequest(ethereum) && !hasLegacyProviderRequest(ethereum))) return null;
    if (getEthereumProviderList(ethereum).length > 0) return null;

    // Some Bitget extension builds expose only window.ethereum and no BitKeep flags.
    // Use it only as a last-resort click-time fallback for the Bitget button.
    if (
      getProviderFlag(ethereum, 'isMetaMask') ||
      getProviderFlag(ethereum, 'isSafePal') ||
      getProviderFlag(ethereum, 'isTrust') ||
      getProviderFlag(ethereum, 'isTrustWallet') ||
      this.isTokenPocketProvider(ethereum)
    ) {
      return null;
    }

    return normalizeProviderRequest(ethereum);
  }

  private providerHasWalletMarker(provider: any, markers: string[]): boolean {
    if (!provider) return false;

    try {
      const keys = Object.keys(provider);
      return keys.some((key) => {
        const normalizedKey = key.toLowerCase();
        return (
          markers.some((marker) => normalizedKey.includes(marker)) &&
          !hasProviderRequest(provider[key])
        );
      });
    } catch {
      return false;
    }
  }

  private isTokenPocketProvider(provider: any): boolean {
    return Boolean(getProviderFlag(provider, 'isTokenPocket') || provider === this.getTokenPocketProvider() || this.providerHasWalletMarker(provider, ['tokenpocket', 'tpwallet']));
  }

  private isBitgetProvider(provider: any): boolean {
    return Boolean(
      getProviderFlag(provider, 'isBitKeep') ||
      getProviderFlag(provider, 'isBitkeep') ||
      getProviderFlag(provider, 'isBitKeepChrome') ||
      getProviderFlag(provider, 'isBitget') ||
      getProviderFlag(provider, 'isBitgetWallet') ||
      provider === this.getBitgetProvider() ||
      this.providerHasWalletMarker(provider, ['bitkeep', 'bitget'])
    );
  }

  private requestEip6963Providers(shouldRequest = true): Eip6963ProviderDetail[] {
    if (typeof window === 'undefined') return [];

    if (shouldRequest) {
      try {
        window.dispatchEvent(new Event('eip6963:requestProvider'));
      } catch (error) {
        console.warn('Failed to request EIP-6963 wallet providers:', error);
      }
    }

    return this.eip6963Providers;
  }

  private isMobileBrowser(): boolean {
    if (typeof navigator === 'undefined') return false;
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  }

  private getInAppWalletName(): SupportedWalletName | null {
    if (typeof navigator === 'undefined') return null;
    const ua = navigator.userAgent || '';
    if (/SafePal/i.test(ua)) return 'SafePal';
    if (/Trust|TrustWallet/i.test(ua)) return 'Trust Wallet';
    if (/MetaMask/i.test(ua)) return 'MetaMask';
    if (/TokenPocket|TPWallet/i.test(ua)) return 'TokenPocket';
    if (/Bitget|BitKeep/i.test(ua)) return 'Bitget Wallet';
    return null;
  }

  private findProviderByWalletName(walletName: SupportedWalletName): any | null {
    const providers = [
      ...this.requestEip6963Providers().map((detail) => detail.provider).filter(Boolean),
      ...this.getEthereumProviders()
    ];
    if (walletName === 'SafePal') {
      return providers.find((provider) => getProviderFlag(provider, 'isSafePal')) || null;
    }
    if (walletName === 'Trust Wallet') {
      return providers.find((provider) => getProviderFlag(provider, 'isTrust') || getProviderFlag(provider, 'isTrustWallet')) || null;
    }
    if (walletName === 'TokenPocket') {
      return providers.find((provider) => this.isTokenPocketProvider(provider)) || null;
    }
    if (walletName === 'Bitget Wallet') {
      return providers.find((provider) => this.isBitgetProvider(provider)) || this.getDetectedBitgetProvider();
    }
    return providers.find((provider) =>
      getProviderFlag(provider, 'isMetaMask') &&
      !getProviderFlag(provider, 'isSafePal') &&
      !getProviderFlag(provider, 'isTrust') &&
      !getProviderFlag(provider, 'isTrustWallet') &&
      !this.isTokenPocketProvider(provider) &&
      !getProviderFlag(provider, 'isBitKeep') &&
      !getProviderFlag(provider, 'isBitget') &&
      !this.isBitgetProvider(provider)
    ) || null;
  }

  private getWalletIcon(walletName: SupportedWalletName): string {
    if (walletName === 'MetaMask') return '🦊';
    if (walletName === 'Trust Wallet') return '🔷';
    if (walletName === 'SafePal') return '🛡️';
    if (walletName === 'TokenPocket') return 'TP';
    return 'BG';
  }

  private addWalletIfAvailable(
    wallets: WalletInfo[],
    wallet: WalletInfo,
    seenNames: Set<string>,
    seenProviders: Set<any>
  ): void {
    if (!wallet.provider || seenNames.has(wallet.name) || seenProviders.has(wallet.provider)) return;
    wallets.push(wallet);
    seenNames.add(wallet.name);
    seenProviders.add(wallet.provider);
  }

  private getEip6963WalletInfo(detail: Eip6963ProviderDetail): WalletInfo | null {
    const provider = detail.provider;
    if (!provider) return null;

    const name = String(detail.info?.name || '').toLowerCase();
    const rdns = String(detail.info?.rdns || '').toLowerCase();

    if (getProviderFlag(provider, 'isSafePal') || name.includes('safepal') || rdns.includes('safepal')) {
      return { name: 'SafePal', icon: '🛡️', isInstalled: true, provider };
    }

    if (getProviderFlag(provider, 'isTrust') || getProviderFlag(provider, 'isTrustWallet') || name.includes('trust') || rdns.includes('trust')) {
      return { name: 'Trust Wallet', icon: '🔷', isInstalled: true, provider };
    }

    if (this.isTokenPocketProvider(provider) || name.includes('tokenpocket') || rdns.includes('tokenpocket') || rdns.includes('tpwallet')) {
      return { name: 'TokenPocket', icon: 'TP', isInstalled: true, provider };
    }

    if (this.isBitgetProvider(provider) || name.includes('bitget') || name.includes('bitkeep') || rdns.includes('bitget') || rdns.includes('bitkeep')) {
      return { name: 'Bitget Wallet', icon: 'BG', isInstalled: true, provider };
    }

    if (getProviderFlag(provider, 'isMetaMask') || name.includes('metamask') || rdns.includes('metamask')) {
      return { name: 'MetaMask', icon: '🦊', isInstalled: true, provider };
    }

    return null;
  }

  // Get USDT contract address from settings
  private getUSDTContractAddress(): string {
    if (!this.adminSettings?.usdtAddress) {
      throw new Error('USDT contract address is not configured');
    }
    return this.adminSettings.usdtAddress;
  }

  // Get distribution contract address from settings
  private getDistributionContractAddress(): string {
    if (!this.adminSettings?.subscriptionContractAddress) {
      console.warn('Subscription contract address not configured, using fallback');
      return '0x337efE1be3dA9Bb3Aa6D6d90f8A0CD9e1c4C9641'; // Fallback contract
    }
    return this.adminSettings.subscriptionContractAddress;
  }

  // Get subscription wallet address from settings
  private getSubscriptionWalletAddress(): string {
    if (!this.adminSettings?.subscriptionWalletAddress) {
      console.warn('Subscription wallet address not configured, using fallback');
      return '0xF52F981daFb26Dc2ce86e48FBF6FBc2e35CD9444'; // Fallback wallet
    }
    return this.adminSettings.subscriptionWalletAddress;
  }

  // Detect available wallets
  detectWallets(options: { requestEip6963?: boolean } = {}): WalletInfo[] {
    const wallets: WalletInfo[] = [];
    const shouldRequestEip6963 = options.requestEip6963 !== false;

    if (typeof window === 'undefined') {
      console.warn('Window is undefined, cannot detect wallets');
      return wallets;
    }

    const inAppWalletName = this.getInAppWalletName();
    if (inAppWalletName && this.isMobileBrowser()) {
      const provider = this.findProviderByWalletName(inAppWalletName) || (window as any).ethereum;
      if (inAppWalletName === 'Bitget Wallet' && !normalizeUsableProvider(provider)) {
        console.log('Detected Bitget mobile browser, but no usable Bitget provider is available.');
        return wallets;
      }
      wallets.push({
        name: inAppWalletName,
        icon: this.getWalletIcon(inAppWalletName),
        isInstalled: true,
        provider,
      });
      console.log(`Detected ${wallets.length} wallet(s):`, wallets.map(w => w.name));
      return wallets;
    }

    const seenNames = new Set<string>();
    const seenProviders = new Set<any>();
    for (const detail of this.requestEip6963Providers(shouldRequestEip6963)) {
      const wallet = this.getEip6963WalletInfo(detail);
      if (wallet) this.addWalletIfAvailable(wallets, wallet, seenNames, seenProviders);
    }

    const providers = this.getEthereumProviders();
    const safePalProvider = providers.find((provider) => getProviderFlag(provider, 'isSafePal'));
    const trustProvider = providers.find((provider) => getProviderFlag(provider, 'isTrust') || getProviderFlag(provider, 'isTrustWallet'));
    const tokenPocketProvider = providers.find((provider) => this.isTokenPocketProvider(provider));
    const bitgetProvider = normalizeUsableProvider(providers.find((provider) => this.isBitgetProvider(provider))) || this.getDetectedBitgetProvider();
    const metaMaskProvider = providers.find((provider) =>
      getProviderFlag(provider, 'isMetaMask') &&
      !getProviderFlag(provider, 'isSafePal') &&
      !getProviderFlag(provider, 'isTrust') &&
      !getProviderFlag(provider, 'isTrustWallet') &&
      !this.isTokenPocketProvider(provider) &&
      !getProviderFlag(provider, 'isBitKeep') &&
      !getProviderFlag(provider, 'isBitget') &&
      !this.isBitgetProvider(provider)
    );

    if (safePalProvider) {
      this.addWalletIfAvailable(wallets, {
        name: 'SafePal',
        icon: '🛡️',
        isInstalled: true,
        provider: safePalProvider,
      }, seenNames, seenProviders);
    }

    if (trustProvider && trustProvider !== safePalProvider) {
      this.addWalletIfAvailable(wallets, {
        name: 'Trust Wallet',
        icon: '🔷',
        isInstalled: true,
        provider: trustProvider,
      }, seenNames, seenProviders);
    }

    if (tokenPocketProvider) {
      this.addWalletIfAvailable(wallets, {
        name: 'TokenPocket',
        icon: 'TP',
        isInstalled: true,
        provider: tokenPocketProvider,
      }, seenNames, seenProviders);
    }

    if (bitgetProvider) {
      this.addWalletIfAvailable(wallets, {
        name: 'Bitget Wallet',
        icon: 'BG',
        isInstalled: true,
        provider: bitgetProvider,
      }, seenNames, seenProviders);
    }

    if (metaMaskProvider && metaMaskProvider !== safePalProvider && metaMaskProvider !== trustProvider) {
      this.addWalletIfAvailable(wallets, {
        name: 'MetaMask',
        icon: '🦊',
        isInstalled: true,
        provider: metaMaskProvider,
      }, seenNames, seenProviders);
    }

    // Binance Chain Wallet
    if ((window as any).BinanceChain) {
      wallets.push({
        name: 'Binance Chain Wallet',
        icon: '🟡',
        isInstalled: true,
        provider: (window as any).BinanceChain,
      });
    }

    // Generic Web3 wallet (if no specific wallet detected but ethereum exists)
    if ((window as any).ethereum && wallets.length === 0) {
      wallets.push({
        name: 'Web3 Wallet',
        icon: '🔗',
        isInstalled: true,
        provider: (window as any).ethereum,
      });
    }

    console.log(`Detected ${wallets.length} wallet(s):`, wallets.map(w => w.name));
    return wallets;
  }

  // Connect to wallet
  async connectWallet(walletProvider: any): Promise<WalletState> {
    // Prevent multiple simultaneous connection attempts
    if (this.isConnecting) {
      throw new Error('Connection already in progress. Please wait...');
    }

    this.isConnecting = true;
    console.log('Connecting to wallet...');

    try {
      // Add delay to prevent rapid successive requests
      await new Promise(resolve => setTimeout(resolve, 100));

      // Initialize provider
      this.externalProvider = walletProvider;
      this.provider = new ethers.BrowserProvider(walletProvider);

      // Request account access
      console.log('Requesting account access...');
      // FIX: Ensure eth_requestAccounts is called first to trigger connection
      let accounts = await walletProvider.request({ method: 'eth_accounts' });

      if (accounts.length === 0) {
        // If not connected, request connection
        accounts = await walletProvider.request({ method: 'eth_requestAccounts' });
      }

      if (accounts.length === 0) {
        throw new Error('No accounts returned by wallet. Connection failed.');
      }

      // Switch to correct network
      console.log('Switching to correct network...');
      await this.switchToCorrectNetwork(walletProvider);

      // Recreate the provider after a chain switch so subsequent reads use the active network.
      await new Promise(resolve => setTimeout(resolve, 150));
      this.provider = new ethers.BrowserProvider(walletProvider);

      // Get signer and address
      this.signer = await this.provider.getSigner();
      const address = await this.signer.getAddress();
      const network = await this.provider.getNetwork();

      console.log('Getting balances...');
      const [bnbBalanceResult, usdtBalanceResult] = await Promise.allSettled([
        this.readBNBBalance(address),
        this.readUSDTBalance(address)
      ]);

      const balance = bnbBalanceResult.status === 'fulfilled' ? bnbBalanceResult.value : '0.00';
      const usdtBalance = usdtBalanceResult.status === 'fulfilled' ? usdtBalanceResult.value : '0.00';
      const hasRpcWarning =
        (bnbBalanceResult.status === 'rejected' && this.isRpcFetchError(bnbBalanceResult.reason)) ||
        (usdtBalanceResult.status === 'rejected' && this.isRpcFetchError(usdtBalanceResult.reason));
      const warning = hasRpcWarning ? this.buildRpcUnavailableMessage() : null;

      const newWalletState: WalletState = {
        isConnected: true,
        address,
        chainId: Number(network.chainId),
        balance,
        usdtBalance,
        walletName: this.getWalletName(walletProvider),
        warning,
      };

      this.currentWalletState = newWalletState; // Update internal state
      this.persistCurrentWalletState();

      console.log('Wallet connected successfully:', {
        address: address.substring(0, 10) + '...',
        network: Number(network.chainId),
        balance: balance.substring(0, 8),
        usdtBalance: usdtBalance.substring(0, 8),
        warning,
      });

      return newWalletState;

    } catch (error: any) {
      console.error('Wallet connection failed:', error);

      // Handle specific errors with better messaging
      if (error.code === -32002) {
        throw new Error('Wallet is busy. Please open your wallet, reject any pending requests, and try again.');
      } else if (error.code === 4001) {
        throw new Error('Connection cancelled by user');
      } else if (error.message?.includes('already pending')) {
        throw new Error('Please check your wallet for pending requests. Close and reopen it if needed.');
      } else if (error.message?.includes('Admin settings not configured')) {
        throw error; // Re-throw admin settings error as-is
      }

      // Ensure internal state is cleared on failure
      this.provider = null;
      this.signer = null;
      this.externalProvider = null;
      this.currentWalletState = { isConnected: false, address: null, chainId: null, balance: '0', usdtBalance: '0', walletName: null, warning: null };
      this.persistCurrentWalletState();


      throw new Error(`Connection failed: ${error.message}`);
    } finally {
      this.isConnecting = false;
    }
  }

  // Switch to correct network based on payment mode
  async switchToCorrectNetwork(provider: any): Promise<void> {
    try {
      await new Promise(resolve => setTimeout(resolve, 100));

      const networkConfig = this.getNetworkConfig();
      console.log(`Switching to ${networkConfig.chainName}...`);

      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: networkConfig.chainId }],
      });

      console.log(`Successfully switched to ${networkConfig.chainName}`);

    } catch (switchError: any) {
      console.log('Network switch failed, attempting to add network:', switchError.code);

      // Chain not added, try to add it
      if (switchError.code === 4902) {
        await new Promise(resolve => setTimeout(resolve, 100));

        const networkConfig = this.getNetworkConfig();
        console.log(`Adding ${networkConfig.chainName} to wallet...`);

        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [networkConfig],
        });

        console.log(`Successfully added ${networkConfig.chainName}`);

      } else if (switchError.code === -32002) {
        throw new Error('MetaMask is busy. Please check for pending requests and try again.');
      } else if (switchError.code === 4001) {
        throw new Error('Network switch cancelled by user');
      } else {
        throw new Error(`Failed to switch network: ${switchError.message}`);
      }
    }
  }

  // Get BNB balance
  private async readBNBBalance(address: string): Promise<string> {
    if (!this.provider) {
      throw new Error('Provider not initialized');
    }

    const balance = await this.provider.getBalance(address);
    return ethers.formatEther(balance);
  }

  async getBNBBalance(address: string): Promise<string> {
    try {
      return await this.readBNBBalance(address);
    } catch (error) {
      console.error('Error fetching BNB balance:', error);
      return '0.00';
    }
  }

  // Get USDT balance
  private async readUSDTBalance(address: string): Promise<string> {
    if (!this.provider) {
      throw new Error('Provider not initialized');
    }

    const usdtContractAddress = this.getUSDTContractAddress();
    console.log('Fetching USDT balance from:', usdtContractAddress);

    const contract = new ethers.Contract(usdtContractAddress, USDT_ABI, this.provider);
    const balance = await contract.balanceOf(address);
    const decimals = await contract.decimals();

    const formattedBalance = ethers.formatUnits(balance, decimals);
    console.log('USDT balance:', formattedBalance);

    return formattedBalance;
  }

  async getUSDTBalance(address: string): Promise<string> {
    try {
      return await this.readUSDTBalance(address);
    } catch (error: any) {
      console.error('❌ Critical Error fetching USDT balance:', error);

      if (error.code === 'CALL_EXCEPTION') {
        console.error('The USDT contract call failed. Check if wallet is on the correct network and if the USDT address is correct.');
      }

      return '0.00';
    }
  }

  // Execute USDT distribution
  async executeUSDTDistribution(planPrice: number): Promise<{ hash: string; steps: string[] }> {
    if (!this.signer || !this.provider) {
      throw new Error('Wallet not connected');
    }

    if (!this.adminSettings) {
      throw new Error('Admin settings not configured');
    }

    const steps: string[] = [];
    const signerAddress = await this.signer.getAddress();

    console.log('Starting USDT distribution process...');
    await this.assertCorrectNetwork();

    // Use subscription wallet address from settings
    const recipients = [this.getSubscriptionWalletAddress()];
    const amounts = [ethers.parseUnits(planPrice.toString(), 18)];
    const totalAmount = ethers.parseUnits(planPrice.toString(), 18);

    // Get contract addresses
    const usdtContractAddress = this.getUSDTContractAddress();
    const distributionContractAddress = this.getDistributionContractAddress();

    console.log('Contract configuration:', {
      usdtContract: usdtContractAddress,
      distributionContract: distributionContractAddress,
      subscriptionWallet: recipients[0],
      planPrice: planPrice
    });

    // Initialize contracts
    const distributionContract = new ethers.Contract(distributionContractAddress, DISTRIBUTION_ABI, this.signer);
    const usdtContract = new ethers.Contract(usdtContractAddress, USDT_ABI, this.signer);

    steps.push("=== USDT Distribution Process Started ===");
    steps.push(`Network: ${this.isLivePaymentMode(this.adminSettings.paymentMode) ? 'BSC Mainnet' : 'BSC Testnet'}`);
    steps.push(`USDT Contract: ${usdtContractAddress}`);
    steps.push(`Distribution Contract: ${distributionContractAddress}`);
    steps.push(`Plan Price: ${planPrice} USDT`);
    steps.push(`Total Amount: ${ethers.formatUnits(totalAmount, 18)} USDT`);
    steps.push(`Subscription Wallet: ${recipients[0]}`);

    try {
      // Step 1: Check USDT balance
      steps.push("\n1. Checking USDT balance...");
      console.log('Checking USDT balance...');

      const balance = await usdtContract.balanceOf(signerAddress);
      const formattedBalance = ethers.formatUnits(balance, 18);
      steps.push(`USDT Balance: ${formattedBalance} USDT`);

      if (balance < totalAmount) {
        const errorMsg = `Insufficient USDT balance! Required: ${planPrice} USDT, Available: ${formattedBalance} USDT`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }

      // Step 2: Check current allowance
      steps.push("\n2. Checking current allowance...");
      console.log('Checking allowance...');

      const currentAllowance = await usdtContract.allowance(signerAddress, distributionContractAddress);
      const formattedAllowance = ethers.formatUnits(currentAllowance, 18);
      steps.push(`Current Allowance: ${formattedAllowance} USDT`);

      // Step 3: Approve USDT if needed
      if (currentAllowance < totalAmount) {
        steps.push("\n3. Approving USDT spending...");
        console.log('Approving USDT spending...');

        try {
          const approveTx = await usdtContract.approve(distributionContractAddress, totalAmount);
          steps.push(`Approve transaction: ${approveTx.hash}`);
          console.log('Approve transaction hash:', approveTx.hash);

          steps.push("Waiting for approval confirmation...");
          const approveReceipt = await approveTx.wait();
          console.log('Approval confirmed, gas used:', approveReceipt?.gasUsed?.toString());

          steps.push("✅ USDT approval successful!");
        } catch (approveError: any) {
          console.error('USDT approval failed:', approveError);
          throw new Error(`USDT approval failed: ${approveError.message}`);
        }
      } else {
        steps.push("\n3. ✅ Already have sufficient allowance");
        console.log('Sufficient allowance already exists');
      }

      // Step 4: Validate distribution (optional)
      steps.push("\n4. Validating distribution...");
      try {
        const isValid = await distributionContract.validateDistribution(recipients, amounts, totalAmount);
        steps.push(`Distribution valid: ${isValid}`);

        if (!isValid) {
          throw new Error("Distribution validation failed!");
        }
      } catch (validationError: any) {
        console.log('Validation check failed or method not available:', validationError.message);
        steps.push("⚠️ Validation check skipped (method may not exist)");
      }

      // Step 5: Execute distribution
      steps.push("\n5. Distributing payment...");
      console.log('Executing distribution...');

      try {
        const tx = await distributionContract.distributePayment(recipients, amounts, totalAmount, {
          gasLimit: 300000 // Increased gas limit for safety
        });

        steps.push(`Distribution transaction: ${tx.hash}`);
        steps.push("Waiting for confirmation...");
        console.log('Distribution transaction hash:', tx.hash);

        const receipt = await tx.wait();
        console.log('Distribution confirmed, gas used:', receipt?.gasUsed?.toString());

        steps.push("✅ Distribution completed successfully!");
        steps.push(`Gas used: ${receipt?.gasUsed?.toString() || 'N/A'}`);

        // Step 6: Show final status
        steps.push("\n=== Final Status ===");
        const finalBalance = await usdtContract.balanceOf(signerAddress);
        const finalFormattedBalance = ethers.formatUnits(finalBalance, 18);
        steps.push(`Remaining USDT Balance: ${finalFormattedBalance} USDT`);

        console.log('Distribution process completed successfully');
        return { hash: tx.hash, steps };

      } catch (distributionError: any) {
        console.error('Distribution failed:', distributionError);
        throw new Error(`Distribution failed: ${distributionError.message}`);
      }

    } catch (error: any) {
      console.error('Distribution process failed:', error);
      steps.push(`\n❌ Error: ${error.message}`);
      throw error;
    }
  }

  // Direct USDT transfer to admin wallet (registration payments)
  async sendUSDTTransfer(toAddress: string, amount: number): Promise<{ hash: string; steps: string[] }> {
    if (!this.provider || !this.externalProvider) {
      throw new Error('Wallet not connected');
    }

    if (!this.adminSettings) {
      throw new Error('Admin settings not configured');
    }

    if (!ethers.isAddress(toAddress)) {
      throw new Error('Invalid recipient wallet address');
    }

    const steps: string[] = [];

    // Refresh signer — on Android MetaMask the signer can become stale after app-switching
    try {
      this.provider = new ethers.BrowserProvider(this.externalProvider);
      this.signer = await this.provider.getSigner();
    } catch {
      // If refresh fails, fall back to existing signer
      if (!this.signer) throw new Error('Wallet not connected');
    }

    const signerAddress = await this.signer.getAddress();

    await this.assertCorrectNetwork();

    const usdtContractAddress = this.getUSDTContractAddress();
    const usdtContract = new ethers.Contract(usdtContractAddress, USDT_ABI, this.signer);

    steps.push("=== USDT Transfer Started ===");
    steps.push(`Network: ${this.isLivePaymentMode(this.adminSettings.paymentMode) ? 'BSC Mainnet' : 'BSC Testnet'}`);
    steps.push(`USDT Contract: ${usdtContractAddress}`);
    steps.push(`From: ${signerAddress}`);
    steps.push(`To: ${toAddress}`);

    try {
      // Step 1: Load token decimals
      steps.push("\n1. Reading token decimals...");
      const decimals = await usdtContract.decimals();

      const amountUnits = ethers.parseUnits(amount.toString(), decimals);
      steps.push(`Amount: ${amount} USDT`);

      // Step 2: Check USDT balance
      steps.push("\n2. Checking USDT balance...");
      const balance = await usdtContract.balanceOf(signerAddress);
      const formattedBalance = ethers.formatUnits(balance, decimals);
      steps.push(`USDT Balance: ${formattedBalance} USDT`);

      if (balance < amountUnits) {
        throw new Error(`Insufficient USDT balance. Required ${amount}, available ${formattedBalance}`);
      }

      // Step 3: Send transfer
      steps.push("\n3. Sending USDT transfer...");
      const tx = await usdtContract.transfer(toAddress, amountUnits);
      steps.push(`Transaction submitted: ${tx.hash}`);

      return { hash: tx.hash, steps };
    } catch (error: any) {
      console.error('USDT transfer failed:', error);
      steps.push(`\n❌ Error: ${error.message}`);
      throw error;
    }
  }

  async getCurrentBlockNumber(): Promise<number> {
    const providers = this.getReadonlyProviders();
    let lastError: any = null;

    for (const provider of providers) {
      try {
        const blockNumber = await provider.getBlockNumber();
        this.destroyReadonlyProvider(provider);
        return blockNumber;
      } catch (error) {
        lastError = error;
        this.destroyReadonlyProvider(provider);
      }
    }

    if (this.provider) {
      try {
        return await this.provider.getBlockNumber();
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error('Unable to read current block number');
  }

  async findRecentUSDTTransfer(
    fromAddress: string,
    toAddress: string,
    amount: number,
    fromBlock?: number | null
  ): Promise<string | null> {
    if (!ethers.isAddress(fromAddress) || !ethers.isAddress(toAddress)) {
      throw new Error('Invalid wallet address');
    }

    const usdtContractAddress = this.getUSDTContractAddress();
    const providers: Array<ethers.JsonRpcProvider | ethers.BrowserProvider> = [
      ...this.getReadonlyProviders(),
      ...(this.provider ? [this.provider] : [])
    ];
    let lastError: any = null;

    for (const provider of providers) {
      try {
        const tokenContract = new ethers.Contract(
          usdtContractAddress,
          ['function decimals() view returns (uint8)'],
          provider
        );

        let decimals = 18;
        try {
          decimals = Number(await tokenContract.decimals());
        } catch {
          // ignore: most configured USDT contracts in this app use 18 decimals.
        }

        const currentBlock = await provider.getBlockNumber();
        const startBlock = Math.max(0, Number.isFinite(Number(fromBlock)) ? Number(fromBlock) - 20 : currentBlock - 6000);
        const recovered = await this.findTransferWithProvider(
          provider,
          usdtContractAddress,
          fromAddress,
          toAddress,
          amount,
          decimals,
          startBlock,
          currentBlock
        );

        if (recovered) return recovered;
      } catch (error) {
        lastError = error;
        console.warn('USDT transfer recovery provider failed:', error);
      } finally {
        this.destroyReadonlyProvider(provider);
      }
    }

    if (lastError) {
      console.warn('USDT transfer recovery could not find a matching tx:', lastError);
    }

    return null;
  }

  private async findTransferWithProvider(
    provider: ethers.JsonRpcProvider | ethers.BrowserProvider,
    usdtContractAddress: string,
    fromAddress: string,
    toAddress: string,
    amount: number,
    decimals: number,
    startBlock: number,
    currentBlock: number
  ): Promise<string | null> {
    const expectedAmount = ethers.parseUnits(amount.toString(), decimals);
    const topics = [
      ERC20_TRANSFER_TOPIC,
      ethers.zeroPadValue(ethers.getAddress(fromAddress), 32),
      ethers.zeroPadValue(ethers.getAddress(toAddress), 32)
    ];
    const chunkSize = 750;
    const logs: ethers.Log[] = [];

    for (let toBlock = currentBlock; toBlock >= startBlock; toBlock -= chunkSize) {
      const fromChunk = Math.max(startBlock, toBlock - chunkSize + 1);
      const chunkLogs = await provider.getLogs({
        address: usdtContractAddress,
        fromBlock: fromChunk,
        toBlock,
        topics
      });
      logs.push(...chunkLogs);
      if (logs.length > 0) break;
    }

    const matchingLogs = logs
      .filter((log) => {
        try {
          return BigInt(log.data) === expectedAmount;
        } catch {
          return false;
        }
      })
      .sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) return b.blockNumber - a.blockNumber;
        return b.index - a.index;
      });

    return matchingLogs[0]?.transactionHash || null;
  }

  async watchUSDTToken(): Promise<boolean> {
    if (!this.provider) {
      throw new Error('Wallet not connected');
    }

    if (!this.externalProvider?.request) {
      throw new Error('Your wallet does not support adding tokens automatically.');
    }

    await this.assertCorrectNetwork();

    const tokenAddress = this.getUSDTContractAddress();
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ['function decimals() view returns (uint8)', 'function symbol() view returns (string)'],
      this.provider
    );

    let decimals = 18;
    let symbol = 'USDT';

    try {
      decimals = Number(await tokenContract.decimals());
    } catch {
      // ignore (fallback to 18)
    }

    try {
      symbol = String(await tokenContract.symbol()) || 'USDT';
    } catch {
      // ignore (fallback to USDT)
    }

    const watchAssetParams = {
      type: 'ERC20',
      options: {
        address: tokenAddress,
        symbol,
        decimals
      }
    };

    const attempts = [
      watchAssetParams,
      [watchAssetParams],
      JSON.stringify(watchAssetParams),
      JSON.stringify([watchAssetParams])
    ];

    let lastError: any = null;
    for (const params of attempts) {
      try {
        const result = await this.externalProvider.request({
          method: 'wallet_watchAsset',
          params
        });
        return Boolean(result);
      } catch (error: any) {
        lastError = error;
        const message = String(error?.message || error || '').toLowerCase();
        const isParamShapeError =
          message.includes('json') ||
          message.includes('object') ||
          message.includes('array') ||
          message.includes('invalid params') ||
          error?.code === -32602;

        if (!isParamShapeError || error?.code === 4001) {
          throw error;
        }
      }
    }

    throw lastError || new Error('Unable to add token');
  }

  // Disconnect wallet
  disconnect(): void {
    console.log('Disconnecting wallet...');
    this.provider = null;
    this.signer = null;
    this.externalProvider = null;
    this.isConnecting = false;
    // Clear internal state on disconnect
    this.currentWalletState = { isConnected: false, address: null, chainId: null, balance: '0', usdtBalance: '0', walletName: null, warning: null };
    this.persistCurrentWalletState();
  }

  // Get wallet name from provider
  private getWalletName(provider: any): string {
    if (getProviderFlag(provider, 'isSafePal')) return 'SafePal';
    if (getProviderFlag(provider, 'isTrust') || getProviderFlag(provider, 'isTrustWallet')) return 'Trust Wallet';
    if (this.isTokenPocketProvider(provider)) return 'TokenPocket';
    if (this.isBitgetProvider(provider)) return 'Bitget Wallet';
    if (getProviderFlag(provider, 'isMetaMask')) return 'MetaMask';
    if (getProviderFlag(provider, 'isBinanceChain') || getProviderFlag(provider, 'isBinance')) return 'Binance Chain Wallet';
    return 'Web3 Wallet';
  }

  // Utility method to check if wallet is connected
  isWalletConnected(): boolean {
    return this.provider !== null && this.signer !== null;
  }

  // Get current network info
  async getCurrentNetwork(): Promise<{ chainId: number; name: string } | null> {
    if (!this.provider) return null;

    try {
      const network = await this.provider.getNetwork();
      const networkConfig = this.getNetworkConfig();
      return {
        chainId: Number(network.chainId),
        name: networkConfig.chainName
      };
    } catch (error) {
      console.error('Error getting network info:', error);
      return null;
    }
  }

  // Refresh wallet balances
  async refreshBalances(address: string): Promise<{ bnb: string; usdt: string }> {
    const bnbBalance = await this.getBNBBalance(address);
    const usdtBalance = await this.getUSDTBalance(address);
    return { bnb: bnbBalance, usdt: usdtBalance };
  }

  // Refresh and persist the current wallet state balances (uses current admin settings / USDT contract).
  async syncCurrentWalletState(): Promise<WalletState> {
    if (!this.provider || !this.signer) {
      throw new Error('Wallet not connected');
    }

    const address = await this.signer.getAddress();
    const network = await this.provider.getNetwork();

    const [bnbBalanceResult, usdtBalanceResult] = await Promise.allSettled([
      this.readBNBBalance(address),
      this.readUSDTBalance(address)
    ]);

    const balance = bnbBalanceResult.status === 'fulfilled' ? bnbBalanceResult.value : this.currentWalletState.balance || '0.00';
    const usdtBalance = usdtBalanceResult.status === 'fulfilled' ? usdtBalanceResult.value : this.currentWalletState.usdtBalance || '0.00';
    const hasRpcWarning =
      (bnbBalanceResult.status === 'rejected' && this.isRpcFetchError(bnbBalanceResult.reason)) ||
      (usdtBalanceResult.status === 'rejected' && this.isRpcFetchError(usdtBalanceResult.reason));
    const warning = hasRpcWarning ? this.buildRpcUnavailableMessage() : null;

    const newWalletState: WalletState = {
      ...this.currentWalletState,
      isConnected: true,
      address,
      chainId: Number(network.chainId),
      balance,
      usdtBalance,
      warning
    };

    this.currentWalletState = newWalletState;
    this.persistCurrentWalletState();
    return newWalletState;
  }

  async refreshInjectedWalletSession(): Promise<WalletState> {
    if (!this.externalProvider?.request) {
      throw new Error('Wallet provider not available');
    }

    const accounts = await this.externalProvider.request({ method: 'eth_accounts' });
    if (!Array.isArray(accounts) || accounts.length === 0) {
      throw new Error('Wallet is not connected');
    }

    this.provider = new ethers.BrowserProvider(this.externalProvider);
    await this.switchToCorrectNetwork(this.externalProvider);
    await new Promise(resolve => setTimeout(resolve, 150));
    this.provider = new ethers.BrowserProvider(this.externalProvider);
    this.signer = await this.provider.getSigner();

    return this.syncCurrentWalletState();
  }
}
