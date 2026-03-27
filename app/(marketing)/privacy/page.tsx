export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-3xl font-bold text-white mb-2">Privacy Policy</h1>
      <p className="text-sm text-nb-400 mb-10">Last updated: March 2025</p>

      <div className="space-y-8">
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Information We Collect</h2>
          <p className="text-sm text-nb-300 leading-relaxed">
            We collect information you provide directly (name, email, password), usage data
            (pages visited, features used), and payment information processed securely through Stripe.
            We do not store credit card information on our servers.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">How We Use Information</h2>
          <p className="text-sm text-nb-300 leading-relaxed">
            We use your information to provide and improve the Service, send transactional emails
            (account confirmation, billing receipts), and analyze usage patterns to improve platform performance.
            We do not sell your personal data.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Data Retention</h2>
          <p className="text-sm text-nb-300 leading-relaxed">
            We retain your account data while your account is active. Upon deletion, personal data is
            removed within 30 days, except where retention is required by law.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Third-Party Services</h2>
          <p className="text-sm text-nb-300 leading-relaxed">
            We use Supabase (database), Stripe (payments), Resend (email), and PostHog (analytics).
            Each third party has its own privacy practices.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Your Rights</h2>
          <p className="text-sm text-nb-300 leading-relaxed">
            You may request access to, correction of, or deletion of your personal data by contacting
            us at <a href="mailto:privacy@nobrakes.sports" className="text-white underline">privacy@nobrakes.sports</a>
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Cookies</h2>
          <p className="text-sm text-nb-300 leading-relaxed">
            We use essential cookies for authentication and session management. Analytics cookies are
            used to understand platform usage in aggregate. You may disable cookies in your browser settings.
          </p>
        </section>
      </div>
    </div>
  )
}
