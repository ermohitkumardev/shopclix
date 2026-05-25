import React from 'react';
import { Users, Target, Award, Globe, TrendingUp, Shield, Heart, Zap } from 'lucide-react';

const AboutUs: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <section className="relative bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-20 overflow-hidden">
        <div className="absolute inset-0">
          <img 
            src="https://images.pexels.com/photos/3184418/pexels-photo-3184418.jpeg?auto=compress&cs=tinysrgb&w=1920&h=1080&fit=crop" 
            alt="About Us"
            className="w-full h-full object-cover opacity-20"
          />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl md:text-6xl font-bold mb-6">About Our Platform</h1>
          <p className="text-xl md:text-2xl text-indigo-100 max-w-3xl mx-auto">
            Empowering entrepreneurs worldwide through innovative referral technology and transparent business practices.
          </p>
        </div>
      </section>

      {/* Mission & Vision */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="inline-flex items-center space-x-2 bg-indigo-100 rounded-full px-6 py-3 mb-6">
                <Target className="h-5 w-5 text-indigo-600" />
                <span className="text-sm font-semibold text-indigo-600">Our Mission</span>
              </div>
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">
                Democratizing Financial Success
              </h2>
              <p className="text-lg text-gray-600 mb-6">
                We believe everyone deserves the opportunity to build financial freedom through entrepreneurship. 
                Our platform provides the tools, technology, and support needed to create sustainable income streams 
                through network marketing.
              </p>
              <p className="text-lg text-gray-600">
                By combining cutting-edge blockchain technology with proven referral strategies, we're creating 
                a transparent, fair, and profitable ecosystem for all participants.
              </p>
            </div>
            <div className="relative">
              <img 
                src="https://images.pexels.com/photos/3184360/pexels-photo-3184360.jpeg?auto=compress&cs=tinysrgb&w=800&h=600&fit=crop" 
                alt="Our Mission"
                className="rounded-2xl shadow-2xl"
              />
              <div className="absolute -bottom-6 -right-6 bg-gradient-to-r from-indigo-500 to-purple-600 text-white p-6 rounded-2xl shadow-xl">
                <div className="text-2xl font-bold">50K+</div>
                <div className="text-sm opacity-90">Success Stories</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Our Story */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">Our Story</h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Founded in 2020 by a team of entrepreneurs and technology experts who experienced 
              the challenges of traditional multi-level systems firsthand.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                year: "2020",
                title: "The Beginning",
                description: "Founded with a vision to revolutionize network marketing through technology and transparency.",
                image: "https://images.pexels.com/photos/3184465/pexels-photo-3184465.jpeg?auto=compress&cs=tinysrgb&w=400&h=300&fit=crop"
              },
              {
                year: "2022",
                title: "Blockchain Integration",
                description: "Launched our blockchain-based payment system, ensuring complete transparency in all transactions.",
                image: "https://images.pexels.com/photos/3184291/pexels-photo-3184291.jpeg?auto=compress&cs=tinysrgb&w=400&h=300&fit=crop"
              },
              {
                year: "2024",
                title: "Global Expansion",
                description: "Reached 50,000+ active members across 150+ countries, becoming a truly global platform.",
                image: "https://images.pexels.com/photos/3184338/pexels-photo-3184338.jpeg?auto=compress&cs=tinysrgb&w=400&h=300&fit=crop"
              }
            ].map((milestone, index) => (
              <div key={index} className="relative group">
                <div className="bg-gray-50 rounded-2xl p-8 hover:shadow-lg transition-shadow">
                  <div className="relative mb-6">
                    <img 
                      src={milestone.image} 
                      alt={milestone.title}
                      className="w-full h-48 object-cover rounded-lg group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute top-4 left-4 bg-indigo-600 text-white px-3 py-1 rounded-full text-sm font-bold">
                      {milestone.year}
                    </div>
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-3">{milestone.title}</h3>
                  <p className="text-gray-600">{milestone.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Core Values */}
      <section className="py-20 bg-gradient-to-br from-gray-900 to-indigo-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-6">Our Core Values</h2>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto">
              The principles that guide everything we do and shape our platform's culture.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              {
                icon: Shield,
                title: "Transparency",
                description: "Complete visibility into all transactions and earnings through blockchain technology."
              },
              {
                icon: Heart,
                title: "Integrity",
                description: "Honest business practices and ethical treatment of all community members."
              },
              {
                icon: Users,
                title: "Community",
                description: "Building strong relationships and supporting each other's success."
              },
              {
                icon: Zap,
                title: "Innovation",
                description: "Continuously improving our platform with cutting-edge technology."
              }
            ].map((value, index) => (
              <div key={index} className="text-center group">
                <div className="bg-white/10 backdrop-blur-sm w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform">
                  <value.icon className="h-10 w-10 text-indigo-300" />
                </div>
                <h3 className="text-xl font-bold mb-4">{value.title}</h3>
                <p className="text-gray-300">{value.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Team Section */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">Leadership Team</h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Meet the experienced professionals driving our mission forward.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                name: "Sarah Johnson",
                role: "CEO & Co-Founder",
                bio: "Former VP at Fortune 500 company with 15+ years in network marketing and business development.",
                image: "https://images.pexels.com/photos/3184317/pexels-photo-3184317.jpeg?auto=compress&cs=tinysrgb&w=400&h=400&fit=crop"
              },
              {
                name: "Michael Chen",
                role: "CTO & Co-Founder",
                bio: "Blockchain expert and software architect with experience at leading tech companies.",
                image: "https://images.pexels.com/photos/3184339/pexels-photo-3184339.jpeg?auto=compress&cs=tinysrgb&w=400&h=400&fit=crop"
              },
              {
                name: "Emma Davis",
                role: "Head of Operations",
                bio: "Operations specialist focused on scaling global platforms and ensuring exceptional user experience.",
                image: "https://images.pexels.com/photos/3184292/pexels-photo-3184292.jpeg?auto=compress&cs=tinysrgb&w=400&h=400&fit=crop"
              }
            ].map((member, index) => (
              <div key={index} className="bg-gray-50 rounded-2xl p-8 text-center group hover:shadow-lg transition-shadow">
                <img 
                  src={member.image} 
                  alt={member.name}
                  className="w-32 h-32 rounded-full mx-auto mb-6 object-cover group-hover:scale-105 transition-transform"
                />
                <h3 className="text-xl font-bold text-gray-900 mb-2">{member.name}</h3>
                <p className="text-indigo-600 font-semibold mb-4">{member.role}</p>
                <p className="text-gray-600">{member.bio}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Statistics */}
      <section className="py-20 bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-6">Our Impact</h2>
            <p className="text-xl text-indigo-100 max-w-3xl mx-auto">
              Numbers that reflect our commitment to empowering entrepreneurs worldwide.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { icon: Users, number: "50,000+", label: "Active Members" },
              { icon: Globe, number: "150+", label: "Countries" },
              { icon: TrendingUp, number: "2M+ USDT", label: "Total Earnings" },
              { icon: Award, number: "99.9%", label: "Uptime" }
            ].map((stat, index) => (
              <div key={index} className="group">
                <div className="bg-white/10 backdrop-blur-sm w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                  <stat.icon className="h-8 w-8 text-indigo-300" />
                </div>
                <div className="text-3xl md:text-4xl font-bold mb-2">{stat.number}</div>
                <div className="text-indigo-100">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Call to Action */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">
            Ready to Join Our Community?
          </h2>
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
            Become part of a global network of entrepreneurs building their financial future together.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/customer/register"
              className="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-semibold hover:bg-indigo-700 transition-colors"
            >
              Join as Customer
            </a>
            <a
              href="/company/register"
              className="border-2 border-indigo-600 text-indigo-600 px-8 py-4 rounded-2xl font-semibold hover:bg-indigo-50 transition-colors"
            >
              Join as Company
            </a>
          </div>
        </div>
      </section>
    </div>
  );
};

export default AboutUs;
