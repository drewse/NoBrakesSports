export default function DisclaimerPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-3xl font-bold text-white mb-2">Informational Use Disclaimer</h1>
      <p className="text-sm text-nb-400 mb-10">Last updated: March 2025</p>

      <div className="rounded-lg border border-border bg-nb-900 p-6 mb-8">
        <p className="text-sm font-semibold text-white mb-2">Important Notice</p>
        <p className="text-sm text-nb-300 leading-relaxed">
          No Brakes Sports is a <strong className="text-white">market analytics and data intelligence platform</strong>.
          It is not a sportsbook, betting service, gambling operator, or financial advisory platform.
          Nothing on this platform should be construed as a recommendation to place any wager or make any financial decision.
        </p>
      </div>

      <div className="space-y-6">
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">No Gambling Facilitation</h2>
          <p className="text-sm text-nb-300 leading-relaxed">
            We do not accept wagers. We do not place bets on behalf of users. We do not partner with,
            refer users to, or earn revenue from sportsbooks or gambling operators. Market data displayed
            is for research and analysis purposes only.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Data Accuracy</h2>
          <p className="text-sm text-nb-300 leading-relaxed">
            Market data is aggregated from third-party sources and may be delayed, approximate, or contain
            errors. We make no representations about the accuracy, completeness, or timeliness of any data.
            Do not rely on this data for financial decisions.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Not Financial Advice</h2>
          <p className="text-sm text-nb-300 leading-relaxed">
            All content on this platform is for informational purposes only. No Brakes Sports does not
            provide financial, investment, or gambling advice. Users should consult qualified professionals
            before making any financial decisions.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Responsible Use</h2>
          <p className="text-sm text-nb-300 leading-relaxed">
            Users are solely responsible for how they use information from this platform in compliance with
            local laws and regulations. Gambling may be regulated or restricted in your jurisdiction.
            It is your responsibility to understand and comply with applicable laws.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Problem Gambling Resources</h2>
          <p className="text-sm text-nb-300 leading-relaxed">
            If you or someone you know has a gambling problem, help is available.
            Contact the National Problem Gambling Helpline at <strong className="text-white">1-800-522-4700</strong> or
            visit <strong className="text-white">ncpgambling.org</strong>.
          </p>
        </section>
      </div>
    </div>
  )
}
