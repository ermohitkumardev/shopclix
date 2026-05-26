import React from 'react';
import { WalletInfo } from '../types/wallet';
import { Wallet, Download } from 'lucide-react';

interface WalletSelectorProps {
  wallets: WalletInfo[];
  onConnect: (provider: any) => void;
  isConnecting: boolean;
}

export const WalletSelector: React.FC<WalletSelectorProps> = ({
  wallets,
  onConnect,
  isConnecting,
}) => {
  const installWallets = [
    { name: 'MetaMask', url: 'https://metamask.io/download/', icon: '🦊' },
    { name: 'Trust Wallet', url: 'https://trustwallet.com/', icon: '🔷' },
    { name: 'SafePal', url: 'https://safepal.io/', icon: '🛡️' },
    { name: 'TokenPocket', url: 'https://www.tokenpocket.pro/', icon: 'TP' },
    { name: 'Bitget Wallet', url: 'https://web3.bitget.com/en/wallet-download', icon: 'BG' },
  ];

  return (
    <div className="space-y-6">
      {wallets.length > 0 ? (
        <div>
          <h3 className="text-lg font-semibold text-gray mb-4 flex items-center">
            <Wallet className="w-5 h-5 mr-2" />
            Available Wallets
          </h3>
          <div className="space-y-3">
            {wallets.map((wallet) => (
              <div
                key={wallet.name}
                className="flex items-center justify-between p-4 bg-white/10 backdrop-blur-sm rounded-lg border border-white/20"
              >
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">{wallet.icon}</span>
                  <span className="text-gray font-medium">{wallet.name}</span>
                </div>
                <button
                  onClick={() => onConnect(wallet.provider)}
                  disabled={isConnecting}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:opacity-50 text-white rounded-lg font-medium transition-all duration-200 hover:scale-105"
                >
                  {isConnecting ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center">
            <Download className="w-5 h-5 mr-2" />
            Install a Wallet
          </h3>
          <div className="space-y-3">
            {installWallets.map((wallet) => (
              <div
                key={wallet.name}
                className="flex items-center justify-between p-4 bg-white/10 backdrop-blur-sm rounded-lg border border-white/20"
              >
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">{wallet.icon}</span>
                  <span className="text-white font-medium">{wallet.name}</span>
                </div>
                <a
                  href={wallet.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-all duration-200 hover:scale-105"
                >
                  Install
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
