interface Window {
    ethereum?: {
        isMetaMask?: boolean;
        isTrust?: boolean;
        isSafePal?: boolean;
        isTokenPocket?: boolean;
        isBitKeep?: boolean;
        isBitget?: boolean;
        request?: (args: { method: string; params?: any[] }) => Promise<any>;
    };
    tokenpocket?: {
        ethereum?: Window['ethereum'];
    };
    bitkeep?: {
        ethereum?: Window['ethereum'];
    };
    bitget?: {
        ethereum?: Window['ethereum'];
    };
    bitgetWallet?: Window['ethereum'];
    BitKeep?: {
        ethereum?: Window['ethereum'];
    };
    turnstile?: {
        render: (
            container: string | HTMLElement,
            options: {
                sitekey: string;
                theme?: 'auto' | 'light' | 'dark';
                size?: 'normal' | 'flexible' | 'compact';
                callback?: (token: string) => void;
                'expired-callback'?: () => void;
                'error-callback'?: () => void;
            }
        ) => string;
        reset: (widgetId?: string) => void;
        remove: (widgetId: string) => void;
    };
}
