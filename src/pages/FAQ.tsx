import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Search, HelpCircle, Users, CreditCard, Shield, Settings } from 'lucide-react';

const FAQ: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState('general');
  const [openItems, setOpenItems] = useState<number[]>([]);

  const categories = [
    { id: 'general', label: 'General', icon: HelpCircle },
    { id: 'account', label: 'Account & Registration', icon: Users },
    { id: 'payments', label: 'Payments & Billing', icon: CreditCard },
    { id: 'security', label: 'Security & Privacy', icon: Shield },
    { id: 'technical', label: 'Technical Support', icon: Settings }
  ];

  const faqs = {
    general: [
      {
        question: "How does the referral program work?",
        answer: "Our referral program lets you earn through direct sales and by inviting others to register under your account. There is no binary tree or multi-level structure—only direct referrals, with unlimited personal recruits."
      },
      {
        question: "How much money can I make?",
        answer: "Earnings depend on your activity and referrals. We do not guarantee any specific income or results. You can track your earnings and transactions inside your dashboard."
      },
      {
        question: "Is this a pyramid scheme?",
        answer: "We are a referral-based platform where users can earn from direct referrals based on the current plan rules shown in the app. Please review our policies and ensure participation is permitted in your region."
      },
      {
        question: "What countries do you operate in?",
        answer: "Availability depends on local regulations and our operational support. If registration is available in your region, you’ll be able to complete signup and payments normally."
      }
    ],
    account: [
      {
        question: "How do I create an account?",
        answer: "1) Click 'Join as Customer' or 'Join as Company', 2) Fill the registration form, 3) Verify via OTP (and email if enabled), 4) Choose and pay for your plan. You’ll then have access to your dashboard."
      },
      {
        question: "Can I change my sponsor/upline after registration?",
        answer: "No, sponsor relationships cannot be changed after account creation. This keeps the direct-referral structure consistent and fair. Please choose your sponsor carefully during registration."
      },
      {
        question: "What if I forget my password?",
        answer: "Use the 'Forgot Password' link on the login page. Enter your User ID and registered email address to receive an email OTP. Enter the OTP, choose a new password, and submit the reset form. If you don’t receive the OTP, check your inbox or spam folder and try resending it."
      },
      {
        question: "How do I update my profile information?",
        answer: "Log into your dashboard and open your profile/account settings. Some fields may require verification before they can be changed."
      }
    ],
    payments: [
      {
        question: "What payment methods do you accept?",
        answer: "We currently accept cryptocurrency payments in USDT (BEP20 / Binance Smart Chain). You can pay using supported wallets like MetaMask, Trust Wallet, or SafePal."
      },
      {
        question: "When and how are commissions paid?",
        answer: "Earnings are credited to your wallet based on completed/verified payments and the current plan rules. You can view all credits and debits in your Transactions and Earnings sections."
      },
      {
        question: "Are there any fees for withdrawals?",
        answer: "Withdrawal fees (if any) depend on blockchain network costs and any platform processing rules shown at the time you request a withdrawal. Withdrawals are typically processed instantly after you submit a request."
      }
    ],
    security: [
      {
        question: "How secure is my personal information?",
        answer: "We use standard security best practices such as encrypted connections and access controls. Always use a strong password and keep your account credentials private."
      },
      {
        question: "Do you offer two-factor authentication?",
        answer: "If OTP/2FA options are available in your account settings, we strongly recommend enabling them for extra protection."
      },
      {
        question: "What should I do if I suspect unauthorized access?",
        answer: "Change your password immediately and review your recent logins/transactions. If you see anything suspicious, contact support from the Contact page."
      },
      {
        question: "How do you protect against fraud?",
        answer: "We monitor for suspicious activity and may require additional verification in some cases. Never share OTPs, passwords, or private keys with anyone."
      }
    ],
    technical: [
      {
        question: "What browsers are supported?",
        answer: "Our platform works best on modern browsers including Chrome, Firefox, Safari, and Edge. We recommend keeping your browser updated for optimal performance and security. Mobile browsers are also fully supported for on-the-go access."
      },
      {
        question: "Is there a mobile app available?",
        answer: "Currently, we offer a mobile-responsive website that works excellently on all devices. A dedicated mobile app is in development and will be available soon. You can add our website to your home screen for app-like functionality."
      },
      {
        question: "Why is my dashboard loading slowly?",
        answer: "Slow loading can be caused by internet connection, browser cache, or high server traffic. Try clearing your browser cache, checking your internet connection, or accessing during off-peak hours. Contact technical support if problems persist."
      },
      {
        question: "How do I report a technical bug?",
        answer: "Report bugs through the Contact page. Include your device/browser, steps to reproduce, and screenshots if possible."
      }
    ]
  };

  const toggleItem = (index: number) => {
    setOpenItems(prev => 
      prev.includes(index) 
        ? prev.filter(i => i !== index)
        : [...prev, index]
    );
  };

  const filteredFaqs = faqs[activeCategory as keyof typeof faqs].filter(faq =>
    faq.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
    faq.answer.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <section className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center space-x-2 bg-white/10 backdrop-blur-sm rounded-full px-6 py-3 mb-6 border border-white/20">
            <HelpCircle className="h-5 w-5" />
            <span className="text-sm font-medium">Help Center</span>
          </div>
          <h1 className="text-4xl md:text-6xl font-bold mb-6">Frequently Asked Questions</h1>
          <p className="text-xl md:text-2xl text-indigo-100 max-w-3xl mx-auto mb-8">
            Find quick answers to common questions about our referral platform.
          </p>
          
          {/* Search Bar */}
          <div className="max-w-2xl mx-auto">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="block w-full pl-12 pr-4 py-4 border border-white/20 rounded-2xl bg-white/10 backdrop-blur-sm text-white placeholder-gray-300 focus:ring-2 focus:ring-white/50 focus:border-transparent"
                placeholder="Search for answers..."
              />
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Category Sidebar */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-2xl shadow-lg p-6 sticky top-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Categories</h3>
              <nav className="space-y-2">
                {categories.map((category) => (
                  <button
                    key={category.id}
                    onClick={() => setActiveCategory(category.id)}
                    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg text-left transition-colors ${
                      activeCategory === category.id
                        ? 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    <category.icon className="h-5 w-5" />
                    <span className="font-medium">{category.label}</span>
                  </button>
                ))}
              </nav>
            </div>
          </div>

          {/* FAQ Content */}
          <div className="lg:col-span-3">
            <div className="bg-white rounded-2xl shadow-lg">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-2xl font-bold text-gray-900">
                  {categories.find(cat => cat.id === activeCategory)?.label}
                </h2>
                <p className="text-gray-600 mt-2">
                  {filteredFaqs.length} question{filteredFaqs.length !== 1 ? 's' : ''} found
                </p>
              </div>

              <div className="p-6">
                {filteredFaqs.length === 0 ? (
                  <div className="text-center py-12">
                    <HelpCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No results found</h3>
                    <p className="text-gray-600">Try adjusting your search terms or browse different categories.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {filteredFaqs.map((faq, index) => (
                      <div key={index} className="border border-gray-200 rounded-lg">
                        <button
                          onClick={() => toggleItem(index)}
                          className="w-full flex items-center justify-between p-6 text-left hover:bg-gray-50 transition-colors"
                        >
                          <h3 className="text-lg font-medium text-gray-900 pr-4">
                            {faq.question}
                          </h3>
                          {openItems.includes(index) ? (
                            <ChevronUp className="h-5 w-5 text-gray-500 flex-shrink-0" />
                          ) : (
                            <ChevronDown className="h-5 w-5 text-gray-500 flex-shrink-0" />
                          )}
                        </button>
                        {openItems.includes(index) && (
                          <div className="px-6 pb-6">
                            <div className="prose prose-gray max-w-none">
                              <p className="text-gray-600 leading-relaxed">{faq.answer}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Contact Support */}
            <div className="mt-8 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl p-8 text-white text-center">
              <h3 className="text-2xl font-bold mb-4">Still have questions?</h3>
              <p className="text-indigo-100 mb-6">
                Our support team is here to help you succeed. Get personalized assistance from our experts.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <a
                  href="/contact"
                  className="bg-white text-indigo-600 px-6 py-3 rounded-lg font-semibold hover:bg-gray-100 transition-colors"
                >
                  Contact Support
                </a>
                <a
                  href="mailto:support.shopclix@gmail.com"
                  className="border-2 border-white text-white px-6 py-3 rounded-lg font-semibold hover:bg-white hover:text-indigo-600 transition-colors"
                >
                  Email Us
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FAQ;
