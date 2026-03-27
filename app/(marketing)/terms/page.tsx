export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-3xl font-bold text-white mb-2">Terms of Service</h1>
      <p className="text-sm text-nb-400 mb-10">Last updated: March 2025</p>

      <div className="prose prose-invert max-w-none space-y-8">
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">1. Acceptance of Terms</h2>
          <p className="text-sm text-nb-300 leading-relaxed">
            By accessing or using No Brakes Sports (&ldquo;the Service&rdquo;), you agree to be bound by these Terms of Service.
            If you do not agree, do not use the Service.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">2. Service Description</h2>
          <p className="text-sm text-nb-300 leading-relaxed">
            No Brakes Sports is a sports market analytics and data intelligence platform. The Service provides
            aggregated market data, price movement tracking, and analytical tools for informational and research
            purposes only. We do not facilitate, enable, or encourage wagering or gambling of any kind.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">3. Informational Use Only</h2>
          <p className="text-sm text-nb-300 leading-relaxed">
            All data, analytics, and information provided through the Service is for informational purposes only.
            Nothing on this platform constitutes financial advice, investment advice, gambling advice, or any
            recommendation to place a wager. Users are solely responsible for how they use information from this platform.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">4. Account Responsibilities</h2>
          <p className="text-sm text-nb-300 leading-relaxed">
            You are responsible for maintaining the security of your account credentials. You agree not to share
            your account, use automated tools to scrape data, or use the Service for any unlawful purpose.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">5. Subscriptions and Billing</h2>
          <p className="text-sm text-nb-300 leading-relaxed">
            Pro subscriptions are billed monthly or annually. Cancellations take effect at the end of the current
            billing period. No refunds are provided for partial periods unless required by law.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">6. Data Accuracy</h2>
          <p className="text-sm text-nb-300 leading-relaxed">
            While we strive for accuracy, data may be delayed, incomplete, or contain errors. We make no warranty
            regarding the accuracy, completeness, or timeliness of any data displayed.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">7. Limitation of Liability</h2>
          <p className="text-sm text-nb-300 leading-relaxed">
            To the fullest extent permitted by law, No Brakes Sports shall not be liable for any indirect,
            incidental, special, or consequential damages arising from use of the Service.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">8. Changes to Terms</h2>
          <p className="text-sm text-nb-300 leading-relaxed">
            We reserve the right to modify these terms at any time. Continued use of the Service constitutes
            acceptance of the updated terms.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">9. Contact</h2>
          <p className="text-sm text-nb-300 leading-relaxed">
            Questions about these Terms? Contact us at{' '}
            <a href="mailto:legal@nobrakes.sports" className="text-white underline">legal@nobrakes.sports</a>
          </p>
        </section>
      </div>
    </div>
  )
}
